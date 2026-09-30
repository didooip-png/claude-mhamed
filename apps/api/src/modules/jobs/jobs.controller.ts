import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { JobsService } from './jobs.service.js';

/** Tâches planifiées : état, historique et lancement à la demande (administrateur). */
@Controller('admin/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @RequirePermission('admin.settings')
  @Get()
  status() {
    return this.jobs.status();
  }

  @RequirePermission('admin.settings')
  @Post(':name/run')
  @HttpCode(200)
  async run(@Param('name') name: string, @CurrentActor() actor: Actor) {
    const result = await this.jobs.runNow(name, actor);
    if (!result) throw new AppError('NOT_FOUND');
    return result;
  }
}
