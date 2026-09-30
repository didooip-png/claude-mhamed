import { Injectable } from '@nestjs/common';
import {
  formatDateTime,
  formatIsoDate,
  formatMoney,
  type ReportCell,
  type ReportColumn,
  type ReportResult,
} from '@pharmastock/shared';
import type { Actor } from '../../common/request-context.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ExcelService, type ExcelColumn } from '../exports/excel.service.js';
import { SettingsService } from '../settings/settings.service.js';

const EXCEL_TYPE: Record<ReportColumn['type'], ExcelColumn['type']> = {
  text: 'text',
  int: 'qty',
  qty: 'qty',
  money: 'money',
  percent: 'percent',
  decimal: 'text',
  date: 'text',
  datetime: 'text',
};

/** Exports Excel et PDF d'un rapport (tracés au mouchard : DATA_EXPORTED). */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly excel: ExcelService,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
  ) {}

  private subtitle(report: ReportResult): string[] {
    const lines: string[] = [];
    if (report.from && report.to)
      lines.push(`Période : du ${formatIsoDate(report.from)} au ${formatIsoDate(report.to)}`);
    if (report.comparison)
      lines.push(
        `${report.comparison.label} : du ${formatIsoDate(report.comparison.from)} au ${formatIsoDate(report.comparison.to)}`,
      );
    return lines;
  }

  async xlsx(report: ReportResult, actor: Actor): Promise<Buffer> {
    const s = await this.settings.all();
    const convert = (c: ReportColumn, v: ReportCell): ReportCell => {
      if (v === null || v === undefined) return null;
      if (c.type === 'date' && typeof v === 'string') return formatIsoDate(v.slice(0, 10));
      if (c.type === 'datetime' && typeof v === 'string')
        return formatDateTime(new Date(v), s['general.timezone']);
      return v;
    };
    const rows = report.rows.map((r) =>
      Object.fromEntries(report.columns.map((c) => [c.key, convert(c, r[c.key] ?? null)])),
    );
    const totals = report.totals
      ? Object.fromEntries(
          report.columns.map((c) => [c.key, convert(c, report.totals![c.key] ?? null)]),
        )
      : undefined;
    const kpiLines = report.kpis.map((k) => `${k.label} : ${this.kpiText(k.value, k.type, s)}`);
    return this.excel.build(
      {
        title: report.title,
        subtitle: [...this.subtitle(report), ...kpiLines, ...report.notes],
        columns: report.columns.map((c) => ({
          key: c.key,
          header: c.header,
          type: EXCEL_TYPE[c.type],
          width: c.type === 'text' ? 28 : 16,
        })),
        rows,
        totals,
      },
      actor,
    );
  }

  private kpiText(
    value: number | null,
    type: 'money' | 'int' | 'percent' | 'decimal',
    s: Awaited<ReturnType<SettingsService['all']>>,
  ): string {
    if (value === null) return '—';
    if (type === 'money')
      return formatMoney(value, {
        currency: s['general.currency_code'],
        decimals: s['general.currency_decimals'],
      });
    if (type === 'percent') return `${(value / 100).toLocaleString('fr-FR')} %`;
    return value.toLocaleString('fr-FR');
  }

  async pdf(report: ReportResult, actor: Actor): Promise<Buffer> {
    const s = await this.settings.all();
    const money = (v: number) =>
      formatMoney(v, {
        currency: '',
        decimals: s['general.currency_decimals'],
      });
    const format = (c: ReportColumn, v: ReportCell): string | number | null => {
      if (v === null || v === undefined) return '';
      switch (c.type) {
        case 'money':
          return money(Number(v));
        case 'percent':
          return `${(Number(v) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
        case 'date':
          return typeof v === 'string' ? formatIsoDate(v.slice(0, 10)) : String(v);
        case 'datetime':
          return typeof v === 'string'
            ? formatDateTime(new Date(v), s['general.timezone'])
            : String(v);
        case 'int':
        case 'qty':
        case 'decimal':
          return typeof v === 'number' ? v.toLocaleString('fr-FR') : String(v);
        default:
          return String(v);
      }
    };
    const columns = report.columns.map((c) => ({
      key: c.key,
      header: c.header,
      align:
        c.type === 'text' || c.type === 'date' || c.type === 'datetime'
          ? ('left' as const)
          : ('right' as const),
    }));
    const rows = report.rows.map((r) =>
      Object.fromEntries(report.columns.map((c) => [c.key, format(c, r[c.key] ?? null)])),
    );
    if (report.totals) {
      rows.push(
        Object.fromEntries(
          report.columns.map((c) => [c.key, format(c, report.totals![c.key] ?? null)]),
        ),
      );
    }
    const kpis = report.kpis.map((k) => `${k.label} : ${this.kpiText(k.value, k.type, s)}`);
    return this.documents.tablePdf(
      {
        title: report.title,
        subtitle: [...this.subtitle(report), ...kpis, ...report.notes],
        columns,
        rows,
      },
      actor,
    );
  }
}
