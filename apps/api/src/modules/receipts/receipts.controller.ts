import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  isoDateSchema,
  paginationSchema,
  reasonSchema,
  receiptSchema,
  validateReceiptSchema,
} from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { ReceiptsService } from './receipts.service.js';

const listSchema = paginationSchema.extend({
  status: z.enum(['DRAFT', 'VALIDATED', 'CANCELLED']).optional(),
  supplierId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @RequirePermission('receipts.create')
  @Get()
  list(@ZQuery(listSchema) q: z.infer<typeof listSchema>) {
    return this.receipts.list(q);
  }

  @RequirePermission('receipts.create')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.receipts.get(id);
  }

  @RequirePermission('receipts.create')
  @Post()
  create(@ZBody(receiptSchema) body: z.output<typeof receiptSchema>, @CurrentActor() actor: Actor) {
    return this.receipts.createDraft(body, actor);
  }

  @RequirePermission('receipts.create')
  @Put(':id')
  update(@IdParam() id: string, @ZBody(receiptSchema) body: z.output<typeof receiptSchema>) {
    return this.receipts.updateDraft(id, body);
  }

  @RequirePermission('receipts.create')
  @Delete(':id')
  @HttpCode(204)
  async discard(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.receipts.discardDraft(id, actor);
  }

  @RequirePermission('receipts.validate')
  @Post(':id/validate')
  @HttpCode(200)
  validate(
    @IdParam() id: string,
    @ZBody(validateReceiptSchema) body: z.output<typeof validateReceiptSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.receipts.validate(id, body, actor);
  }

  @RequirePermission('receipts.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @IdParam() id: string,
    @ZBody(z.object({ reason: reasonSchema })) body: { reason: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.receipts.cancel(id, body.reason, actor);
  }
}
