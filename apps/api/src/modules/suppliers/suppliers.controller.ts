import { Controller, Get, Post, Put } from '@nestjs/common';
import { paginationSchema, supplierSchema } from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { SuppliersService } from './suppliers.service.js';

const listSchema = paginationSchema.extend({ active: z.enum(['true', 'false', 'all']).optional() });

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @RequirePermission('suppliers.view')
  @Get()
  list(@ZQuery(listSchema) q: z.infer<typeof listSchema>) {
    return this.suppliers.list(q);
  }

  /** Liste courte des fournisseurs actifs (sélecteurs). */
  @RequirePermission('receipts.create')
  @Get('options')
  options() {
    return this.suppliers.options();
  }

  @RequirePermission('suppliers.view')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.suppliers.get(id);
  }

  @RequirePermission('suppliers.manage')
  @Post()
  create(
    @ZBody(supplierSchema) body: z.output<typeof supplierSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.suppliers.create(body, actor);
  }

  @RequirePermission('suppliers.manage')
  @Put(':id')
  update(
    @IdParam() id: string,
    @ZBody(supplierSchema) body: z.output<typeof supplierSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.suppliers.update(id, body, actor);
  }
}
