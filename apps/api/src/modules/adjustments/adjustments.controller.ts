import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  adjustmentListQuerySchema,
  createAdjustmentSchema,
  rejectAdjustmentSchema,
} from '@pharmastock/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { AdjustmentsService } from './adjustments.service.js';

@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @RequirePermission('adjustments.create')
  @Get()
  list(
    @ZQuery(adjustmentListQuerySchema) q: z.infer<typeof adjustmentListQuerySchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.adjustments.list(q, actor);
  }

  @RequirePermission('adjustments.create')
  @Get(':id')
  get(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.adjustments.get(id, actor);
  }

  @RequirePermission('adjustments.create')
  @Post()
  @HttpCode(201)
  create(
    @ZBody(createAdjustmentSchema) body: z.output<typeof createAdjustmentSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.adjustments.create(body, actor);
  }

  @RequirePermission('adjustments.validate')
  @Post(':id/validate')
  @HttpCode(200)
  validate(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.adjustments.validate(id, actor);
  }

  @RequirePermission('adjustments.validate')
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @IdParam() id: string,
    @ZBody(rejectAdjustmentSchema) body: z.output<typeof rejectAdjustmentSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.adjustments.reject(id, body.reason, actor);
  }

  @RequirePermission('adjustments.create')
  @Get(':id/print')
  async print(@IdParam() id: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const pdf = await this.adjustments.pdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ajustement-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }
}
