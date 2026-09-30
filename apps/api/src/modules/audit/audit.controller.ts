import { Controller, Get, Post, Res } from '@nestjs/common';
import {
  AUDIT_EVENTS,
  AUDIT_EVENT_TYPES,
  paginationSchema,
  startOfLocalDay,
  endOfLocalDayExclusive,
  formatDateTime,
  isoDateSchema,
  SEVERITIES,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { ZQuery } from '../../common/zod.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ExcelService } from '../exports/excel.service.js';
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
    private readonly excel: ExcelService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('event-types')
  eventTypes() {
    return AUDIT_EVENT_TYPES.map((type) => ({ type, ...AUDIT_EVENTS[type] }));
  }

  private async where(
    q: Omit<AuditQuery, 'page' | 'pageSize'>,
  ): Promise<Prisma.AuditLogWhereInput> {
    const tz = await this.settings.get('general.timezone');
    return {
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
  }

  @Get()
  async list(@ZQuery(auditQuerySchema) q: AuditQuery) {
    const where = await this.where(q);
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  /** Export Excel ou PDF du journal filtré (l'export est lui-même tracé). */
  @Get('export')
  async export(
    @ZQuery(auditQuerySchema.extend({ format: z.enum(['xlsx', 'pdf']).default('xlsx') }))
    q: AuditQuery & { format: 'xlsx' | 'pdf' },
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    const where = await this.where(q);
    const tz = await this.settings.get('general.timezone');
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 20_000,
    });
    const subtitle = [
      `Période : ${q.from ?? 'début'} → ${q.to ?? 'aujourd’hui'}`,
      ...(q.eventType
        ? [
            `Événements : ${q.eventType.map((t) => AUDIT_EVENTS[t as keyof typeof AUDIT_EVENTS]?.label ?? t).join(', ')}`,
          ]
        : []),
      ...(q.q ? [`Recherche : ${q.q}`] : []),
    ];
    const data = rows.map((r) => ({
      date: formatDateTime(r.occurredAt, tz),
      severity: SEVERITIES[r.severity],
      event: AUDIT_EVENTS[r.eventType as keyof typeof AUDIT_EVENTS]?.label ?? r.eventType,
      summary: r.summary,
      user: r.userCode ? `${r.userCode}${r.userName ? ` — ${r.userName}` : ''}` : '',
      authorized: r.authorizedByCode ?? '',
      device: r.deviceName ?? '',
      ip: r.ip ?? '',
      ref: r.entityRef ?? '',
      reason: r.reason ?? '',
    }));
    const columns = [
      { key: 'date', header: 'Date et heure', width: 18 },
      { key: 'severity', header: 'Sévérité', width: 12 },
      { key: 'event', header: 'Événement', width: 28 },
      { key: 'summary', header: 'Résumé', width: 60 },
      { key: 'user', header: 'Utilisateur', width: 24 },
      { key: 'authorized', header: 'Autorisé par', width: 12 },
      { key: 'device', header: 'Poste', width: 16 },
      { key: 'ip', header: 'Adresse IP', width: 14 },
      { key: 'ref', header: 'Référence', width: 18 },
      { key: 'reason', header: 'Motif', width: 30 },
    ];
    if (q.format === 'pdf') {
      const pdf = await this.documents.tablePdf(
        {
          title: 'Mouchard — journal d’audit',
          subtitle,
          columns: columns
            .filter((c) => c.key !== 'ip')
            .map((c) => ({
              key: c.key,
              header: c.header,
              width: c.key === 'summary' ? ('*' as const) : ('auto' as const),
            })),
          rows: data,
        },
        actor,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="mouchard.pdf"');
      res.send(pdf);
      return;
    }
    const buffer = await this.excel.build(
      { title: 'Mouchard — journal d’audit', sheetName: 'Mouchard', subtitle, columns, rows: data },
      actor,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="mouchard.xlsx"');
    res.send(buffer);
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
