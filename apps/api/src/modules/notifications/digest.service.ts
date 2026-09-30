import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  addDaysIso,
  DEFAULT_DIGEST_SCHEDULE,
  formatDateTime,
  localParts,
  NOTIFIABLE_EVENTS,
  weekdayOf,
  zonedDateTimeToUtc,
  type NotifiableEventType,
  type NotificationMode,
} from '@pharmastock/shared';
import { now } from '../../common/clock.js';
import { loadConfig } from '../../config.js';
import type { DigestType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailOutboxService, isSafeEmail } from '../email/outbox.service.js';
import { SmtpService } from '../email/smtp.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ActivityReportService, escapeHtml } from './activity-report.service.js';
import { NotificationsService, type Recipient } from './notifications.service.js';

/** Un résumé manqué de plus de ce délai n'est plus envoyé (arrêt prolongé du serveur). */
const GRACE_MS = 6 * 3_600_000;
const MAX_ITEMS_PER_EVENT = 10;

interface Slot {
  type: DigestType;
  key: string;
  start: Date;
  end: Date;
  schedule: { hour: number; minute: number; weekday: number };
  eventTypes: NotifiableEventType[];
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Résumés quotidiens et hebdomadaires (§6.19 B) et rapport d'activité par employé. Chaque
 * abonnement « résumé » a une heure d'envoi (jour et heure pour l'hebdomadaire) ; un envoi est
 * enregistré dans `digest_runs` (unique par utilisateur, type et période) : jamais de doublon.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly outbox: EmailOutboxService,
    private readonly smtp: SmtpService,
    private readonly activity: ActivityReportService,
  ) {}

  @Interval('digests', 60_000)
  async tick(): Promise<void> {
    if (loadConfig().DISABLE_SCHEDULER || this.running) return;
    this.running = true;
    try {
      await this.runDue();
    } catch (err) {
      this.logger.error({ err }, 'Envoi des résumés en échec');
    } finally {
      this.running = false;
    }
  }

  /** Créneaux de résumé d'un utilisateur : un par (type, heure) parmi ses abonnements actifs. */
  private slotsFor(recipient: Recipient, at: Date, tz: string): Slot[] {
    const slots = new Map<string, Slot>();
    const local = localParts(at, tz);
    for (const [eventType, def] of Object.entries(NOTIFIABLE_EVENTS) as [
      NotifiableEventType,
      (typeof NOTIFIABLE_EVENTS)[NotifiableEventType],
    ][]) {
      const sub = recipient.subscriptions.get(eventType);
      const mode: NotificationMode = sub?.mode ?? def.defaultMode;
      if (mode !== 'EMAIL_DAILY' && mode !== 'EMAIL_WEEKLY') continue;
      const schedule = {
        hour: sub?.schedule.hour ?? DEFAULT_DIGEST_SCHEDULE.hour,
        minute: sub?.schedule.minute ?? DEFAULT_DIGEST_SCHEDULE.minute,
        weekday: sub?.schedule.weekday ?? DEFAULT_DIGEST_SCHEDULE.weekday,
      };
      const type: DigestType =
        eventType === 'ACTIVITY_REPORT' ? 'ACTIVITY' : mode === 'EMAIL_DAILY' ? 'DAILY' : 'WEEKLY';
      const time = `${two(schedule.hour)}:${two(schedule.minute)}`;
      const key = `${type}:${type === 'WEEKLY' ? schedule.weekday : '-'}:${time}`;
      const existing = slots.get(key);
      if (existing) {
        existing.eventTypes.push(eventType);
        continue;
      }
      // Dernier créneau échu : aujourd'hui à l'heure choisie, sinon la veille (ou le bon jour).
      let date = local.date;
      if (type === 'WEEKLY') {
        const back = (weekdayOf(local.date) - schedule.weekday + 7) % 7;
        date = addDaysIso(local.date, -back);
      }
      let end = zonedDateTimeToUtc(date, time, tz);
      if (end > at) {
        date = addDaysIso(date, type === 'WEEKLY' ? -7 : -1);
        end = zonedDateTimeToUtc(date, time, tz);
      }
      const start = zonedDateTimeToUtc(addDaysIso(date, type === 'WEEKLY' ? -7 : -1), time, tz);
      slots.set(key, { type, key, start, end, schedule, eventTypes: [eventType] });
    }
    return [...slots.values()];
  }

  /** Envoie les résumés échus (jamais deux fois pour la même période). */
  async runDue(at: Date = now()): Promise<{ sent: number; skipped: number }> {
    const settings = await this.settings.all();
    const tz = settings['general.timezone'];
    if (!(await this.smtp.isOperational())) return { sent: 0, skipped: 0 };
    const recipients = await this.prisma.tx((tx) => this.notifications.loadRecipients(tx));
    const base = loadConfig().APP_PUBLIC_URL.replace(/\/$/, '');
    let sent = 0;
    let skipped = 0;
    for (const recipient of recipients) {
      if (!recipient.email || !isSafeEmail(recipient.email)) continue;
      for (const slot of this.slotsFor(recipient, at, tz)) {
        if (at.getTime() - slot.end.getTime() > GRACE_MS) continue;
        const done = await this.prisma.digestRun.findUnique({
          where: {
            userId_digestType_periodStart: {
              userId: recipient.id,
              digestType: slot.type,
              periodStart: slot.start,
            },
          },
          select: { id: true },
        });
        if (done) continue;
        const content =
          slot.type === 'ACTIVITY'
            ? await this.activityContent(slot, tz, base)
            : await this.notificationsContent(recipient, slot, tz, base);
        if (content) {
          const outboxId = await this.prisma.tx(async (tx) => {
            // Réservation atomique de la période : un second processus n'envoie rien.
            const reserved = await tx.digestRun.createMany({
              data: [
                {
                  userId: recipient.id,
                  digestType: slot.type,
                  periodStart: slot.start,
                  periodEnd: slot.end,
                },
              ],
              skipDuplicates: true,
            });
            if (reserved.count === 0) return null;
            const id = await this.outbox.queue(tx, {
              kind: `DIGEST:${slot.type}`,
              to: [recipient.email!],
              templateKey: 'DIGEST',
              payload: {
                resume: { titre: content.title, contenu: content.html, texte: content.text },
                lien: `${base}/notifications`,
              },
              relatedEntityType: 'digest',
              createdById: null,
            });
            await tx.digestRun.update({
              where: {
                userId_digestType_periodStart: {
                  userId: recipient.id,
                  digestType: slot.type,
                  periodStart: slot.start,
                },
              },
              data: { outboxId: id },
            });
            return id;
          });
          if (outboxId) sent += 1;
          else skipped += 1;
        } else {
          // Rien à résumer : la période est enregistrée pour ne pas être recalculée.
          await this.prisma.digestRun.createMany({
            data: [
              {
                userId: recipient.id,
                digestType: slot.type,
                periodStart: slot.start,
                periodEnd: slot.end,
              },
            ],
            skipDuplicates: true,
          });
          skipped += 1;
        }
      }
    }
    return { sent, skipped };
  }

  private async activityContent(slot: Slot, tz: string, base: string) {
    // Créneau du soir : rapport du jour ; créneau du matin : rapport de la veille.
    const local = localParts(new Date(slot.end.getTime() - 60_000), tz);
    const date = slot.schedule.hour >= 12 ? local.date : addDaysIso(local.date, -1);
    const report = await this.activity.build(date);
    if (report.rows.length === 0) return null;
    return this.activity.render(report, base);
  }

  private async notificationsContent(recipient: Recipient, slot: Slot, tz: string, base: string) {
    const items = await this.prisma.notification.findMany({
      where: {
        userId: recipient.id,
        type: { in: slot.eventTypes },
        createdAt: { gte: slot.start, lt: slot.end },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (items.length === 0) return null;
    const byType = new Map<string, typeof items>();
    for (const n of items) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
    const label = (t: string) => NOTIFIABLE_EVENTS[t as NotifiableEventType]?.label ?? t;
    const htmlParts: string[] = [];
    const textParts: string[] = [];
    for (const [type, list] of byType) {
      const shown = list.slice(0, MAX_ITEMS_PER_EVENT);
      htmlParts.push(
        `<p><strong>${escapeHtml(label(type))}</strong> — ${list.length}</p><ul>${shown
          .map(
            (n) =>
              `<li><a href="${base}${n.link ?? '/notifications'}">${escapeHtml(n.title)}</a>${n.body ? ` — ${escapeHtml(n.body)}` : ''}</li>`,
          )
          .join(
            '',
          )}${list.length > shown.length ? `<li>… et ${list.length - shown.length} autre(s)</li>` : ''}</ul>`,
      );
      textParts.push(
        `${label(type)} — ${list.length}\n${shown.map((n) => `  - ${n.title}${n.body ? ` : ${n.body}` : ''}`).join('\n')}${list.length > shown.length ? `\n  … et ${list.length - shown.length} autre(s)` : ''}`,
      );
    }
    const period =
      slot.type === 'DAILY'
        ? `du ${formatDateTime(slot.start, tz)} au ${formatDateTime(slot.end, tz)}`
        : `de la semaine (${formatDateTime(slot.start, tz)} → ${formatDateTime(slot.end, tz)})`;
    return {
      title: `${slot.type === 'DAILY' ? 'Résumé quotidien' : 'Résumé hebdomadaire'} — ${items.length} notification(s)`,
      html: `<p>Notifications ${escapeHtml(period)} :</p>${htmlParts.join('')}`,
      text: `Notifications ${period} :\n\n${textParts.join('\n\n')}`,
    };
  }
}
