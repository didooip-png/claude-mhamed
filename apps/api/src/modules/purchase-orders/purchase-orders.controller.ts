import { Controller, Get, HttpCode, Post, Put, Res } from '@nestjs/common';
import {
  cancelPurchaseOrderSchema,
  ordersFromSuggestionsSchema,
  purchaseOrderListQuerySchema,
  purchaseOrderSchema,
  sendPurchaseOrderSchema,
  type PurchaseOrderInput,
} from '@pharmastock/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';

/** Commandes fournisseurs (§6.3). Consultation : réception ; gestion : administrateur. */
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @RequirePermission('receipts.create')
  @Get()
  list(@ZQuery(purchaseOrderListQuerySchema) q: z.infer<typeof purchaseOrderListQuerySchema>) {
    return this.orders.list(q);
  }

  @RequirePermission('receipts.create')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.orders.get(id);
  }

  @RequirePermission('orders.manage')
  @Post()
  @HttpCode(201)
  create(@ZBody(purchaseOrderSchema) body: PurchaseOrderInput, @CurrentActor() actor: Actor) {
    return this.orders.create(body, actor);
  }

  @RequirePermission('orders.manage')
  @Post('from-suggestions')
  @HttpCode(201)
  fromSuggestions(
    @ZBody(ordersFromSuggestionsSchema) body: z.output<typeof ordersFromSuggestionsSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.fromSuggestions(body, actor);
  }

  @RequirePermission('orders.manage')
  @Put(':id')
  update(@IdParam() id: string, @ZBody(purchaseOrderSchema) body: PurchaseOrderInput) {
    return this.orders.update(id, body);
  }

  @RequirePermission('orders.manage')
  @Post(':id/send')
  @HttpCode(200)
  send(
    @IdParam() id: string,
    @ZBody(sendPurchaseOrderSchema) body: z.output<typeof sendPurchaseOrderSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.send(id, body, actor);
  }

  @RequirePermission('orders.manage')
  @Post(':id/email')
  @HttpCode(200)
  email(
    @IdParam() id: string,
    @ZBody(sendPurchaseOrderSchema) body: z.output<typeof sendPurchaseOrderSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.resend(id, body, actor);
  }

  @RequirePermission('orders.manage')
  @Post(':id/close')
  @HttpCode(200)
  close(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.orders.close(id, actor);
  }

  @RequirePermission('orders.manage')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @IdParam() id: string,
    @ZBody(cancelPurchaseOrderSchema) body: z.output<typeof cancelPurchaseOrderSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.cancel(id, body.reason, actor);
  }

  @RequirePermission('receipts.create')
  @Get(':id/print')
  async print(@IdParam() id: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const pdf = await this.orders.pdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="commande-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }
}
