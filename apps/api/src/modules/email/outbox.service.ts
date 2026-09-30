import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  EMAIL_DOCUMENT_KINDS,
  type EmailDocumentKind,
  type PaginationQuery,
} from '@pharmastock/shared';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { loadConfig } from '../../config.js';
import type { EmailStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EmailTemplatesService } from './email-templates.service.js';
import { SmtpService, smtpErrorMessage } from './smtp.service.js';

/** Délais de reprise après échec : 1 min, 5 min, 15 min, 1 h, 6 h (§6.19 E). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const emailSchema = z.email();

/** Adresse valide et sans injection d'en-têtes. */
export function isSafeEmail(value: string): boolean {
  return !/[\r\n,;<>]/.test(value) && emailSchema.safeParse(value).success;
}

export interface QueueInput {
  kind: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  templateKey: string;
  payload?: Record<string, unknown>;
  attachments?: { entityType: string; entityId: string; params?: Record<string, unknown> }[];
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  clientId?: string | null;
  createdById?: string | null;
}

const KIND_TEMPLATE: Record<EmailDocumentKind, string> = {
  INVOICE: 'INVOICE',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  CREDIT_NOTE: 'CREDIT_NOTE',
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT',
  STATEMENT: 'STATEMENT',
  DUNNING: 'DUNNING_1',
  PURCHASE_ORDER: 'INVOICE',
};

/**
 * File d'envoi transactionnelle (outbox, §6.19 E) : la demande est insérée dans la transaction
 * de l'opération métier ; un traitement en arrière-plan envoie, avec reprises et quota horaire.
 * Une panne SMTP ne bloque jamais une opération.
 */
@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly smtp: SmtpService,
    private readonly templates: EmailTemplatesService,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async queue(tx: Tx, input: QueueInput): Promise<string> {
    const clean = (list: string[] | undefined) => [
      ...new Set((list ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean)),
    ];
    const to = clean(input.to);
    const cc = clean(input.cc).filter((a) => !to.includes(a));
    const bcc = clean(input.bcc);
    for (const address of [...to, ...cc, ...bcc])
      if (!isSafeEmail(address)) throw new AppError('EMAIL_INVALID', { address });
    if (to.length === 0) throw new AppError('EMAIL_INVALID', { reason: 'Aucun destinataire' });
    const row = await tx.emailOutbox.create({
      data: {
        kind: input.kind,
        to,
        cc,
        bcc,
        templateKey: input.templateKey,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        attachmentRefs: (input.attachments ?? []) as unknown as Prisma.InputJsonValue,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        clientId: input.clientId ?? null,
        createdById: input.createdById ?? null,
        createdAt: now(),
        nextAttemptAt: now(),
      },
    });
    return row.id;
  }

  /**
   * Envoi d'un document à un client : automatique seulement si le client a une adresse, a donné
   * son consentement et souhaite ce type de document ; manuel possible après confirmation.
   */
  async queueDocument(
    tx: Tx,
    input: {
      kind: EmailDocumentKind;
      entityType: string;
      entityId: string;
      /** Paramètres du document (ex. période d'un relevé). */
      params?: Record<string, unknown>;
      /** Entité affichée dans le journal (par défaut : le document lui-même). */
      relatedEntityType?: string;
      relatedEntityId?: string;
      clientId: string;
      to?: string[];
      cc?: string[];
      message?: string;
      manual: boolean;
      actor: Actor;
    },
  ): Promise<{ queued: boolean; reason: string; outboxId?: string }> {
    const settings = await this.settings.all(tx);
    const mode = settings['email.auto_send'][input.kind];
    if (mode === 'DISABLED')
      return {
        queued: false,
        reason: `Envoi des documents « ${EMAIL_DOCUMENT_KINDS[input.kind]} » désactivé dans les paramètres.`,
      };
    if (!input.manual && mode !== 'AUTO')
      return { queued: false, reason: 'Envoi automatique désactivé pour ce document.' };
    if (!(await this.smtp.isOperational())) {
      return {
        queued: false,
        reason: 'E-mail non envoyé : le serveur SMTP n’est pas configuré, activé et testé.',
      };
    }
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client || client.isWalkIn)
      return { queued: false, reason: 'Aucun client à qui envoyer le document.' };
    const prefs = (client.emailDocPrefs ?? {}) as Record<string, boolean>;
    if (!input.manual) {
      if (!client.email || !client.emailConsent || client.emailBounced)
        return { queued: false, reason: 'Client sans adresse e-mail valide ou sans consentement.' };
      if (prefs[input.kind] === false)
        return { queued: false, reason: 'Le client ne souhaite pas recevoir ce type de document.' };
    }
    const to = input.to?.length ? input.to : client.email ? [client.email] : [];
    if (to.length === 0) return { queued: false, reason: 'Aucune adresse e-mail pour ce client.' };
    const smtp = await this.smtp.publicConfig();
    const outboxId = await this.queue(tx, {
      kind: input.kind,
      to,
      cc: input.cc ?? client.emailCc,
      bcc: smtp.bccArchive ? [smtp.bccArchive] : [],
      templateKey: KIND_TEMPLATE[input.kind],
      payload: { message: input.message ?? '' },
      attachments: [
        {
          entityType: input.entityType,
          entityId: input.entityId,
          ...(input.params ? { params: input.params } : {}),
        },
      ],
      relatedEntityType: input.relatedEntityType ?? input.entityType,
      relatedEntityId: input.relatedEntityId ?? input.entityId,
      clientId: client.id,
      createdById: input.actor.userId,
    });
    return { queued: true, reason: '', outboxId };
  }

  /**
   * Bouton « Envoyer par e-mail » / « Renvoyer » d'un document : destinataire, copie et message
   * modifiables ; sans consentement du client, l'envoi exige une confirmation explicite (§6.19 C).
   */
  async sendDocument(
    input: {
      entityType: 'sale' | 'credit_note' | 'payment' | 'statement';
      /** Vente, avoir, règlement ; pour un relevé : le client. */
      entityId: string;
      params?: Record<string, unknown>;
      to: string[];
      cc: string[];
      message?: string | null;
      confirmNoConsent: boolean;
    },
    actor: Actor,
  ): Promise<{ outboxId: string }> {
    if (!(await this.smtp.isOperational())) throw new AppError('EMAIL_DISABLED');
    return this.prisma.tx(async (tx) => {
      // Résout le document : client, nature, libellé et entité liée.
      let target: {
        clientId: string;
        kind: EmailDocumentKind;
        label: string;
        relatedType: string;
        relatedId: string;
      };
      if (input.entityType === 'sale') {
        const sale = await tx.sale.findUnique({
          where: { id: input.entityId },
          select: { id: true, number: true, status: true, clientId: true },
        });
        if (!sale?.number || !sale.clientId) throw new AppError('NOT_FOUND');
        target = {
          clientId: sale.clientId,
          kind: sale.status === 'CANCELLED' ? 'INVOICE_CANCELLED' : 'INVOICE',
          label: `Facture ${sale.number}`,
          relatedType: 'sale',
          relatedId: sale.id,
        };
      } else if (input.entityType === 'credit_note') {
        const note = await tx.creditNote.findUnique({
          where: { id: input.entityId },
          select: { id: true, number: true, clientId: true },
        });
        if (!note) throw new AppError('NOT_FOUND');
        target = {
          clientId: note.clientId,
          kind: 'CREDIT_NOTE',
          label: `Avoir ${note.number}`,
          relatedType: 'credit_note',
          relatedId: note.id,
        };
      } else if (input.entityType === 'payment') {
        const payment = await tx.payment.findUnique({
          where: { id: input.entityId },
          select: { id: true, number: true, clientId: true },
        });
        if (!payment) throw new AppError('NOT_FOUND');
        target = {
          clientId: payment.clientId,
          kind: 'PAYMENT_RECEIPT',
          label: `Reçu ${payment.number}`,
          relatedType: 'payment',
          relatedId: payment.id,
        };
      } else {
        target = {
          clientId: input.entityId,
          kind: 'STATEMENT',
          label: 'Relevé de compte',
          relatedType: 'client',
          relatedId: input.entityId,
        };
      }
      const client = await tx.client.findUnique({ where: { id: target.clientId } });
      if (!client) throw new AppError('NOT_FOUND');
      if (client.isWalkIn) {
        throw new AppError('EMAIL_INVALID', undefined, {
          message: 'Le client comptoir n’a pas d’adresse e-mail.',
        });
      }
      if (!client.emailConsent && !input.confirmNoConsent)
        throw new AppError('EMAIL_CONSENT_REQUIRED');
      const result = await this.queueDocument(tx, {
        kind: target.kind,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.params ? { params: input.params } : {}),
        relatedEntityType: target.relatedType,
        relatedEntityId: target.relatedId,
        clientId: client.id,
        to: input.to,
        cc: input.cc,
        message: input.message ?? undefined,
        manual: true,
        actor,
      });
      if (!result.queued || !result.outboxId) {
        throw new AppError('EMAIL_DISABLED', undefined, { message: result.reason });
      }
      await this.audit.record(tx, {
        eventType: 'EMAIL_SENT_MANUALLY',
        actor,
        entityType: target.relatedType,
        entityId: target.relatedId,
        entityRef: target.label,
        summary: `${target.label} envoyé par e-mail à ${input.to.join(', ')}${client.emailConsent ? '' : ' (sans consentement, envoi confirmé)'}`,
        notify: false,
      });
      return { outboxId: result.outboxId };
    });
  }

  // -------------------------------------------------------------------------
  // Traitement en arrière-plan
  // -------------------------------------------------------------------------

  @Interval('email-outbox', 30_000)
  async tick(): Promise<void> {
    if (loadConfig().DISABLE_SCHEDULER || this.running) return;
    this.running = true;
    try {
      await this.processBatch();
    } catch (err) {
      this.logger.error({ err }, 'Traitement de la file d’envoi en échec');
    } finally {
      this.running = false;
    }
  }

  /** Envoie un lot d'e-mails en attente (réservation FOR UPDATE SKIP LOCKED). */
  async processBatch(limit = 20): Promise<{ sent: number; failed: number }> {
    // Envois bloqués (processus interrompu) : remis en file après 10 minutes.
    await this.prisma
      .$executeRaw`UPDATE email_outbox SET status = 'QUEUED' WHERE status = 'SENDING' AND next_attempt_at < now() - interval '10 minutes'`;
    const smtp = await this.smtp.publicConfig();
    if (!smtp.operational) return { sent: 0, failed: 0 };
    const sentLastHour = await this.prisma.emailOutbox.count({
      where: { status: 'SENT', sentAt: { gt: new Date(Date.now() - 3_600_000) } },
    });
    const capacity = Math.min(limit, smtp.hourlyLimit - sentLastHour);
    if (capacity <= 0) return { sent: 0, failed: 0 };
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE email_outbox SET status = 'SENDING', attempts = attempts + 1, next_attempt_at = now()
      WHERE id IN (
        SELECT id FROM email_outbox WHERE status = 'QUEUED' AND next_attempt_at <= now()
        ORDER BY created_at LIMIT ${capacity} FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    let sent = 0;
    let failed = 0;
    if (claimed.length === 0) return { sent, failed };
    const { transporter, config } = await this.smtp.transporter();
    try {
      for (const { id } of claimed) {
        const row = await this.prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
        try {
          const vars: Record<string, unknown> = { ...(row.payload as Record<string, unknown>) };
          const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
          for (const ref of row.attachmentRefs as {
            entityType: string;
            entityId: string;
            params?: Record<string, unknown>;
          }[]) {
            Object.assign(
              vars,
              await this.documents.emailVariables(ref.entityType, ref.entityId, ref.params),
            );
            const pdf = await this.documents.pdfFor(ref.entityType, ref.entityId, ref.params);
            attachments.push({ ...pdf, contentType: 'application/pdf' });
          }
          const rendered = await this.templates.render(row.templateKey, vars);
          const info = await transporter.sendMail({
            from: { name: config.fromName || 'PharmaStock', address: config.fromEmail },
            replyTo: config.replyTo || undefined,
            to: row.to,
            cc: row.cc.length ? row.cc : undefined,
            bcc: row.bcc.length ? row.bcc : undefined,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            attachments,
          });
          await this.prisma.emailOutbox.update({
            where: { id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              providerMessageId: info.messageId,
              lastError: null,
              subject: rendered.subject,
            },
          });
          sent += 1;
        } catch (err) {
          failed += 1;
          await this.handleFailure(row, err);
        }
      }
    } finally {
      transporter.close();
    }
    return { sent, failed };
  }

  private async handleFailure(
    row: { id: string; attempts: number; clientId: string | null; to: string[]; kind: string },
    err: unknown,
  ): Promise<void> {
    const message = smtpErrorMessage(err);
    const code = (err as { responseCode?: number }).responseCode;
    const permanent = code === 550 || code === 551 || code === 553;
    const exhausted = row.attempts >= MAX_ATTEMPTS;
    if (permanent || exhausted) {
      await this.prisma.tx(async (tx) => {
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: 'FAILED', lastError: message },
        });
        if (permanent && row.clientId)
          await tx.client.update({ where: { id: row.clientId }, data: { emailBounced: true } });
        await this.events.emit(tx, {
          eventType: 'EMAIL_DELIVERY_FAILED',
          severity: 'WARNING',
          actorId: null,
          title: 'Échec d’envoi d’e-mail',
          body: `E-mail « ${row.kind} » à ${row.to.join(', ')} non envoyé après ${row.attempts} tentative(s) : ${message}`,
          entityType: 'email',
          entityId: row.id,
          link: '/admin/email-log',
        });
      });
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(row.attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
    await this.prisma.emailOutbox.update({
      where: { id: row.id },
      data: { status: 'QUEUED', lastError: message, nextAttemptAt: new Date(Date.now() + delay) },
    });
  }

  // -------------------------------------------------------------------------
  // Journal des e-mails
  // -------------------------------------------------------------------------

  async log(
    q: PaginationQuery & {
      status?: EmailStatus;
      kind?: string;
      clientId?: string;
      entityId?: string;
    },
  ) {
    const where: Prisma.EmailOutboxWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.entityId ? { relatedEntityId: q.entityId } : {}),
      ...(q.q
        ? {
            OR: [
              { subject: { contains: q.q, mode: 'insensitive' } },
              { to: { has: q.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.emailOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        omit: { payload: true },
      }),
      this.prisma.emailOutbox.count({ where }),
    ]);
    const idsOf = (type: string) =>
      items
        .filter((i) => i.relatedEntityType === type && i.relatedEntityId)
        .map((i) => i.relatedEntityId!);
    const [sales, notes, payments] = await Promise.all([
      this.prisma.sale.findMany({
        where: { id: { in: idsOf('sale') } },
        select: { id: true, number: true },
      }),
      this.prisma.creditNote.findMany({
        where: { id: { in: idsOf('credit_note') } },
        select: { id: true, number: true },
      }),
      this.prisma.payment.findMany({
        where: { id: { in: idsOf('payment') } },
        select: { id: true, number: true },
      }),
    ]);
    const numberOf = (type: string | null, id: string | null) =>
      (type === 'sale'
        ? sales
        : type === 'credit_note'
          ? notes
          : type === 'payment'
            ? payments
            : []
      ).find((x) => x.id === id)?.number ?? null;
    return paginated(
      items.map((i) => ({
        ...i,
        documentNumber: numberOf(i.relatedEntityType, i.relatedEntityId),
      })),
      total,
      q,
    );
  }

  async resend(id: string, actor: Actor) {
    const row = await this.prisma.emailOutbox.findUnique({ where: { id } });
    if (!row) throw new AppError('NOT_FOUND');
    if (!(await this.smtp.isOperational())) throw new AppError('EMAIL_DISABLED');
    return this.prisma.tx(async (tx) => {
      const copyId = await this.queue(tx, {
        kind: row.kind,
        to: row.to,
        cc: row.cc,
        bcc: row.bcc,
        templateKey: row.templateKey,
        payload: row.payload as Record<string, unknown>,
        attachments: row.attachmentRefs as {
          entityType: string;
          entityId: string;
          params?: Record<string, unknown>;
        }[],
        relatedEntityType: row.relatedEntityType,
        relatedEntityId: row.relatedEntityId,
        clientId: row.clientId,
        createdById: actor.userId,
      });
      await this.audit.record(tx, {
        eventType: 'EMAIL_SENT_MANUALLY',
        actor,
        entityType: row.relatedEntityType ?? 'email',
        entityId: row.relatedEntityId ?? row.id,
        summary: `E-mail « ${row.kind} » renvoyé à ${row.to.join(', ')}`,
        notify: false,
      });
      return { id: copyId };
    });
  }

  async cancel(id: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: EmailStatus; kind: string; to: string[] }[]
      >`SELECT status, kind, "to" FROM email_outbox WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new AppError('NOT_FOUND');
      if (rows[0]!.status !== 'QUEUED')
        throw new AppError('CONFLICT', undefined, {
          message: 'Seul un e-mail en file peut être annulé.',
        });
      await tx.emailOutbox.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        eventType: 'EMAIL_CANCELLED',
        actor,
        entityType: 'email',
        entityId: id,
        summary: `Envoi de l’e-mail « ${rows[0]!.kind} » à ${rows[0]!.to.join(', ')} annulé`,
        notify: false,
      });
    });
  }
}
