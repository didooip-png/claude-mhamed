import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { paginationSchema } from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZQuery } from '../../common/zod.js';
import { NotificationsService } from './notifications.service.js';

const listSchema = paginationSchema.extend({
  unreadOnly: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => v === '1'),
});

/** Centre de notifications (cloche) : chaque utilisateur ne voit que les siennes. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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
