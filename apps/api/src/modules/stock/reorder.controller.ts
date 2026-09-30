import { Controller, Get } from '@nestjs/common';
import { idSchema } from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { ZQuery } from '../../common/zod.js';
import { ReorderService } from './reorder.service.js';

/** Suggestions de réapprovisionnement (stock max, consommation moyenne, délai fournisseur). */
@Controller('reorder-suggestions')
export class ReorderController {
  constructor(private readonly reorder: ReorderService) {}

  @RequirePermission('receipts.create')
  @Get()
  async list(
    @ZQuery(z.object({ supplierId: idSchema.optional() })) q: { supplierId?: string },
    @CurrentActor() actor: Actor,
  ) {
    const items = await this.reorder.suggestions(actor, q);
    return { items, total: items.length };
  }
}
