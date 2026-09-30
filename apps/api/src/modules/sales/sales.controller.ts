import { Controller, Delete, Get, Headers, HttpCode, Patch, Post, Put, Res } from '@nestjs/common';
import {
  addSaleLineSchema,
  cancelSaleSchema,
  createSaleSchema,
  globalDiscountSchema,
  isoDateSchema,
  millimesSchema,
  modifySaleSchema,
  paginationSchema,
  prescriptionSchema,
  reprintSchema,
  setSaleClientSchema,
  updateSaleLineSchema,
  validateSaleSchema,
  type CancelSaleInput,
  type ModifySaleInput,
  type OverrideInput,
  type PrescriptionInput,
  type UpdateSaleLineInput,
  type ValidateSaleInput,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { SalesQueriesService, type SalesListQuery } from './sales-queries.service.js';
import { SalesService } from './sales.service.js';

const listSchema = paginationSchema.extend({
  status: z.enum(['VALIDATED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
  clientId: z.uuid().optional(),
  userId: z.uuid().optional(),
  productId: z.uuid().optional(),
  deviceId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  minAmount: z.coerce.number().pipe(millimesSchema).optional(),
  maxAmount: z.coerce.number().pipe(millimesSchema).optional(),
});

const periodSchema = paginationSchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  userId: z.uuid().optional(),
});

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

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[\w-]+$/);

function sendPdf(res: Response, pdf: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}

@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly queries: SalesQueriesService,
    private readonly documents: DocumentsService,
    private readonly outbox: EmailOutboxService,
  ) {}

  // --- Historique ---------------------------------------------------------------

  @RequirePermission('sales.create')
  @Get()
  list(@ZQuery(listSchema) q: SalesListQuery, @CurrentActor() actor: Actor) {
    return this.queries.list(q, actor);
  }

  /** Panier en cours de l'utilisateur sur ce poste (reprise après coupure). */
  @RequirePermission('sales.create')
  @Get('draft')
  async draft(@CurrentActor() actor: Actor) {
    return { sale: await this.sales.currentDraft(actor) };
  }

  @RequirePermission('sales.hold')
  @Get('on-hold')
  onHold() {
    return this.sales.onHold();
  }

  /** Onglet « Ventes annulées » du mouchard. */
  @RequirePermission('audit.view')
  @Get('cancelled')
  cancelled(@ZQuery(periodSchema) q: z.infer<typeof periodSchema>) {
    return this.queries.cancelled(q);
  }

  /** Indicateurs par utilisateur (annulations, retraits de lignes…). */
  @RequirePermission('audit.view')
  @Get('indicators')
  indicators(@ZQuery(periodSchema) q: z.infer<typeof periodSchema>) {
    return this.queries.indicators(q);
  }

  @RequirePermission('sales.create')
  @Get(':id')
  async get(@IdParam() id: string, @CurrentActor() actor: Actor) {
    const sale = await this.sales.view(id, actor);
    const own = sale.createdBy?.id === actor.userId || sale.validatedBy?.id === actor.userId;
    if (!own && !actor.permissions.has('sales.view_all') && sale.status !== 'ON_HOLD')
      throw new AppError('NOT_FOUND');
    return sale;
  }

  @RequirePermission('sales.create')
  @Get(':id/emails')
  emails(@IdParam() id: string) {
    return this.queries.emails(id);
  }

  // --- Panier ---------------------------------------------------------------------

  @RequirePermission('sales.create')
  @Post()
  create(
    @ZBody(createSaleSchema) body: z.output<typeof createSaleSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.create(actor, body.clientId ?? null);
  }

  @RequirePermission('sales.create')
  @Put(':id/client')
  setClient(
    @IdParam() id: string,
    @ZBody(setSaleClientSchema) body: { clientId: string | null },
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.setClient(id, body.clientId, actor);
  }

  @RequirePermission('sales.create')
  @Post(':id/lines')
  addLine(
    @IdParam() id: string,
    @ZBody(addSaleLineSchema) body: z.output<typeof addSaleLineSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.addLine(id, body, actor);
  }

  @RequirePermission('sales.create')
  @Patch(':id/lines/:lineId')
  updateLine(
    @IdParam() id: string,
    @IdParam('lineId') lineId: string,
    @ZBody(updateSaleLineSchema) body: UpdateSaleLineInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.updateLine(id, lineId, body, actor);
  }

  @RequirePermission('sales.create')
  @Delete(':id/lines/:lineId')
  removeLine(
    @IdParam() id: string,
    @IdParam('lineId') lineId: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.removeLine(id, lineId, actor);
  }

  @RequirePermission('sales.create')
  @Put(':id/discount')
  setDiscount(
    @IdParam() id: string,
    @ZBody(globalDiscountSchema) body: { discountBp: number; override?: OverrideInput },
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.setGlobalDiscount(id, body.discountBp, body.override, actor);
  }

  @RequirePermission('sales.create')
  @Put(':id/prescription')
  setPrescription(
    @IdParam() id: string,
    @ZBody(prescriptionSchema) body: PrescriptionInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.setPrescription(id, body, actor);
  }

  @RequirePermission('sales.hold')
  @Post(':id/hold')
  @HttpCode(200)
  hold(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.sales.hold(id, actor);
  }

  @RequirePermission('sales.hold')
  @Post(':id/resume')
  @HttpCode(200)
  resume(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.sales.resume(id, actor);
  }

  @RequirePermission('sales.create')
  @Post(':id/discard')
  @HttpCode(200)
  discard(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.sales.discard(id, actor);
  }

  /** Validation (RG-23 : en-tête Idempotency-Key contre la double validation). */
  @RequirePermission('sales.create')
  @Post(':id/validate')
  @HttpCode(200)
  validate(
    @IdParam() id: string,
    @ZBody(validateSaleSchema) body: ValidateSaleInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    let key: string | undefined;
    if (idempotencyKey !== undefined) {
      const parsed = idempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsed.success)
        throw new AppError('VALIDATION_ERROR', {
          fieldErrors: { 'Idempotency-Key': 'Clé d’idempotence invalide' },
        });
      key = parsed.data;
    }
    return this.sales.validate(id, body, key, actor);
  }

  // --- Annulation / modification (administrateur) --------------------------------

  @RequirePermission('sales.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @IdParam() id: string,
    @ZBody(cancelSaleSchema) body: CancelSaleInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.cancel(id, body, actor);
  }

  @RequirePermission('sales.modify')
  @Post(':id/modify')
  @HttpCode(200)
  modify(
    @IdParam() id: string,
    @ZBody(modifySaleSchema) body: ModifySaleInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.modify(id, body, actor);
  }

  // --- Documents ------------------------------------------------------------------

  /** Facture A4 ou ticket 80 mm (à partir de la 2e impression : DUPLICATA, tracé). */
  @RequirePermission('sales.create')
  @Get(':id/print')
  async print(
    @IdParam() id: string,
    @ZQuery(reprintSchema) q: { format: 'TICKET' | 'A4' },
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    const pdf = await this.documents.printSale(id, q.format, actor);
    sendPdf(res, pdf, `${q.format === 'TICKET' ? 'ticket' : 'facture'}-${id.slice(0, 8)}.pdf`);
  }

  @RequirePermission('email.send_documents')
  @Post(':id/email')
  @HttpCode(200)
  sendEmail(
    @IdParam() id: string,
    @ZBody(sendEmailSchema) body: z.output<typeof sendEmailSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.outbox.sendDocument({ entityType: 'sale', entityId: id, ...body }, actor);
  }
}
