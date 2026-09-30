import { Controller, Get } from '@nestjs/common';
import { CurrentActor } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { DashboardService } from './dashboard.service.js';

/** Tableau de bord : complet ou personnel selon les permissions de l'utilisateur. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentActor() actor: Actor) {
    return this.dashboard.get(actor);
  }
}
