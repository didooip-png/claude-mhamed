import { Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common';
import {
  agingQuerySchema,
  cancelPaymentSchema,
  chequeListSchema,
  chequeStatusSchema,
  endOfLocalDayExclusive,
  paymentListSchema,
  recordPaymentSchema,
  reprintSchema,
  startOfLocalDay,
  type RecordPaymentData,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PaymentsService } from './payments.service.js';

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[\w-]+$/);

const sendEmailSchema = z.object({
  to: z
    .array(z.email({ error: 'E-mail invalide' }))
    .min(1)
    .max(5),
  cc: z
    .array(z.email({ error: 'E-mail invalide' }))
    .max(5)
    .default([]),
  message: z.string().trim().max(1000).nullish(),
  confirmNoConsent: z.boolean().default(false),
});

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly documents: DocumentsService,
    private readonly outbox: EmailOutboxService,
    private readonly settings: SettingsService,
  ) {}

  private async period(from?: string, to?: string) {
    const tz = await this.settings.get('general.timezone');
    return {
      from: from ? startOfLocalDay(from, tz) : undefined,
      to: to ? endOfLocalDayExclusive(to, tz) : undefined,
    };
  }

  @RequirePermission('payments.create')
  @Get()
  async list(@ZQuery(paymentListSchema) q: z.output<typeof paymentListSchema>) {
    return this.payments.list({ ...q, ...(await this.period(q.from, q.to)) });
  }

  /** Chèques et traites en portefeuille, par date d'échéance. */
  @RequirePermission('payments.create')
  @Get('cheques')
  async cheques(@ZQuery(chequeListSchema) q: z.output<typeof chequeListSchema>) {
    // Les échéances sont des dates calendaires (sans heure).
    return this.payments.cheques({
      ...q,
      from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
      to: q.to ? new Date(`${q.to}T00:00:00Z`) : undefined,
    });
  }

  /** Balance âgée : créances par client en tranches 0–30, 31–60, 61–90, > 90 jours. */
  @RequirePermission('payments.create')
  @Get('aging')
  aging(@ZQuery(agingQuerySchema) q: { asOf?: string }) {
    return this.payments.aging(q.asOf);
  }

  @RequirePermission('payments.create')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.payments.get(id);
  }

  /** Encaissement avec lettrage automatique, manuel ou acompte (RG-23 : Idempotency-Key). */
  @RequirePermission('payments.create')
  @Post()
  @HttpCode(201)
  async record(
    @ZBody(recordPaymentSchema) body: RecordPaymentData,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    let key: string | undefined;
    if (idempotencyKey !== undefined) {
      const parsed = idempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', {
          fieldErrors: { 'Idempotency-Key': 'Clé d’idempotence invalide' },
        });
      }
      key = parsed.data;
    }
    const { id, warnings } = await this.payments.record(body, key, actor);
    return { payment: await this.payments.get(id), warnings };
  }

  @RequirePermission('payments.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @IdParam() id: string,
    @ZBody(cancelPaymentSchema) body: { reason: string },
    @CurrentActor() actor: Actor,
  ) {
    await this.payments.cancel(id, body.reason, actor);
    return this.payments.get(id);
  }

  @RequirePermission('payments.cancel')
  @Post(':id/bounce')
  @HttpCode(200)
  async bounce(
    @IdParam() id: string,
    @ZBody(cancelPaymentSchema) body: { reason: string },
    @CurrentActor() actor: Actor,
  ) {
    await this.payments.bounce(id, body.reason, actor);
    return this.payments.get(id);
  }

  @RequirePermission('payments.create')
  @Post(':id/cheque-status')
  @HttpCode(200)
  async chequeStatus(
    @IdParam() id: string,
    @ZBody(chequeStatusSchema) body: { status: 'DEPOSITED' | 'CASHED' },
    @CurrentActor() actor: Actor,
  ) {
    await this.payments.setChequeStatus(id, body.status, actor);
    return this.payments.get(id);
  }

  /** Reçu de règlement (ticket ou A4) ; DUPLICATA dès la 2e impression. */
  @RequirePermission('payments.create')
  @Get(':id/print')
  async print(
    @IdParam() id: string,
    @ZQuery(reprintSchema) q: { format: 'TICKET' | 'A4' },
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    const pdf = await this.documents.printReceipt(id, q.format, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="recu-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  @RequirePermission('email.send_documents')
  @Post(':id/email')
  @HttpCode(200)
  sendEmail(
    @IdParam() id: string,
    @ZBody(sendEmailSchema) body: z.output<typeof sendEmailSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.outbox.sendDocument({ entityType: 'payment', entityId: id, ...body }, actor);
  }
}
