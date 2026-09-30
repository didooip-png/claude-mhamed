import { Controller, Get, Post } from '@nestjs/common';
import {
  AUDIT_EVENTS,
  AUDIT_EVENT_TYPES,
  paginationSchema,
  startOfLocalDay,
  endOfLocalDayExclusive,
  isoDateSchema,
} from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { ZQuery } from '../../common/zod.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from './audit.service.js';

export const auditQuerySchema = paginationSchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  userId: z.uuid().optional(),
  eventType: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  deviceId: z.uuid().optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

@RequirePermission('audit.view')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get('event-types')
  eventTypes() {
    return AUDIT_EVENT_TYPES.map((type) => ({ type, ...AUDIT_EVENTS[type] }));
  }

  @Get()
  async list(@ZQuery(auditQuerySchema) q: AuditQuery) {
    const tz = await this.settings.get('general.timezone');
    const where: Prisma.AuditLogWhereInput = {
      ...(q.from || q.to
        ? {
            occurredAt: {
              ...(q.from ? { gte: startOfLocalDay(q.from, tz) } : {}),
              ...(q.to ? { lt: endOfLocalDayExclusive(q.to, tz) } : {}),
            },
          }
        : {}),
      ...(q.userId ? { OR: [{ userId: q.userId }, { authorizedById: q.userId }] } : {}),
      ...(q.eventType ? { eventType: { in: q.eventType } } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { entityRef: { contains: q.q, mode: 'insensitive' } },
                  { summary: { contains: q.q, mode: 'insensitive' } },
                  { userCode: { contains: q.q, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  /** Vérification complète de la chaîne de hash (RG-20). */
  @Post('verify')
  async verify(@CurrentActor() actor: Actor) {
    const report = await this.audit.verifyIntegrity();
    await this.audit.recordStandalone({
      eventType: report.ok ? 'AUDIT_INTEGRITY_CHECKED' : 'AUDIT_INTEGRITY_FAILED',
      actor,
      summary: report.ok
        ? `Intégrité du journal vérifiée : ${report.checked} entrées conformes`
        : `Intégrité du journal compromise à l’entrée n° ${report.brokenAtId} : ${report.reason}`,
      metadata: report,
      notify: report.ok ? false : undefined,
    });
    return report;
  }
}
