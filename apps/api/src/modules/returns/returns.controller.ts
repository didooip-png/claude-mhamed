import { Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common';
import {
  createReturnSchema,
  endOfLocalDayExclusive,
  reprintSchema,
  returnListSchema,
  startOfLocalDay,
  type CreateReturnData,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ReturnsService } from './returns.service.js';

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

@Controller('returns')
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly documents: DocumentsService,
    private readonly outbox: EmailOutboxService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermission('returns.create')
  @Get()
  async list(@ZQuery(returnListSchema) q: z.infer<typeof returnListSchema>) {
    const tz = await this.settings.get('general.timezone');
    return this.returns.list({
      ...q,
      from: q.from ? startOfLocalDay(q.from, tz) : undefined,
      to: q.to ? endOfLocalDayExclusive(q.to, tz) : undefined,
    });
  }

  /** Ce qui peut être retourné pour une vente : quantités, lots, règles applicables. */
  @RequirePermission('returns.create')
  @Get('sale/:saleId/returnable')
  returnable(@IdParam('saleId') saleId: string, @CurrentActor() actor: Actor) {
    return this.returns.returnable(saleId, actor);
  }

  @RequirePermission('returns.create')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.returns.get(id);
  }

  /** Création d'un retour (RG-23 : en-tête Idempotency-Key contre la double saisie). */
  @RequirePermission('returns.create')
  @Post()
  @HttpCode(201)
  async create(
    @ZBody(createReturnSchema) body: CreateReturnData,
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
    const { id, warnings } = await this.returns.create(body, key, actor);
    return { return: await this.returns.get(id), warnings };
  }

  /** Avoir (ou bon de retour) en A4 ou ticket 80 mm ; DUPLICATA dès la 2e impression. */
  @RequirePermission('returns.create')
  @Get(':id/print')
  async print(
    @IdParam() id: string,
    @ZQuery(reprintSchema) q: { format: 'TICKET' | 'A4' },
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    const pdf = await this.documents.printReturn(id, q.format, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="avoir-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  @RequirePermission('email.send_documents')
  @Post(':id/email')
  @HttpCode(200)
  async sendEmail(
    @IdParam() id: string,
    @ZBody(sendEmailSchema) body: z.output<typeof sendEmailSchema>,
    @CurrentActor() actor: Actor,
  ) {
    const ret = await this.prisma.customerReturn.findUnique({
      where: { id },
      select: { creditNote: { select: { id: true } } },
    });
    if (!ret?.creditNote)
      throw new AppError('NOT_FOUND', undefined, {
        message: 'Ce retour n’a pas d’avoir à envoyer.',
      });
    return this.outbox.sendDocument(
      { entityType: 'credit_note', entityId: ret.creditNote.id, ...body },
      actor,
    );
  }
}
