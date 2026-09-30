import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  addDaysIso,
  diffDaysIso,
  formatMoney,
  localParts,
  todayIso,
  weekdayOf,
  zonedDateTimeToUtc,
} from '@pharmastock/shared';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import { loadConfig } from '../../config.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailOutboxService, isSafeEmail } from '../email/outbox.service.js';
import { SmtpService } from '../email/smtp.service.js';
import { EventsService, type DomainEventInput } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ReorderService } from '../stock/reorder.service.js';

type JobResult = Record<string, unknown>;

type Schedule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

interface JobDefinition {
  name: string;
  label: string;
  description: string;
  schedule: Schedule;
  run: (today: string) => Promise<JobResult>;
}

/** Une exécution « en cours » depuis plus longtemps que ceci est considérée comme perdue. */
const STALE_RUN_MS = 30 * 60_000;

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Tâches planifiées (§0, §6.14, RG-20, RG-22) : cohérence du stock, intégrité du journal,
 * alertes de péremption et de réapprovisionnement, factures échues et relances, relevés
 * mensuels. Chaque tâche s'exécute au plus une fois par période (table `job_runs`, unique sur
 * tâche + période) et peut être lancée à la demande par un administrateur.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly outbox: EmailOutboxService,
    private readonly smtp: SmtpService,
    private readonly reorder: ReorderService,
  ) {}

  private readonly jobs: JobDefinition[] = [
    {
      name: 'stock-consistency',
      label: 'Cohérence du stock (RG-22)',
      description:
        'Vérifie que la quantité restante de chaque lot égale la somme de ses mouvements. Toute divergence déclenche une alerte critique (aucune correction automatique).',
      schedule: { kind: 'daily', hour: 2, minute: 30 },
      run: () => this.stockConsistency(),
    },
    {
      name: 'audit-integrity',
      label: 'Intégrité du journal (RG-20)',
      description: 'Vérifie la chaîne de hash du mouchard. Échec : alerte critique.',
      schedule: { kind: 'weekly', weekday: 6, hour: 3, minute: 0 },
      run: () => this.auditIntegrity(),
    },
    {
      name: 'expiry-alerts',
      label: 'Alertes de péremption',
      description: 'Lots proches de la péremption (seuils paramétrables) et lots périmés en stock.',
      schedule: { kind: 'daily', hour: 6, minute: 30 },
      run: (today) => this.expiryAlerts(today),
    },
    {
      name: 'reorder-alerts',
      label: 'Suggestions de réapprovisionnement',
      description: 'Signale les produits à commander (rupture, sous le point de commande).',
      schedule: { kind: 'daily', hour: 6, minute: 35 },
      run: () => this.reorderAlerts(),
    },
    {
      name: 'overdue-invoices',
      label: 'Factures échues et relances',
      description:
        'Alerte sur les factures échues et envoie les relances aux clients (si activé dans les paramètres e-mail).',
      schedule: { kind: 'daily', hour: 7, minute: 0 },
      run: (today) => this.overdueInvoices(today),
    },
    {
      name: 'monthly-statements',
      label: 'Relevés de compte mensuels',
      description:
        'Le 1er du mois, envoie le relevé du mois précédent aux clients concernés (si activé dans les paramètres e-mail).',
      schedule: { kind: 'monthly', day: 1, hour: 7, minute: 30 },
      run: (today) => this.monthlyStatements(today),
    },
  ];

  // -------------------------------------------------------------------------
  // Planification
  // -------------------------------------------------------------------------

  @Interval('jobs', 60_000)
  async tick(): Promise<void> {
    if (loadConfig().DISABLE_SCHEDULER || this.running) return;
    this.running = true;
    try {
      await this.runDue();
    } catch (err) {
      this.logger.error({ err }, 'Tâches planifiées en échec');
    } finally {
      this.running = false;
    }
  }

  /** Période courante d'une tâche : null tant que l'heure prévue n'est pas atteinte. */
  private periodKey(schedule: Schedule, at: Date, tz: string): string | null {
    const local = localParts(at, tz);
    const time = `${two(schedule.hour)}:${two(schedule.minute)}`;
    if (schedule.kind === 'daily') {
      return at >= zonedDateTimeToUtc(local.date, time, tz) ? local.date : null;
    }
    if (schedule.kind === 'weekly') {
      const back = (weekdayOf(local.date) - schedule.weekday + 7) % 7;
      const date = addDaysIso(local.date, -back);
      return at >= zonedDateTimeToUtc(date, time, tz) ? `W${date}` : null;
    }
    const month = local.date.slice(0, 7);
    return at >= zonedDateTimeToUtc(`${month}-${two(schedule.day)}`, time, tz) ? month : null;
  }

  async runDue(at: Date = now()): Promise<string[]> {
    const tz = (await this.settings.all())['general.timezone'];
    const ran: string[] = [];
    for (const job of this.jobs) {
      const key = this.periodKey(job.schedule, at, tz);
      if (!key) continue;
      const result = await this.execute(job, key, 'SCHEDULE', null, at);
      if (result) ran.push(job.name);
    }
    return ran;
  }

  /** Lancement à la demande (administrateur) : ne consomme pas la période planifiée. */
  async runNow(name: string, actor: Actor) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return null;
    const key = `manual-${now().toISOString()}`;
    await this.execute(job, key, 'MANUAL', actor.userId, now());
    await this.audit.recordStandalone({
      eventType: 'JOB_RUN_MANUALLY',
      actor,
      entityType: 'job',
      entityId: name,
      entityRef: job.label,
      summary: `Tâche « ${job.label} » lancée manuellement`,
      notify: false,
    });
    return this.status();
  }

  /** Réserve la période (unique) puis exécute ; retourne le détail ou null si déjà faite. */
  private async execute(
    job: JobDefinition,
    periodKey: string,
    trigger: 'SCHEDULE' | 'MANUAL',
    userId: string | null,
    at: Date,
  ): Promise<JobResult | null> {
    const claimed = await this.claim(job.name, periodKey, trigger, userId);
    if (!claimed) return null;
    const tz = (await this.settings.all())['general.timezone'];
    try {
      const detail = await job.run(todayIso(tz, at));
      await this.prisma.jobRun.update({
        where: { id: claimed },
        data: { status: 'OK', finishedAt: now(), detail: detail as Prisma.InputJsonValue },
      });
      return detail;
    } catch (err) {
      this.logger.error({ err, job: job.name }, 'Tâche planifiée en échec');
      await this.prisma.jobRun.update({
        where: { id: claimed },
        data: {
          status: 'FAILED',
          finishedAt: now(),
          detail: { error: err instanceof Error ? err.message : String(err) },
        },
      });
      return null;
    }
  }

  private async claim(
    name: string,
    periodKey: string,
    trigger: string,
    userId: string | null,
  ): Promise<string | null> {
    const created = await this.prisma.jobRun.createMany({
      data: [{ name, periodKey, trigger, triggeredById: userId, startedAt: now() }],
      skipDuplicates: true,
    });
    const row = await this.prisma.jobRun.findUniqueOrThrow({
      where: { name_periodKey: { name, periodKey } },
    });
    if (created.count === 1) return row.id;
    // Déjà réservée : reprise seulement si l'exécution précédente a échoué ou s'est perdue.
    const stale =
      row.status === 'FAILED' ||
      (row.status === 'RUNNING' && now().getTime() - row.startedAt.getTime() > STALE_RUN_MS);
    if (!stale) return null;
    const updated = await this.prisma.jobRun.updateMany({
      where: { id: row.id, status: row.status, startedAt: row.startedAt },
      data: { status: 'RUNNING', startedAt: now(), finishedAt: null, detail: undefined },
    });
    return updated.count === 1 ? row.id : null;
  }

  /** État des tâches pour l'écran d'administration. */
  async status() {
    const runs = await this.prisma.jobRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
    return this.jobs.map((job) => {
      const mine = runs.filter((r) => r.name === job.name);
      const last = mine[0] ?? null;
      return {
        name: job.name,
        label: job.label,
        description: job.description,
        schedule: job.schedule,
        lastRun: last
          ? {
              startedAt: last.startedAt,
              finishedAt: last.finishedAt,
              status: last.status,
              trigger: last.trigger,
              detail: last.detail,
            }
          : null,
        history: mine.slice(0, 5).map((r) => ({
          startedAt: r.startedAt,
          status: r.status,
          trigger: r.trigger,
          detail: r.detail,
        })),
      };
    });
  }

  private emitEvent(event: DomainEventInput): Promise<void> {
    return this.prisma.tx((tx) => this.events.emit(tx, event));
  }

  // -------------------------------------------------------------------------
  // Tâches
  // -------------------------------------------------------------------------

  /** RG-22 : remaining_qty du lot = Σ des mouvements du lot. */
  async stockConsistency(): Promise<JobResult> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        lot_number: string;
        remaining_qty: number;
        movements: bigint;
        product_name: string;
      }[]
    >`
      SELECT l.id, l.lot_number, l.remaining_qty, p.name AS product_name,
             COALESCE((SELECT SUM(m.qty) FROM stock_movements m WHERE m.lot_id = l.id), 0)::bigint AS movements
      FROM lots l JOIN products p ON p.id = l.product_id
      WHERE l.remaining_qty <> COALESCE((SELECT SUM(m.qty) FROM stock_movements m WHERE m.lot_id = l.id), 0)
      ORDER BY p.name, l.lot_number LIMIT 200`;
    const checked = await this.prisma.lot.count();
    if (rows.length === 0) return { checked, inconsistent: 0 };
    const sample = rows.slice(0, 20).map((r) => ({
      lotId: r.id,
      product: r.product_name,
      lot: r.lot_number,
      remaining: r.remaining_qty,
      movements: Number(r.movements),
    }));
    await this.audit.recordStandalone({
      eventType: 'STOCK_INCONSISTENCY',
      summary: `Incohérence de stock : ${rows.length} lot(s) dont la quantité ne correspond pas à leurs mouvements (ex. ${sample[0]!.product}, lot ${sample[0]!.lot} : ${sample[0]!.remaining} en stock pour ${sample[0]!.movements} au journal)`,
      metadata: { inconsistent: rows.length, sample },
      notify: { link: '/stock/lots' },
    });
    return { checked, inconsistent: rows.length, sample };
  }

  /** RG-20 : vérification complète de la chaîne de hash. */
  async auditIntegrity(): Promise<JobResult> {
    const report = await this.audit.verifyIntegrity();
    await this.audit.recordStandalone({
      eventType: report.ok ? 'AUDIT_INTEGRITY_CHECKED' : 'AUDIT_INTEGRITY_FAILED',
      summary: report.ok
        ? `Intégrité du journal vérifiée (tâche planifiée) : ${report.checked} entrées conformes`
        : `Intégrité du journal compromise à l’entrée n° ${report.brokenAtId} : ${report.reason}`,
      metadata: report,
      notify: report.ok ? false : { link: '/audit' },
    });
    return { ok: report.ok, checked: report.checked };
  }

  async expiryAlerts(today: string): Promise<JobResult> {
    const settings = await this.settings.all();
    const thresholds = [...settings['stock.expiry_alert_days']].sort((a, b) => a - b);
    const horizon = thresholds[thresholds.length - 1]!;
    const lots = await this.prisma.lot.findMany({
      where: {
        remainingQty: { gt: 0 },
        expiryDate: { lte: new Date(`${addDaysIso(today, horizon)}T00:00:00Z`) },
      },
      select: {
        remainingQty: true,
        expiryDate: true,
        unitCostHt: true,
        lotNumber: true,
        product: { select: { name: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });
    const expired = lots.filter((l) => l.expiryDate.toISOString().slice(0, 10) <= today);
    const expiring = lots.filter((l) => l.expiryDate.toISOString().slice(0, 10) > today);
    const money = (v: number) =>
      formatMoney(v, {
        currency: settings['general.currency_code'],
        decimals: settings['general.currency_decimals'],
      });
    const cost = (list: typeof lots) =>
      list.reduce((acc, l) => acc + l.remainingQty * num(l.unitCostHt), 0);
    if (expired.length > 0) {
      await this.emitEvent({
        eventType: 'LOTS_EXPIRED',
        severity: 'WARNING',
        actorId: null,
        title: `${expired.length} lot(s) périmé(s) encore en stock`,
        body: `${expired.length} lot(s) périmés pour ${money(cost(expired))} au coût, dont ${expired
          .slice(0, 3)
          .map((l) => `${l.product.name} (lot ${l.lotNumber})`)
          .join(', ')}${expired.length > 3 ? '…' : ''}. À détruire ou retourner au fournisseur.`,
        link: '/stock/expiries',
        data: { count: expired.length, valueAtCost: cost(expired) },
      });
    }
    if (expiring.length > 0) {
      const buckets = thresholds.map((t, i) => {
        const prev = i === 0 ? 0 : thresholds[i - 1]!;
        const n = expiring.filter((l) => {
          const d = diffDaysIso(today, l.expiryDate.toISOString().slice(0, 10));
          return d > prev && d <= t;
        }).length;
        return `${n} dans ${i === 0 ? '' : `${prev + 1} à `}${t} j`;
      });
      await this.emitEvent({
        eventType: 'LOTS_EXPIRING',
        severity: 'WARNING',
        actorId: null,
        title: `${expiring.length} lot(s) proche(s) de la péremption`,
        body: `${buckets.join(' · ')} — valeur au coût ${money(cost(expiring))}.`,
        link: '/stock/expiries',
        data: { count: expiring.length, valueAtCost: cost(expiring) },
      });
    }
    return { expired: expired.length, expiring: expiring.length };
  }

  async reorderAlerts(): Promise<JobResult> {
    const suggestions = await this.reorder.suggestions(null);
    if (suggestions.length === 0) return { suggestions: 0 };
    const outOfStock = suggestions.filter((s) => s.sellable === 0);
    await this.emitEvent({
      eventType: 'REORDER_SUGGESTIONS',
      severity: outOfStock.length > 0 ? 'WARNING' : 'INFO',
      actorId: null,
      title: `${suggestions.length} produit(s) à réapprovisionner`,
      body: `${outOfStock.length} en rupture. Les plus urgents : ${suggestions
        .slice(0, 4)
        .map((s) => s.name)
        .join(', ')}.`,
      link: '/reorder',
      data: { count: suggestions.length, outOfStock: outOfStock.length },
    });
    return { suggestions: suggestions.length, outOfStock: outOfStock.length };
  }

  /** Factures échues : alerte à l'administrateur et relances aux clients (niveau atteint, une seule fois). */
  async overdueInvoices(today: string): Promise<JobResult> {
    const settings = await this.settings.all();
    const money = (v: number) =>
      formatMoney(v, {
        currency: settings['general.currency_code'],
        decimals: settings['general.currency_decimals'],
      });
    const overdue = await this.prisma.sale.findMany({
      where: {
        status: 'VALIDATED',
        amountDue: { gt: 0 },
        dueDate: { lt: new Date(`${today}T00:00:00Z`) },
        client: { isWalkIn: false },
      },
      select: {
        id: true,
        number: true,
        amountDue: true,
        dueDate: true,
        clientId: true,
        client: {
          select: {
            name: true,
            email: true,
            emailConsent: true,
            emailBounced: true,
            emailCc: true,
            emailDocPrefs: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
    if (overdue.length === 0) return { overdue: 0, reminders: 0 };
    const total = overdue.reduce((acc, s) => acc + num(s.amountDue), 0);
    const clients = new Set(overdue.map((s) => s.clientId)).size;
    await this.emitEvent({
      eventType: 'INVOICES_OVERDUE',
      severity: 'WARNING',
      actorId: null,
      title: `${overdue.length} facture(s) échue(s)`,
      body: `${clients} client(s), ${money(total)} à recouvrer.`,
      link: '/payments/aging',
      data: { count: overdue.length, total },
    });

    // Relances : niveau atteint = plus grand palier de retard dépassé (paramètre J+X, J+Y, J+Z).
    let reminders = 0;
    const mode = settings['email.auto_send'].DUNNING;
    if (mode === 'AUTO' && (await this.smtp.isOperational())) {
      const levels = [...settings['email.dunning_schedule_days']].sort((a, b) => a - b);
      const bcc = (await this.smtp.publicConfig()).bccArchive;
      for (const sale of overdue) {
        const client = sale.client;
        if (!client?.email || !client.emailConsent || client.emailBounced) continue;
        if (!isSafeEmail(client.email)) continue;
        if (((client.emailDocPrefs ?? {}) as Record<string, boolean>).DUNNING === false) continue;
        const late = diffDaysIso(sale.dueDate!.toISOString().slice(0, 10), today);
        let level = 0;
        levels.forEach((d, i) => {
          if (late >= d) level = i + 1;
        });
        if (level === 0) continue;
        const kind = `DUNNING_${Math.min(level, 3)}`;
        const already = await this.prisma.emailOutbox.count({
          where: {
            kind,
            relatedEntityType: 'sale',
            relatedEntityId: sale.id,
            status: { not: 'CANCELLED' },
          },
        });
        if (already > 0) continue;
        await this.prisma.tx(async (tx) => {
          await this.outbox.queue(tx, {
            kind,
            to: [client.email!],
            cc: client.emailCc,
            bcc: bcc ? [bcc] : [],
            templateKey: kind,
            payload: { message: '' },
            attachments: [{ entityType: 'sale', entityId: sale.id }],
            relatedEntityType: 'sale',
            relatedEntityId: sale.id,
            clientId: sale.clientId,
            createdById: null,
          });
        });
        reminders += 1;
      }
    }
    return { overdue: overdue.length, total, reminders };
  }

  /** Relevé du mois précédent, pour les clients avec adresse, consentement et mouvements. */
  async monthlyStatements(today: string): Promise<JobResult> {
    const settings = await this.settings.all();
    if (settings['email.auto_send'].STATEMENT !== 'AUTO' || !(await this.smtp.isOperational()))
      return { skipped: true, sent: 0 };
    const firstOfMonth = `${today.slice(0, 7)}-01`;
    const to = addDaysIso(firstOfMonth, -1);
    const from = `${to.slice(0, 7)}-01`;
    const clients = await this.prisma.client.findMany({
      where: {
        isWalkIn: false,
        isActive: true,
        email: { not: null },
        emailConsent: true,
        emailBounced: false,
      },
      select: { id: true, balance: true },
    });
    const tz = settings['general.timezone'];
    const start = zonedDateTimeToUtc(from, '00:00:00', tz);
    const end = zonedDateTimeToUtc(addDaysIso(to, 1), '00:00:00', tz);
    const active = new Set(
      (
        await this.prisma.clientLedger.groupBy({
          by: ['clientId'],
          where: { createdAt: { gte: start, lt: end } },
        })
      ).map((r) => r.clientId),
    );
    const system = { userId: null } as unknown as Actor;
    let sent = 0;
    for (const c of clients) {
      if (num(c.balance) === 0 && !active.has(c.id)) continue;
      const result = await this.prisma.tx((tx) =>
        this.outbox.queueDocument(tx, {
          kind: 'STATEMENT',
          entityType: 'statement',
          entityId: c.id,
          params: { from, to },
          relatedEntityType: 'client',
          relatedEntityId: c.id,
          clientId: c.id,
          manual: false,
          actor: system,
        }),
      );
      if (result.queued) sent += 1;
    }
    return { from, to, sent };
  }
}
