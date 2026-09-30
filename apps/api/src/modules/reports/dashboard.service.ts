import { Injectable } from '@nestjs/common';
import {
  addDaysIso,
  endOfLocalDayExclusive,
  startOfLocalDay,
  todayIso,
  weekdayOf,
  type ReportQuery,
} from '@pharmastock/shared';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { buildContext, type ReportContext } from './report-helpers.js';
import { SalesReportsService } from './sales-reports.service.js';
import { StockReportsService } from './stock-reports.service.js';

const query = (from: string, to: string): ReportQuery => ({
  from,
  to,
  compare: 'none',
  granularity: 'day',
  format: 'json',
});

type Kpis = ReturnType<SalesReportsService['kpisOf']>;

/**
 * Tableau de bord (§6.1) : complet pour l'administrateur (CA, marges, valeur du stock, alertes),
 * personnel pour un préparateur (ses ventes du jour, sans marge ; alertes de stock).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly sales: SalesReportsService,
    private readonly stock: StockReportsService,
  ) {}

  private ctx(
    settings: Awaited<ReturnType<SettingsService['all']>>,
    from: string,
    to: string,
  ): ReportContext {
    return buildContext(settings, query(from, to));
  }

  private async kpis(c: ReportContext): Promise<Kpis> {
    return this.sales.kpisOf(await this.sales.figures(c.fromTs, c.toTs));
  }

  async get(actor: Actor) {
    const settings = await this.settings.all();
    const tz = settings['general.timezone'];
    const today = todayIso(tz, now());
    const full = actor.permissions.has('dashboard.full');
    const alerts = await this.alerts(today, settings, full);
    if (!full)
      return {
        scope: 'PERSONAL' as const,
        today,
        ...(await this.personal(actor, today, tz)),
        alerts,
      };

    const weekStart = addDaysIso(today, -weekdayOf(today)); // lundi
    const monthStart = `${today.slice(0, 7)}-01`;
    const spanWeek = weekdayOf(today);
    const spanMonth = Number(today.slice(8, 10)) - 1;
    const prevWeekStart = addDaysIso(weekStart, -7);
    const prevMonthEnd = addDaysIso(monthStart, -1);
    const prevMonthStart = `${prevMonthEnd.slice(0, 7)}-01`;
    const prevMonthTo = addDaysIso(
      prevMonthStart,
      Math.min(spanMonth, Number(prevMonthEnd.slice(8, 10)) - 1),
    );
    const [day, week, month, prevDay, prevWeek, prevMonth] = await Promise.all([
      this.kpis(this.ctx(settings, today, today)),
      this.kpis(this.ctx(settings, weekStart, today)),
      this.kpis(this.ctx(settings, monthStart, today)),
      this.kpis(this.ctx(settings, addDaysIso(today, -1), addDaysIso(today, -1))),
      this.kpis(this.ctx(settings, prevWeekStart, addDaysIso(prevWeekStart, spanWeek))),
      this.kpis(this.ctx(settings, prevMonthStart, prevMonthTo)),
    ]);

    const series = await this.sales.summary(this.ctx(settings, addDaysIso(today, -29), today));
    const payments = await this.sales.byPayment(this.ctx(settings, today, today));
    const top = await this.sales.breakdown(
      'top-products',
      this.ctx(settings, monthStart, today),
      'product',
      {
        order: 'ttc',
        limit: 10,
      },
    );
    const valuation = await this.stock.valuation(this.ctx(settings, today, today));

    const [receivables] = await this.prisma.$queryRaw<
      { total: bigint; clients: bigint; overdue: bigint; overdue_count: bigint }[]
    >(Prisma.sql`
      SELECT COALESCE((SELECT SUM(balance) FROM clients WHERE balance > 0 AND NOT is_walk_in), 0)::bigint AS total,
             (SELECT COUNT(*) FROM clients WHERE balance > 0 AND NOT is_walk_in)::bigint AS clients,
             COALESCE((SELECT SUM(amount_due) FROM sales WHERE status = 'VALIDATED' AND amount_due > 0 AND due_date < ${today}::date), 0)::bigint AS overdue,
             (SELECT COUNT(*) FROM sales WHERE status = 'VALIDATED' AND amount_due > 0 AND due_date < ${today}::date)::bigint AS overdue_count`);

    return {
      scope: 'FULL' as const,
      today,
      periods: {
        day: { current: day, previous: prevDay, label: "Aujourd'hui", previousLabel: 'Hier' },
        week: {
          current: week,
          previous: prevWeek,
          label: 'Cette semaine',
          previousLabel: 'Semaine précédente',
        },
        month: {
          current: month,
          previous: prevMonth,
          label: 'Ce mois',
          previousLabel: 'Mois précédent',
        },
      },
      series: series.rows.map((r) => ({
        day: r.bucket,
        salesCount: r.salesCount,
        revenueTtc: r.revenueTtc,
        margin: r.margin,
      })),
      payments: payments.rows.map((r) => ({ label: r.label, amount: r.amount })),
      paymentsTotal: payments.totals?.amount ?? 0,
      topProducts: top.rows.map((r) => ({
        label: r.label,
        qty: r.qty,
        revenueTtc: r.revenueTtc,
        margin: r.margin,
      })),
      receivables: {
        total: num(receivables?.total),
        clients: num(receivables?.clients),
        overdue: num(receivables?.overdue),
        overdueInvoices: num(receivables?.overdue_count),
      },
      stockValue: {
        cost: valuation.kpis.find((k) => k.key === 'cost')?.value ?? 0,
        sale: valuation.kpis.find((k) => k.key === 'sale')?.value ?? 0,
      },
      alerts,
    };
  }

  /** Vue d'un préparateur : ses ventes du jour (nombre et montant, jamais la marge). */
  private async personal(actor: Actor, today: string, tz: string) {
    const fromTs = startOfLocalDay(today, tz);
    const toTs = endOfLocalDayExclusive(today, tz);
    const [mine, onHold] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          status: 'VALIDATED',
          createdById: actor.userId,
          validatedAt: { gte: fromTs, lt: toTs },
        },
        _count: true,
        _sum: { totalTtc: true },
      }),
      this.prisma.sale.count({ where: { status: 'ON_HOLD' } }),
    ]);
    return {
      mySales: { count: mine._count, totalTtc: num(mine._sum.totalTtc ?? 0) },
      onHold,
    };
  }

  /** Alertes : ruptures, seuils, péremptions, plafonds, écarts de caisse, annulations du jour. */
  private async alerts(
    today: string,
    settings: Awaited<ReturnType<SettingsService['all']>>,
    full: boolean,
  ) {
    const thresholds = [...settings['stock.expiry_alert_days']].sort((a, b) => a - b);
    const since = new Date(
      now().getTime() - settings['stock.reorder_consumption_days'] * 86_400_000,
    );
    const tz = settings['general.timezone'];
    const fromTs = startOfLocalDay(today, tz);
    const toTs = endOfLocalDayExclusive(today, tz);
    const [levels] = await this.prisma.$queryRaw<{ out: bigint; low: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE COALESCE(s.sellable, 0) = 0 AND (p.min_stock > 0 OR COALESCE(m.sold, 0) > 0))::bigint AS out,
             COUNT(*) FILTER (WHERE COALESCE(s.sellable, 0) > 0 AND p.min_stock > 0 AND COALESCE(s.sellable, 0) <= p.min_stock)::bigint AS low
      FROM products p
      LEFT JOIN (SELECT product_id, SUM(remaining_qty) AS sellable FROM lots
                 WHERE status = 'ACTIVE' AND expiry_date > ${today}::date GROUP BY product_id) s ON s.product_id = p.id
      LEFT JOIN (SELECT product_id, -SUM(qty) AS sold FROM stock_movements
                 WHERE type = 'SALE_OUT' AND created_at >= ${since} GROUP BY product_id) m ON m.product_id = p.id
      WHERE p.is_active`);
    const lotCounts = await Promise.all([
      this.prisma.lot.count({
        where: { remainingQty: { gt: 0 }, expiryDate: { lte: new Date(`${today}T00:00:00Z`) } },
      }),
      ...thresholds.map((t, i) =>
        this.prisma.lot.count({
          where: {
            remainingQty: { gt: 0 },
            expiryDate: {
              gt: new Date(`${addDaysIso(today, i === 0 ? 0 : thresholds[i - 1]!)}T00:00:00Z`),
              lte: new Date(`${addDaysIso(today, t)}T00:00:00Z`),
            },
          },
        }),
      ),
    ]);
    const alerts = {
      outOfStock: num(levels?.out),
      lowStock: num(levels?.low),
      expiredLots: lotCounts[0]!,
      expiring: thresholds.map((t, i) => ({ days: t, lots: lotCounts[i + 1]! })),
    };
    if (!full) return alerts;

    const [creditExceeded] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM clients WHERE credit_limit IS NOT NULL AND credit_limit > 0 AND balance > credit_limit`;
    const [cash] = await this.prisma.$queryRaw<{ n: bigint; total: bigint }[]>`
      SELECT COUNT(*)::bigint AS n, COALESCE(SUM(difference), 0)::bigint AS total FROM cash_sessions
      WHERE status = 'CLOSED' AND difference <> 0 AND closed_at >= ${fromTs} AND closed_at < ${toTs}`;
    const cancelled = await this.prisma.sale.aggregate({
      where: { status: 'CANCELLED', cancelledAt: { gte: fromTs, lt: toTs } },
      _count: true,
      _sum: { totalTtc: true },
    });
    return {
      ...alerts,
      creditExceeded: num(creditExceeded?.n),
      cashDiscrepancies: { count: num(cash?.n), total: num(cash?.total) },
      cancellationsToday: { count: cancelled._count, totalTtc: num(cancelled._sum.totalTtc ?? 0) },
    };
  }
}
