import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  createInventorySchema,
  inventoryAddLotSchema,
  inventoryCountSchema,
  inventoryLinesQuerySchema,
  inventoryListQuerySchema,
  reasonSchema,
  validateInventorySchema,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { InventoryService } from './inventory.service.js';

const reportQuerySchema = z.object({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  differencesOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

@Controller('inventories')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermission('inventory.count')
  @Get()
  list(@ZQuery(inventoryListQuerySchema) q: z.infer<typeof inventoryListQuerySchema>) {
    return this.inventory.list(q);
  }

  @RequirePermission('inventory.count')
  @Get(':id')
  get(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.inventory.get(id, actor);
  }

  @RequirePermission('inventory.count')
  @Get(':id/lines')
  lines(
    @IdParam() id: string,
    @ZQuery(inventoryLinesQuerySchema) q: z.infer<typeof inventoryLinesQuerySchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.inventory.lines(id, q, actor);
  }

  @RequirePermission('inventory.manage')
  @Post()
  @HttpCode(201)
  open(
    @ZBody(createInventorySchema) body: z.output<typeof createInventorySchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.inventory.open(body, actor);
  }

  @RequirePermission('inventory.count')
  @Post(':id/count')
  @HttpCode(200)
  count(
    @IdParam() id: string,
    @ZBody(inventoryCountSchema) body: z.output<typeof inventoryCountSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.inventory.count(id, body.counts, actor);
  }

  @RequirePermission('inventory.count')
  @Post(':id/lots')
  @HttpCode(201)
  addLot(
    @IdParam() id: string,
    @ZBody(inventoryAddLotSchema) body: z.output<typeof inventoryAddLotSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.inventory.addLot(id, body, actor);
  }

  @RequirePermission('inventory.count')
  @Post(':id/finish')
  @HttpCode(200)
  finish(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.inventory.finishCounting(id, actor);
  }

  @RequirePermission('inventory.manage')
  @Post(':id/validate')
  @HttpCode(200)
  validate(
    @IdParam() id: string,
    @ZBody(validateInventorySchema) body: z.output<typeof validateInventorySchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.inventory.validate(id, body, actor);
  }

  @RequirePermission('inventory.manage')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @IdParam() id: string,
    @ZBody(z.object({ reason: reasonSchema })) body: { reason: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.inventory.cancel(id, body.reason, actor);
  }

  @RequirePermission('inventory.manage')
  @Get(':id/report')
  async report(
    @IdParam() id: string,
    @ZQuery(reportQuerySchema) q: z.output<typeof reportQuerySchema>,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    if (q.format === 'pdf') {
      const pdf = await this.inventory.reportPdf(id, q.differencesOnly, actor);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="inventaire-${id.slice(0, 8)}.pdf"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(pdf);
      return;
    }
    const xlsx = await this.inventory.reportExcel(id, q.differencesOnly, actor);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="inventaire-${id.slice(0, 8)}.xlsx"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(xlsx);
  }
}
