import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  formatDateTime,
  isNotifiableEvent,
  localParts,
  NOTIFIABLE_EVENTS,
  startOfLocalDay,
  todayIso,
  type NotificationMode,
  type NotificationSchedule,
  type NotificationThresholds,
  type PaginationQuery,
  type SettingsMap,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { pageArgs } from '../../common/pagination.js';
import { loadConfig } from '../../config.js';
import type { NotificationEvent, Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { EmailOutboxService, isSafeEmail } from '../email/outbox.service.js';
import { SmtpService } from '../email/smtp.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface Recipient {
  id: string;
  code: string;
  email: string | null;
  subscriptions: Map<
    string,
    {
      mode: NotificationMode;
      watchedUserIds: string[];
      thresholds: NotificationThresholds;
      outsideHoursOnly: boolean;
      schedule: NotificationSchedule;
    }
  >;
}

/** Fenêtre du regroupement anti-rafale (§6.19 B). */
const BURST_WINDOW_MS = 10 * 60_000;

/** Lien par défaut vers l'élément concerné. */
function defaultLink(entityType: string | null, entityId: string | null): string {
  if (entityType === 'sale' && entityId) return `/sales/${entityId}`;
  if (entityType === 'cash_session' && entityId) return `/cash/${entityId}`;
  if (entityType === 'receipt' && entityId) return `/receipts/${entityId}`;
  if (entityType === 'product' && entityId) return `/catalog/products/${entityId}`;
  if (entityType === 'client' && entityId) return `/clients/${entityId}`;
  return '/audit';
}

/** L'instant est-il hors des horaires d'ouverture ? */
export function isOutsideHours(
  at: Date,
  settings: Pick<SettingsMap, 'general.business_hours' | 'general.timezone'>,
): boolean {
  const p = localParts(at, settings['general.timezone']);
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const slots = settings['general.business_hours'][days[p.weekday]!];
  const minutes = p.hour * 60 + p.minute;
  return !slots.some((s) => {
    const [oh, om] = s.open.split(':').map(Number) as [number, number];
    const [ch, cm] = s.close.split(':').map(Number) as [number, number];
    return minutes >= oh * 60 + om && minutes < ch * 60 + cm;
  });
}

/**
 * Moteur de notifications (§6.14, §6.19 B) : les événements insérés dans `notification_events`
 * (dans la transaction de l'opération) sont distribués en arrière-plan aux abonnés, selon leur
 * mode (cloche, e-mail immédiat, résumés), les employés suivis, les seuils et les horaires.
 * Seuls les utilisateurs ayant la permission `notifications.email.receive` sont destinataires.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly outbox: EmailOutboxService,
    private readonly smtp: SmtpService,
    private readonly events: EventsService,
  ) {}

  @Interval('notifications', 5_000)
  async tick(): Promise<void> {
    if (loadConfig().DISABLE_SCHEDULER || this.running) return;
    this.running = true;
    try {
      await this.processPending();
    } catch (err) {
      this.logger.error({ err }, 'Traitement des notifications en échec');
    } finally {
      this.running = false;
    }
  }

  /** Traite les événements en attente (réservation FOR UPDATE SKIP LOCKED). */
  async processPending(limit = 100): Promise<number> {
    let total = 0;
    for (;;) {
      const processed = await this.prisma.tx(async (tx) => {
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT id FROM notification_events WHERE processed_at IS NULL ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;
        const events = await tx.notificationEvent.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          orderBy: { id: 'asc' },
        });
        const settings = await this.settings.all(tx);
        const recipients = await this.loadRecipients(tx);
        const smtpOk = await this.smtp.isOperational();
        for (const event of events) {
          await this.dispatch(tx, event, recipients, settings, smtpOk);
          await this.derivedAlerts(tx, event, settings);
        }
        await tx.notificationEvent.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { processedAt: now() },
        });
        return rows.length;
      });
      total += processed;
      if (processed < limit) return total;
    }
  }

  /** Utilisateurs actifs autorisés à recevoir les notifications, avec leurs abonnements. */
  async loadRecipients(tx: Tx): Promise<Recipient[]> {
    const users = await tx.user.findMany({
      // Le rôle administrateur système possède implicitement toutes les permissions.
      where: {
        isActive: true,
        OR: [
          { role: { systemKey: 'ADMIN' } },
          { role: { permissions: { some: { permissionKey: 'notifications.email.receive' } } } },
        ],
      },
      select: { id: true, code: true, email: true, notificationEmail: true, subscriptions: true },
    });
    return users.map((u) => ({
      id: u.id,
      code: u.code,
      email: u.notificationEmail || u.email || null,
      subscriptions: new Map(
        u.subscriptions.map((s) => [
          s.eventType,
          {
            mode: s.mode,
            watchedUserIds: s.watchedUserIds,
            thresholds: (s.thresholds ?? {}) as NotificationThresholds,
            outsideHoursOnly: s.outsideHoursOnly,
            schedule: (s.schedule ?? {}) as NotificationSchedule,
          },
        ]),
      ),
    }));
  }

  private async dispatch(
    tx: Tx,
    event: NotificationEvent,
    recipients: Recipient[],
    settings: SettingsMap,
    smtpOk: boolean,
  ): Promise<void> {
    if (!isNotifiableEvent(event.eventType)) return;
    const def = NOTIFIABLE_EVENTS[event.eventType];
    const data = (event.data ?? {}) as Record<string, unknown>;
    const outside = isOutsideHours(event.createdAt, settings);
    const link = event.link ?? defaultLink(event.entityType, event.entityId);
    for (const r of recipients) {
      const sub = r.subscriptions.get(event.eventType);
      const mode = sub?.mode ?? def.defaultMode;
      if (mode === 'OFF') continue;
      if (
        def.employee &&
        sub &&
        sub.watchedUserIds.length > 0 &&
        (!event.actorId || !sub.watchedUserIds.includes(event.actorId))
      )
        continue;
      if (sub?.outsideHoursOnly && !outside) continue;
      const t = sub?.thresholds ?? {};
      const amount = typeof data.amount === 'number' ? Math.abs(data.amount) : null;
      if (def.threshold === 'amount' && t.minAmount && (amount === null || amount < t.minAmount))
        continue;
      const discount = typeof data.discountBp === 'number' ? data.discountBp : null;
      if (
        def.threshold === 'discount' &&
        t.minDiscountBp &&
        (discount === null || discount < t.minDiscountBp)
      )
        continue;

      await tx.notification.createMany({
        data: [
          {
            userId: r.id,
            type: event.eventType,
            severity: event.severity,
            title: event.title,
            body: event.body,
            entityType: event.entityType,
            entityId: event.entityId,
            link,
            dedupeKey: `evt:${event.id}`,
            createdAt: event.createdAt,
          },
        ],
        skipDuplicates: true,
      });
      if (mode === 'EMAIL_IMMEDIATE' && smtpOk && r.email && isSafeEmail(r.email)) {
        await this.immediateEmail(tx, event, r, link, settings, data);
      }
    }
  }

  private async immediateEmail(
    tx: Tx,
    event: NotificationEvent,
    r: Recipient,
    link: string,
    settings: SettingsMap,
    data: Record<string, unknown>,
  ) {
    const kind = `NOTIFICATION:${event.eventType}`;
    const base = loadConfig().APP_PUBLIC_URL.replace(/\/$/, '');
    // Regroupement anti-rafale : au-delà de N e-mails identiques en 10 minutes, un seul récapitulatif.
    const recent = await tx.emailOutbox.count({
      where: {
        kind: { in: [kind, `${kind}:BURST`] },
        to: { has: r.email!.toLowerCase() },
        createdAt: { gt: new Date(event.createdAt.getTime() - BURST_WINDOW_MS) },
      },
    });
    const burst = settings['alerts.burst_threshold'];
    if (recent > burst) return;
    const actor = [data.userCode, data.userName].filter(Boolean).join(' — ') || 'Système';
    const isRecap = recent === burst;
    await this.outbox.queue(tx, {
      kind: isRecap ? `${kind}:BURST` : kind,
      to: [r.email!],
      templateKey: 'ADMIN_NOTIFICATION',
      payload: {
        notification: isRecap
          ? {
              titre: `${event.title} — événements répétés`,
              detail: `Plus de ${burst} événements « ${event.title} » en moins de 10 minutes. Les suivants ne sont plus envoyés un par un pendant 10 minutes : consultez le centre de notifications.`,
              utilisateur: actor,
              date: formatDateTime(event.createdAt, settings['general.timezone']),
            }
          : {
              titre: event.title,
              detail: event.body ?? '',
              utilisateur: `${actor}${data.authorizedByCode ? ` (autorisé par ${String(data.authorizedByCode)})` : ''}`,
              date: formatDateTime(event.createdAt, settings['general.timezone']),
            },
        lien: `${base}${isRecap ? '/notifications' : link}`,
      },
      relatedEntityType: event.entityType,
      relatedEntityId: event.entityId,
      createdById: null,
    });
  }

  /** Alertes dérivées : trop d'annulations / de retraits de lignes par un utilisateur dans la journée (§6.14). */
  private async derivedAlerts(
    tx: Tx,
    event: NotificationEvent,
    settings: SettingsMap,
  ): Promise<void> {
    const rules: Record<string, { derived: string; max: number; label: string }> = {
      SALE_CANCELLED: {
        derived: 'EXCESSIVE_CANCELLATIONS',
        max: settings['alerts.max_cancellations_per_user_day'],
        label: 'annulations de ventes',
      },
      CART_LINE_REMOVED: {
        derived: 'EXCESSIVE_LINE_REMOVALS',
        max: settings['alerts.max_line_removals_per_user_day'],
        label: 'lignes retirées du panier',
      },
    };
    const rule = rules[event.eventType];
    if (!rule || !event.actorId) return;
    const tz = settings['general.timezone'];
    const day = todayIso(tz, event.createdAt);
    const count = await tx.auditLog.count({
      where: {
        eventType: event.eventType,
        userId: event.actorId,
        occurredAt: { gte: startOfLocalDay(day, tz), lte: event.createdAt },
      },
    });
    if (count !== rule.max + 1) return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    await this.events.emit(tx, {
      eventType: rule.derived,
      severity: 'WARNING',
      actorId: event.actorId,
      title: NOTIFIABLE_EVENTS[rule.derived as 'EXCESSIVE_CANCELLATIONS'].label,
      body: `${String(data.userCode ?? '')} a dépassé ${rule.max} ${rule.label} aujourd’hui (${count}).`,
      link: `/audit?userId=${event.actorId}&eventType=${event.eventType}&from=${day}`,
      data: { userCode: data.userCode, userName: data.userName, count },
    });
  }

  // -------------------------------------------------------------------------
  // Centre de notifications (cloche)
  // -------------------------------------------------------------------------

  async list(
    userId: string,
    q: Pick<PaginationQuery, 'page' | 'pageSize'> & { unreadOnly?: boolean },
  ) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(q.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, unread };
  }

  async unreadCount(userId: string) {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async markRead(userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: now() },
    });
    if (
      result.count === 0 &&
      !(await this.prisma.notification.findFirst({ where: { id, userId }, select: { id: true } }))
    ) {
      throw new AppError('NOT_FOUND');
    }
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now() },
    });
  }
}
