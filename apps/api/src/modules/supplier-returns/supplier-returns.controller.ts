import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  cancelSupplierReturnSchema,
  createSupplierReturnSchema,
  supplierCreditSchema,
  supplierReturnListQuerySchema,
} from '@pharmastock/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { SupplierReturnsService } from './supplier-returns.service.js';

@Controller('supplier-returns')
export class SupplierReturnsController {
  constructor(private readonly returns: SupplierReturnsService) {}

  @RequirePermission('supplier_returns.manage')
  @Get()
  list(@ZQuery(supplierReturnListQuerySchema) q: z.infer<typeof supplierReturnListQuerySchema>) {
    return this.returns.list(q);
  }

  @RequirePermission('supplier_returns.manage')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.returns.get(id);
  }

  @RequirePermission('supplier_returns.manage')
  @Post()
  @HttpCode(201)
  create(
    @ZBody(createSupplierReturnSchema) body: z.output<typeof createSupplierReturnSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.returns.create(body, actor);
  }

  @RequirePermission('supplier_returns.manage')
  @Post(':id/credit')
  @HttpCode(200)
  credit(
    @IdParam() id: string,
    @ZBody(supplierCreditSchema) body: z.output<typeof supplierCreditSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.returns.recordCredit(id, body, actor);
  }

  @RequirePermission('supplier_returns.manage')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @IdParam() id: string,
    @ZBody(cancelSupplierReturnSchema) body: z.output<typeof cancelSupplierReturnSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.returns.cancel(id, body.reason, actor);
  }

  @RequirePermission('supplier_returns.manage')
  @Get(':id/print')
  async print(@IdParam() id: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const pdf = await this.returns.pdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="retour-fournisseur-${id.slice(0, 8)}.pdf"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }
}
