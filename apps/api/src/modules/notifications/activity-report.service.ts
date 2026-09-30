import { Injectable } from '@nestjs/common';
import {
  endOfLocalDayExclusive,
  formatDateTime,
  formatMoney,
  startOfLocalDay,
} from '@pharmastock/shared';
import { num } from '../../common/json.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface EmployeeActivity {
  userId: string;
  code: string;
  name: string;
  salesCount: number;
  salesTotal: number;
  discountTotal: number;
  discountOverLimit: number;
  returnsCount: number;
  returnsTotal: number;
  cancellations: number;
  lineRemovals: number;
  adminCodesUsed: number;
  cashDifference: number | null;
  firstAt: Date | null;
  lastAt: Date | null;
}

export interface ActivityReport {
  date: string;
  rows: EmployeeActivity[];
  totals: { salesCount: number; salesTotal: number; returnsTotal: number; cancellations: number };
}

export const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Rapport d'activité quotidien par employé (§6.19 B) : ventes, remises, retours, annulations,
 * lignes retirées, codes administrateur utilisés, écart de caisse, première et dernière opération.
 */
@Injectable()
export class ActivityReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async build(date: string): Promise<ActivityReport> {
    const tz = (await this.settings.all())['general.timezone'];
    const from = startOfLocalDay(date, tz);
    const to = endOfLocalDayExclusive(date, tz);
    const range = { gte: from, lt: to };

    const [sales, returns, audit, sessions, spans] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['createdById'],
        where: { status: 'VALIDATED', validatedAt: range },
        _count: { _all: true },
        _sum: { totalTtc: true, totalDiscount: true },
      }),
      this.prisma.customerReturn.groupBy({
        by: ['createdById'],
        where: { createdAt: range },
        _count: { _all: true },
        _sum: { totalTtc: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['userId', 'eventType'],
        where: {
          occurredAt: range,
          userId: { not: null },
          eventType: {
            in: ['SALE_CANCELLED', 'CART_LINE_REMOVED', 'DISCOUNT_OVER_LIMIT', 'ADMIN_OVERRIDE'],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.cashSession.groupBy({
        by: ['userId'],
        where: { closedAt: range, status: 'CLOSED' },
        _sum: { difference: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['userId'],
        where: { occurredAt: range, userId: { not: null } },
        _min: { occurredAt: true },
        _max: { occurredAt: true },
      }),
    ]);

    const ids = new Set<string>();
    for (const r of sales) ids.add(r.createdById);
    for (const r of returns) ids.add(r.createdById);
    for (const r of audit) if (r.userId) ids.add(r.userId);
    for (const r of sessions) ids.add(r.userId);
    for (const r of spans) if (r.userId) ids.add(r.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, fullName: true },
    });

    const count = (userId: string, type: string) =>
      audit.find((a) => a.userId === userId && a.eventType === type)?._count._all ?? 0;
    const rows = users
      .map((u): EmployeeActivity => {
        const s = sales.find((x) => x.createdById === u.id);
        const r = returns.find((x) => x.createdById === u.id);
        const c = sessions.find((x) => x.userId === u.id);
        const span = spans.find((x) => x.userId === u.id);
        return {
          userId: u.id,
          code: u.code,
          name: u.fullName,
          salesCount: s?._count._all ?? 0,
          salesTotal: num(s?._sum.totalTtc ?? 0),
          discountTotal: num(s?._sum.totalDiscount ?? 0),
          discountOverLimit: count(u.id, 'DISCOUNT_OVER_LIMIT'),
          returnsCount: r?._count._all ?? 0,
          returnsTotal: num(r?._sum.totalTtc ?? 0),
          cancellations: count(u.id, 'SALE_CANCELLED'),
          lineRemovals: count(u.id, 'CART_LINE_REMOVED'),
          adminCodesUsed: count(u.id, 'ADMIN_OVERRIDE'),
          cashDifference: c ? num(c._sum.difference ?? 0) : null,
          firstAt: span?._min.occurredAt ?? null,
          lastAt: span?._max.occurredAt ?? null,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      date,
      rows,
      totals: {
        salesCount: rows.reduce((acc, r) => acc + r.salesCount, 0),
        salesTotal: rows.reduce((acc, r) => acc + r.salesTotal, 0),
        returnsTotal: rows.reduce((acc, r) => acc + r.returnsTotal, 0),
        cancellations: rows.reduce((acc, r) => acc + r.cancellations, 0),
      },
    };
  }

  /** Contenu HTML (variable brute du modèle DIGEST) et texte du rapport. */
  async render(
    report: ActivityReport,
    baseUrl: string,
  ): Promise<{ title: string; html: string; text: string }> {
    const s = await this.settings.all();
    const tz = s['general.timezone'];
    const money = (v: number) =>
      formatMoney(v, {
        currency: s['general.currency_code'],
        decimals: s['general.currency_decimals'],
      });
    const time = (d: Date | null) => (d ? formatDateTime(d, tz).slice(-5) : '—');
    const title = `Rapport d’activité du ${report.date.split('-').reverse().join('/')}`;
    if (report.rows.length === 0) {
      return {
        title,
        html: '<p>Aucune activité enregistrée ce jour-là.</p>',
        text: 'Aucune activité enregistrée ce jour-là.',
      };
    }
    const cell = 'style="padding:4px 6px;border-bottom:1px solid #e5e7eb;text-align:right"';
    const head = 'style="padding:4px 6px;border-bottom:2px solid #0f766e;text-align:right"';
    const rowsHtml = report.rows
      .map((r) => {
        const audit = `${baseUrl}/audit?userId=${r.userId}&from=${report.date}&to=${report.date}`;
        const sales = `${baseUrl}/sales?userId=${r.userId}&from=${report.date}&to=${report.date}`;
        return `<tr>
<td style="padding:4px 6px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(r.code)}</strong><br/><span style="color:#666">${escapeHtml(r.name)}</span></td>
<td ${cell}><a href="${sales}">${r.salesCount}</a><br/>${escapeHtml(money(r.salesTotal))}</td>
<td ${cell}>${escapeHtml(money(r.discountTotal))}${r.discountOverLimit ? `<br/><span style="color:#b45309">${r.discountOverLimit} hors plafond</span>` : ''}</td>
<td ${cell}>${r.returnsCount}${r.returnsCount ? `<br/>${escapeHtml(money(r.returnsTotal))}` : ''}</td>
<td ${cell}>${r.cancellations}</td>
<td ${cell}>${r.lineRemovals}</td>
<td ${cell}>${r.adminCodesUsed}</td>
<td ${cell}>${r.cashDifference === null ? '—' : escapeHtml(money(r.cashDifference))}</td>
<td ${cell}>${time(r.firstAt)} → ${time(r.lastAt)}<br/><a href="${audit}">Mouchard</a></td>
</tr>`;
      })
      .join('');
    const html = `<table style="border-collapse:collapse;width:100%;font-size:12px">
<thead><tr>
<th style="padding:4px 6px;border-bottom:2px solid #0f766e;text-align:left">Employé</th>
<th ${head}>Ventes</th><th ${head}>Remises</th><th ${head}>Retours</th><th ${head}>Annul.</th>
<th ${head}>Lignes retirées</th><th ${head}>Codes admin</th><th ${head}>Écart caisse</th><th ${head}>Activité</th>
</tr></thead><tbody>${rowsHtml}</tbody></table>
<p>Total : ${report.totals.salesCount} vente(s), ${escapeHtml(money(report.totals.salesTotal))} ; retours ${escapeHtml(money(report.totals.returnsTotal))} ; ${report.totals.cancellations} annulation(s).</p>`;
    const text = report.rows
      .map(
        (r) =>
          `${r.code} (${r.name}) : ${r.salesCount} vente(s) ${money(r.salesTotal)}, remises ${money(r.discountTotal)}${r.discountOverLimit ? ` (${r.discountOverLimit} hors plafond)` : ''}, ${r.returnsCount} retour(s), ${r.cancellations} annulation(s), ${r.lineRemovals} ligne(s) retirée(s), ${r.adminCodesUsed} code(s) admin, écart caisse ${r.cashDifference === null ? '—' : money(r.cashDifference)}, ${time(r.firstAt)} → ${time(r.lastAt)}`,
      )
      .join('\n');
    return { title, html, text };
  }
}
