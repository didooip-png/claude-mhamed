import { Injectable } from '@nestjs/common';
import {
  allowedModes,
  DEFAULT_DIGEST_SCHEDULE,
  isNotifiableEvent,
  NOTIFIABLE_EVENTS,
  type NotifiableEventType,
  type NotificationMode,
  type NotificationPreferencesInput,
  type NotificationSchedule,
  type NotificationThresholds,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SmtpService } from '../email/smtp.service.js';

const EMAIL_MODES: NotificationMode[] = ['EMAIL_IMMEDIATE', 'EMAIL_DAILY', 'EMAIL_WEEKLY'];

/**
 * Page « Mes notifications » (§6.19 B) : chaque destinataire choisit, pour chaque événement, un
 * mode (désactivé, cloche, e-mail immédiat, résumé quotidien / hebdomadaire), les employés
 * suivis, les seuils et l'heure des résumés. Les alertes critiques du système restent toujours
 * reçues par e-mail par au moins un administrateur.
 */
@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly smtp: SmtpService,
  ) {}

  async get(actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { email: true, notificationEmail: true, subscriptions: true },
    });
    const subs = new Map(user.subscriptions.map((s) => [s.eventType, s]));
    const events = (
      Object.entries(NOTIFIABLE_EVENTS) as [
        NotifiableEventType,
        (typeof NOTIFIABLE_EVENTS)[NotifiableEventType],
      ][]
    ).map(([eventType, def]) => {
      const sub = subs.get(eventType);
      const schedule = (sub?.schedule ?? {}) as NotificationSchedule;
      return {
        eventType,
        group: def.group,
        label: def.label,
        critical: !!def.critical,
        employee: !!def.employee,
        threshold: def.threshold ?? null,
        digestOnly: !!def.digestOnly,
        allowedModes: allowedModes(def),
        defaultMode: def.defaultMode,
        mode: sub?.mode ?? def.defaultMode,
        isCustom: !!sub,
        watchedUserIds: sub?.watchedUserIds ?? [],
        thresholds: (sub?.thresholds ?? {}) as NotificationThresholds,
        outsideHoursOnly: sub?.outsideHoursOnly ?? false,
        schedule: {
          hour: schedule.hour ?? DEFAULT_DIGEST_SCHEDULE.hour,
          minute: schedule.minute ?? DEFAULT_DIGEST_SCHEDULE.minute,
          weekday: schedule.weekday ?? DEFAULT_DIGEST_SCHEDULE.weekday,
        },
      };
    });
    return {
      accountEmail: user.email,
      notificationEmail: user.notificationEmail,
      smtpOperational: await this.smtp.isOperational(),
      events,
    };
  }

  async save(input: NotificationPreferencesInput, actor: Actor) {
    for (const sub of input.subscriptions) {
      if (!isNotifiableEvent(sub.eventType))
        throw new AppError('VALIDATION_ERROR', { fieldErrors: { eventType: sub.eventType } });
      const def = NOTIFIABLE_EVENTS[sub.eventType];
      if (!allowedModes(def).includes(sub.mode)) {
        throw new AppError('VALIDATION_ERROR', undefined, {
          message: `Mode « ${sub.mode} » indisponible pour « ${def.label} ».`,
        });
      }
    }
    await this.prisma.tx(async (tx) => {
      // Sérialise les changements d'abonnements (règle des alertes critiques).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7142003)`;
      await tx.user.update({
        where: { id: actor.userId },
        data: { notificationEmail: input.notificationEmail ?? null },
      });
      for (const sub of input.subscriptions) {
        const def = NOTIFIABLE_EVENTS[sub.eventType as NotifiableEventType];
        const data = {
          mode: sub.mode,
          // Employés suivis : uniquement pour les événements déclenchés par un employé.
          watchedUserIds: def.employee ? sub.watchedUserIds : [],
          thresholds: (def.threshold ? sub.thresholds : {}) as Prisma.InputJsonValue,
          outsideHoursOnly: sub.outsideHoursOnly,
          schedule: sub.schedule as Prisma.InputJsonValue,
        };
        await tx.notificationSubscription.upsert({
          where: { userId_eventType: { userId: actor.userId, eventType: sub.eventType } },
          create: { userId: actor.userId, eventType: sub.eventType, ...data },
          update: data,
        });
      }
      await this.assertCriticalCoverage(tx);
      await this.audit.record(tx, {
        eventType: 'NOTIFICATION_PREFERENCES_CHANGED',
        actor,
        entityType: 'user',
        entityId: actor.userId,
        entityRef: actor.userCode,
        summary: `${actor.userCode} a modifié ses notifications (${input.subscriptions.length} événement(s))`,
        after: {
          notificationEmail: input.notificationEmail,
          subscriptions: input.subscriptions.map((s) => ({ event: s.eventType, mode: s.mode })),
        },
        notify: false,
      });
    });
    return this.get(actor);
  }

  async reset(actor: Actor) {
    await this.prisma.tx(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7142003)`;
      await tx.notificationSubscription.deleteMany({ where: { userId: actor.userId } });
      await tx.user.update({ where: { id: actor.userId }, data: { notificationEmail: null } });
      await this.assertCriticalCoverage(tx);
      await this.audit.record(tx, {
        eventType: 'NOTIFICATION_PREFERENCES_CHANGED',
        actor,
        entityType: 'user',
        entityId: actor.userId,
        entityRef: actor.userCode,
        summary: `${actor.userCode} a rétabli ses notifications par défaut`,
        notify: false,
      });
    });
    return this.get(actor);
  }

  /**
   * Alertes critiques du système : au moins un destinataire actif
   * doit rester abonné par e-mail à chacune d'elles (§6.19 B).
   */
  private async assertCriticalCoverage(tx: Tx): Promise<void> {
    const recipients = await tx.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: { systemKey: 'ADMIN' } },
          { role: { permissions: { some: { permissionKey: 'notifications.email.receive' } } } },
        ],
      },
      select: { subscriptions: true },
    });
    const uncovered: string[] = [];
    for (const [eventType, def] of Object.entries(NOTIFIABLE_EVENTS)) {
      if (!def.critical) continue;
      const covered = recipients.some((u) => {
        const sub = u.subscriptions.find((s) => s.eventType === eventType);
        return EMAIL_MODES.includes(sub?.mode ?? def.defaultMode);
      });
      if (!covered) uncovered.push(def.label);
    }
    if (uncovered.length > 0) throw new AppError('CRITICAL_ALERTS_REQUIRED', { events: uncovered });
  }
}
