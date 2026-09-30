import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  isoDateSchema,
  notificationPreferencesSchema,
  paginationSchema,
  todayIso,
  type NotificationPreferencesInput,
} from '@pharmastock/shared';
import { z } from 'zod';
import { now } from '../../common/clock.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { SettingsService } from '../settings/settings.service.js';
import { ActivityReportService } from './activity-report.service.js';
import { NotificationsService } from './notifications.service.js';
import { PreferencesService } from './preferences.service.js';

const listSchema = paginationSchema.extend({
  unreadOnly: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => v === '1'),
});

/** Centre de notifications (cloche) : chaque utilisateur ne voit que les siennes. */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: PreferencesService,
    private readonly activity: ActivityReportService,
    private readonly settings: SettingsService,
  ) {}

  /** « Mes notifications » : abonnements de l'utilisateur connecté. */
  @RequirePermission('notifications.email.receive')
  @Get('preferences')
  getPreferences(@CurrentActor() actor: Actor) {
    return this.preferences.get(actor);
  }

  @RequirePermission('notifications.email.receive')
  @Put('preferences')
  savePreferences(
    @ZBody(notificationPreferencesSchema) body: NotificationPreferencesInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.preferences.save(body, actor);
  }

  @RequirePermission('notifications.email.receive')
  @Post('preferences/reset')
  @HttpCode(200)
  resetPreferences(@CurrentActor() actor: Actor) {
    return this.preferences.reset(actor);
  }

  /** Rapport d'activité par employé pour un jour (consultable à l'écran). */
  @RequirePermission('audit.view')
  @Get('activity-report')
  async activityReport(@ZQuery(z.object({ date: isoDateSchema.optional() })) q: { date?: string }) {
    const tz = (await this.settings.all())['general.timezone'];
    return this.activity.build(q.date ?? todayIso(tz, now()));
  }

  @Get()
  list(@ZQuery(listSchema) q: z.infer<typeof listSchema>, @CurrentActor() actor: Actor) {
    return this.notifications.list(actor.userId, q);
  }

  @Get('unread-count')
  unread(@CurrentActor() actor: Actor) {
    return this.notifications.unreadCount(actor.userId);
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentActor() actor: Actor) {
    await this.notifications.markAllRead(actor.userId);
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.notifications.markRead(actor.userId, id);
    return { ok: true };
  }
}
