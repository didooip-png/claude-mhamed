import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { executeRecallSchema, recallLookupSchema } from '@pharmastock/shared';
import type { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { ZBody, ZQuery } from '../../common/zod.js';
import { RecallService } from './recall.service.js';

@Controller('recalls')
export class RecallController {
  constructor(private readonly recall: RecallService) {}

  /** Lots portant ce numéro, stock restant et clients concernés. */
  @RequirePermission('lots.manage')
  @Get()
  lookup(@ZQuery(recallLookupSchema) q: z.infer<typeof recallLookupSchema>) {
    return this.recall.lookup(q.lotNumber, q.productId);
  }

  @RequirePermission('lots.manage')
  @Post()
  @HttpCode(200)
  execute(
    @ZBody(executeRecallSchema) body: z.output<typeof executeRecallSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.recall.execute(body, actor);
  }
}
