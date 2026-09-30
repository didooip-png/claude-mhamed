import { Injectable } from '@nestjs/common';
import { formatDateTime } from '@pharmastock/shared';
import ExcelJS from 'exceljs';
import { now } from '../../common/clock.js';
import type { Actor } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface ExcelColumn {
  key: string;
  header: string;
  width?: number;
  /** money : millimes → dinars (3 décimales) ; qty : entier ; date / datetime : texte formaté. */
  type?: 'text' | 'money' | 'qty' | 'percent';
}

export interface ExcelReport {
  title: string;
  /** Lignes d'en-tête (produit, période, filtres…). */
  subtitle?: string[];
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  sheetName?: string;
}

/**
 * Exports Excel (§6.15) : en-tête avec l'établissement, la date d'édition et l'utilisateur,
 * montants en dinars à 3 décimales. Chaque export est tracé au mouchard (DATA_EXPORTED).
 */
@Injectable()
export class ExcelService {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async build(report: ExcelReport, actor: Actor): Promise<Buffer> {
    const settings = await this.settings.all();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PharmaStock';
    wb.created = now();
    const ws = wb.addWorksheet(
      (report.sheetName ?? report.title).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '),
    );
    const header = [
      settings['establishment.name'],
      report.title,
      ...(report.subtitle ?? []),
      `Édité le ${formatDateTime(now(), settings['general.timezone'])} par ${actor.userCode} — ${actor.userName}`,
    ];
    header.forEach((line, i) => {
      const row = ws.addRow([line]);
      row.font =
        i === 0
          ? { bold: true, size: 13 }
          : i === 1
            ? { bold: true, size: 12 }
            : { size: 10, color: { argb: 'FF555555' } };
    });
    ws.addRow([]);
    const headRow = ws.addRow(report.columns.map((c) => c.header));
    headRow.font = { bold: true };
    headRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2F1' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
    });
    const convert = (c: ExcelColumn, v: unknown) => {
      if (v === null || v === undefined) return '';
      if (c.type === 'money') return Number(v) / 1000;
      if (c.type === 'percent') return Number(v) / 10000;
      return v as ExcelJS.CellValue;
    };
    for (const r of report.rows) ws.addRow(report.columns.map((c) => convert(c, r[c.key])));
    if (report.totals) {
      const t = ws.addRow(report.columns.map((c) => convert(c, report.totals![c.key])));
      t.font = { bold: true };
    }
    report.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.max(10, Math.min(40, c.header.length + 4));
      if (c.type === 'money') col.numFmt = '#,##0.000';
      if (c.type === 'percent') col.numFmt = '0.00%';
      if (c.type === 'qty') col.numFmt = '#,##0';
    });
    ws.views = [{ state: 'frozen', ySplit: header.length + 2 }];
    await this.audit.recordStandalone({
      eventType: 'DATA_EXPORTED',
      actor,
      entityType: 'export',
      summary: `Export Excel : ${report.title}${report.subtitle?.length ? ` (${report.subtitle.join(' ; ')})` : ''} — ${report.rows.length} ligne(s)`,
      notify: false,
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
