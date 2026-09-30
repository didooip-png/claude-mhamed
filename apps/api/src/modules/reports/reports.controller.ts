import { Controller, Get, Param, Res } from '@nestjs/common';
import {
  isReportId,
  REPORT_GROUPS,
  REPORTS,
  reportQuerySchema,
  type ReportQuery,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { AppError } from '../../common/app-error.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { ZQuery } from '../../common/zod.js';
import { ReportExportService } from './report-export.service.js';
import { ReportsService } from './reports.service.js';

/** Statistiques et rapports (§6.15) : affichage, export Excel et PDF. */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ReportExportService,
  ) {}

  /** Catalogue des rapports disponibles. */
  @RequirePermission('reports.view')
  @Get()
  catalog() {
    return {
      groups: REPORT_GROUPS,
      reports: Object.entries(REPORTS).map(([id, r]) => ({ id, ...r })),
    };
  }

  @RequirePermission('reports.view')
  @Get(':id')
  async run(
    @Param('id') id: string,
    @ZQuery(reportQuerySchema) query: ReportQuery,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    if (!isReportId(id)) throw new AppError('NOT_FOUND');
    const report = await this.reports.run(id, query);
    res.setHeader('Cache-Control', 'no-store');
    if (query.format === 'xlsx') {
      const file = await this.exporter.xlsx(report, actor);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${id}.xlsx"`);
      res.send(file);
      return;
    }
    if (query.format === 'pdf') {
      const file = await this.exporter.pdf(report, actor);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${id}.pdf"`);
      res.send(file);
      return;
    }
    res.json(report);
  }
}
