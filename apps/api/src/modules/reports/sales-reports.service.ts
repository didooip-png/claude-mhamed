import { Injectable } from '@nestjs/common';
import {
  addDaysIso,
  endOfLocalDayExclusive,
  PAYMENT_METHODS,
  REPORTS,
  startOfLocalDay,
  type ReportColumn,
  type ReportId,
  type ReportKpi,
  type ReportResult,
} from '@pharmastock/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  bp,
  comparisonPeriod,
  emptyResult,
  n,
  total,
  WEEKDAYS,
  type ReportContext,
  type Row,
} from './report-helpers.js';

/** Événements de vente (+) et de retour (−) sur la période, ligne par ligne. */
export function saleEvents(fromTs: Date, toTs: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT s.validated_at AS at, s.created_by AS user_id, s.client_id, sl.product_id,
           sl.qty_base AS qty, sl.line_total_ttc AS ttc, sl.tva_rate_bp AS tva,
           sl.cost_total AS cost, sl.discount_amount AS discount, s.id AS sale_id, 'S' AS kind
    FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
    WHERE s.status = 'VALIDATED' AND s.validated_at >= ${fromTs} AND s.validated_at < ${toTs}
    UNION ALL
    SELECT r.created_at, r.created_by, r.client_id, rl.product_id,
           -rl.qty_base, -rl.amount, COALESCE(sl.tva_rate_bp, t.rate_bp),
           -(CASE WHEN rl.destination = 'RESTOCK' THEN rl.qty_base * rl.unit_cost_ht ELSE 0 END),
           0, r.sale_id, 'R'
    FROM customer_return_lines rl
    JOIN customer_returns r ON r.id = rl.return_id
    JOIN products p ON p.id = rl.product_id
    JOIN tva_rates t ON t.id = p.tva_rate_id
    LEFT JOIN sale_lines sl ON sl.id = rl.sale_line_id
    WHERE r.created_at >= ${fromTs} AND r.created_at < ${toTs}`;
}

interface Figures {
  salesCount: number;
  ttc: number;
  ht: number;
  tva: number;
  cost: number;
  discount: number;
  returnsCount: number;
  returnsTtc: number;
  returnsHt: number;
  returnsCost: number;
  cancelledCount: number;
  cancelledTtc: number;
}

type Dimension = 'user' | 'client' | 'category' | 'laboratory' | 'product';

const money = 'money' as const;
const int = 'int' as const;
const text = 'text' as const;
const percent = 'percent' as const;

/** Bucket de regroupement d'une série chronologique. */
function bucketSql(granularity: string, column: string, tz: string): Prisma.Sql {
  const col = Prisma.raw(column);
  switch (granularity) {
    case 'week':
      return Prisma.sql`to_char(date_trunc('week', timezone(${tz}, ${col})), 'YYYY-MM-DD')`;
    case 'month':
      return Prisma.sql`to_char(timezone(${tz}, ${col}), 'YYYY-MM')`;
    case 'year':
      return Prisma.sql`to_char(timezone(${tz}, ${col}), 'YYYY')`;
    default:
      return Prisma.sql`to_char(timezone(${tz}, ${col}), 'YYYY-MM-DD')`;
  }
}

/**
 * Statistiques de ventes et de marges (§6.15). Chiffre d'affaires = ventes validées (hors
 * timbre fiscal) moins les retours clients de la période ; marge = CA HT − coût réel des lots
 * vendus (le coût des retours remis en stock est déduit).
 */
@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Chiffre d'affaires
  // -------------------------------------------------------------------------

  async figures(fromTs: Date, toTs: Date): Promise<Figures> {
    const [sales, returns, cancelled] = await Promise.all([
      this.prisma.$queryRaw<
        { n: bigint; ttc: bigint; ht: bigint; tva: bigint; cost: bigint; discount: bigint }[]
      >`
        SELECT COUNT(*)::bigint AS n,
               COALESCE(SUM(total_ttc - stamp_duty), 0)::bigint AS ttc,
               COALESCE(SUM(subtotal_ht), 0)::bigint AS ht,
               COALESCE(SUM(total_tva), 0)::bigint AS tva,
               COALESCE(SUM(total_cost), 0)::bigint AS cost,
               COALESCE(SUM(total_discount), 0)::bigint AS discount
        FROM sales WHERE status = 'VALIDATED' AND validated_at >= ${fromTs} AND validated_at < ${toTs}`,
      this.prisma.$queryRaw<{ n: bigint; ttc: bigint; ht: bigint; cost: bigint }[]>`
        SELECT COUNT(DISTINCT r.id)::bigint AS n,
               COALESCE(SUM(rl.amount), 0)::bigint AS ttc,
               COALESCE(SUM(ROUND(rl.amount::numeric * 10000 / (10000 + COALESCE(sl.tva_rate_bp, t.rate_bp)))), 0)::bigint AS ht,
               COALESCE(SUM(CASE WHEN rl.destination = 'RESTOCK' THEN rl.qty_base * rl.unit_cost_ht ELSE 0 END), 0)::bigint AS cost
        FROM customer_return_lines rl
        JOIN customer_returns r ON r.id = rl.return_id
        JOIN products p ON p.id = rl.product_id
        JOIN tva_rates t ON t.id = p.tva_rate_id
        LEFT JOIN sale_lines sl ON sl.id = rl.sale_line_id
        WHERE r.created_at >= ${fromTs} AND r.created_at < ${toTs}`,
      this.prisma.$queryRaw<{ n: bigint; ttc: bigint }[]>`
        SELECT COUNT(*)::bigint AS n, COALESCE(SUM(total_ttc), 0)::bigint AS ttc
        FROM sales WHERE status = 'CANCELLED' AND cancelled_at >= ${fromTs} AND cancelled_at < ${toTs}`,
    ]);
    const s = sales[0]!;
    const r = returns[0]!;
    const c = cancelled[0]!;
    return {
      salesCount: n(s.n),
      ttc: n(s.ttc),
      ht: n(s.ht),
      tva: n(s.tva),
      cost: n(s.cost),
      discount: n(s.discount),
      returnsCount: n(r.n),
      returnsTtc: n(r.ttc),
      returnsHt: n(r.ht),
      returnsCost: n(r.cost),
      cancelledCount: n(c.n),
      cancelledTtc: n(c.ttc),
    };
  }

  kpisOf(f: Figures) {
    const netTtc = f.ttc - f.returnsTtc;
    const netHt = f.ht - f.returnsHt;
    const netCost = f.cost - f.returnsCost;
    const margin = netHt - netCost;
    return {
      revenueTtc: netTtc,
      revenueHt: netHt,
      salesCount: f.salesCount,
      avgBasket: f.salesCount === 0 ? 0 : Math.round(f.ttc / f.salesCount),
      margin,
      marginRate: bp(margin, netHt),
      returnsTtc: f.returnsTtc,
      discount: f.discount,
      cancelled: f.cancelledCount,
    };
  }

  async summary(ctx: ReportContext): Promise<ReportResult> {
    const { fromTs, toTs, tz } = ctx;
    const granularity = ctx.query.granularity;
    const comparison = comparisonPeriod(ctx.from, ctx.to, ctx.query.compare);
    const current = await this.figures(fromTs, toTs);
    let previous: ReturnType<SalesReportsService['kpisOf']> | null = null;
    if (comparison) {
      previous = this.kpisOf(
        await this.figures(
          startOfLocalDay(comparison.from, tz),
          endOfLocalDayExclusive(comparison.to, tz),
        ),
      );
    }
    const k = this.kpisOf(current);
    const kpi = (key: keyof typeof k, label: string, type: ReportKpi['type']): ReportKpi => ({
      key,
      label,
      type,
      value: k[key],
      ...(previous ? { previous: previous[key] } : {}),
    });
    const kpis: ReportKpi[] = [
      kpi('revenueTtc', 'CA TTC (net des retours)', money),
      kpi('revenueHt', 'CA HT (net des retours)', money),
      kpi('salesCount', 'Nombre de ventes', int),
      kpi('avgBasket', 'Panier moyen', money),
      kpi('margin', 'Marge brute', money),
      kpi('marginRate', 'Taux de marge', percent),
      kpi('returnsTtc', 'Retours clients', money),
      kpi('discount', 'Remises accordées', money),
      kpi('cancelled', 'Ventes annulées ou modifiées', int),
    ];

    // Série chronologique : ventes et retours par période.
    const saleBucket = bucketSql(granularity, 's.validated_at', tz);
    const returnBucket = bucketSql(granularity, 'r.created_at', tz);
    const [salesSeries, returnsSeries] = await Promise.all([
      this.prisma.$queryRaw<
        { bucket: string; n: bigint; ttc: bigint; ht: bigint; cost: bigint }[]
      >(Prisma.sql`
        SELECT ${saleBucket} AS bucket, COUNT(*)::bigint AS n,
               SUM(s.total_ttc - s.stamp_duty)::bigint AS ttc, SUM(s.subtotal_ht)::bigint AS ht,
               SUM(s.total_cost)::bigint AS cost
        FROM sales s WHERE s.status = 'VALIDATED' AND s.validated_at >= ${fromTs} AND s.validated_at < ${toTs}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.$queryRaw<{ bucket: string; ttc: bigint; ht: bigint; cost: bigint }[]>(Prisma.sql`
        SELECT ${returnBucket} AS bucket, SUM(rl.amount)::bigint AS ttc,
               SUM(ROUND(rl.amount::numeric * 10000 / (10000 + COALESCE(sl.tva_rate_bp, t.rate_bp))))::bigint AS ht,
               SUM(CASE WHEN rl.destination = 'RESTOCK' THEN rl.qty_base * rl.unit_cost_ht ELSE 0 END)::bigint AS cost
        FROM customer_return_lines rl
        JOIN customer_returns r ON r.id = rl.return_id
        JOIN products p ON p.id = rl.product_id
        JOIN tva_rates t ON t.id = p.tva_rate_id
        LEFT JOIN sale_lines sl ON sl.id = rl.sale_line_id
        WHERE r.created_at >= ${fromTs} AND r.created_at < ${toTs}
        GROUP BY 1`),
    ]);
    const byBucket = new Map<string, Row>();
    const ensure = (bucket: string): Row => {
      let row = byBucket.get(bucket);
      if (!row) {
        row = { bucket, salesCount: 0, revenueTtc: 0, revenueHt: 0, cost: 0, margin: 0 };
        byBucket.set(bucket, row);
      }
      return row;
    };
    if (granularity === 'day') {
      for (
        let d = ctx.from, guard = 0;
        d <= ctx.to && guard < 1100;
        d = addDaysIso(d, 1), guard += 1
      )
        ensure(d);
    }
    for (const s of salesSeries) {
      const row = ensure(s.bucket);
      row.salesCount = n(s.n);
      row.revenueTtc = n(row.revenueTtc) + n(s.ttc);
      row.revenueHt = n(row.revenueHt) + n(s.ht);
      row.cost = n(row.cost) + n(s.cost);
    }
    for (const r of returnsSeries) {
      const row = ensure(r.bucket);
      row.revenueTtc = n(row.revenueTtc) - n(r.ttc);
      row.revenueHt = n(row.revenueHt) - n(r.ht);
      row.cost = n(row.cost) - n(r.cost);
    }
    const rows = [...byBucket.values()].sort((a, b) =>
      String(a.bucket).localeCompare(String(b.bucket)),
    );
    for (const r of rows) {
      r.margin = n(r.revenueHt) - n(r.cost);
      r.marginRate = bp(n(r.margin), n(r.revenueHt));
    }
    const label = { day: 'Jour', week: 'Semaine du', month: 'Mois', year: 'Année' }[granularity];
    return emptyResult('sales-summary', REPORTS['sales-summary'].label, ctx, {
      comparison,
      kpis,
      columns: [
        { key: 'bucket', header: label, type: text },
        { key: 'salesCount', header: 'Ventes', type: int },
        { key: 'revenueTtc', header: 'CA TTC', type: money },
        { key: 'revenueHt', header: 'CA HT', type: money },
        { key: 'cost', header: 'Coût', type: money },
        { key: 'margin', header: 'Marge', type: money },
        { key: 'marginRate', header: 'Taux de marge', type: percent },
      ],
      rows,
      totals: {
        bucket: 'Total',
        salesCount: total(rows, 'salesCount'),
        revenueTtc: total(rows, 'revenueTtc'),
        revenueHt: total(rows, 'revenueHt'),
        cost: total(rows, 'cost'),
        margin: total(rows, 'margin'),
        marginRate: k.marginRate,
      },
      chart: {
        type: 'line',
        x: 'bucket',
        series: [
          { key: 'revenueTtc', label: 'CA TTC', type: money },
          { key: 'margin', label: 'Marge', type: money },
        ],
      },
      notes: [
        'CA = ventes validées hors timbre fiscal, moins les retours clients enregistrés sur la période.',
      ],
    });
  }

  // -------------------------------------------------------------------------
  // Ventilations
  // -------------------------------------------------------------------------

  private breakdownColumns(dim: Dimension, withQty: boolean): ReportColumn[] {
    const first = {
      user: 'Utilisateur',
      client: 'Client',
      category: 'Catégorie',
      laboratory: 'Laboratoire',
      product: 'Produit',
    }[dim];
    return [
      { key: 'label', header: first, type: text },
      { key: 'sales', header: 'Ventes', type: int },
      ...(withQty ? [{ key: 'qty', header: 'Quantité', type: 'qty' as const }] : []),
      { key: 'revenueTtc', header: 'CA TTC', type: money },
      { key: 'revenueHt', header: 'CA HT', type: money },
      { key: 'discount', header: 'Remises', type: money },
      { key: 'margin', header: 'Marge', type: money },
      { key: 'marginRate', header: 'Taux de marge', type: percent },
      { key: 'share', header: 'Part du CA', type: percent },
    ];
  }

  private finishRows(rows: Row[]): Row[] {
    const revenue = total(rows, 'revenueTtc');
    for (const r of rows) {
      r.margin = n(r.revenueHt) - n(r.cost);
      r.marginRate = bp(n(r.margin), n(r.revenueHt));
      r.share = bp(n(r.revenueTtc), revenue);
    }
    return rows;
  }

  private totalsRow(rows: Row[], label: string, withQty: boolean): Row {
    const t: Row = {
      label,
      sales: total(rows, 'sales'),
      revenueTtc: total(rows, 'revenueTtc'),
      revenueHt: total(rows, 'revenueHt'),
      discount: total(rows, 'discount'),
      margin: total(rows, 'margin'),
    };
    if (withQty) t.qty = total(rows, 'qty');
    t.marginRate = bp(n(t.margin), n(t.revenueHt));
    t.share = 10_000;
    return t;
  }

  /** Ventilation du CA et de la marge selon une dimension (utilisateur, client, catégorie…). */
  async breakdown(
    id: ReportId,
    ctx: ReportContext,
    dim: Dimension,
    options: { order: 'ttc' | 'margin' | 'qty'; limit: number },
  ): Promise<ReportResult> {
    const { fromTs, toTs } = ctx;
    let rows: Row[];
    if (dim === 'user') {
      // Ventes de chaque vendeur ; les retours saisis par l'employé sont indiqués à part.
      const sales = await this.prisma.$queryRaw<
        {
          key: string;
          label: string;
          n: bigint;
          ttc: bigint;
          ht: bigint;
          discount: bigint;
          cost: bigint;
        }[]
      >`
        SELECT u.id::text AS key, u.code || ' — ' || u.full_name AS label, COUNT(*)::bigint AS n,
               SUM(s.total_ttc - s.stamp_duty)::bigint AS ttc, SUM(s.subtotal_ht)::bigint AS ht,
               SUM(s.total_discount)::bigint AS discount, SUM(s.total_cost)::bigint AS cost
        FROM sales s JOIN users u ON u.id = s.created_by
        WHERE s.status = 'VALIDATED' AND s.validated_at >= ${fromTs} AND s.validated_at < ${toTs}
        GROUP BY u.id, u.code, u.full_name ORDER BY SUM(s.total_ttc - s.stamp_duty) DESC`;
      const returns = await this.prisma.$queryRaw<{ key: string; ttc: bigint; cnt: bigint }[]>`
        SELECT r.created_by::text AS key, SUM(r.total_ttc)::bigint AS ttc, COUNT(*)::bigint AS cnt
        FROM customer_returns r WHERE r.created_at >= ${fromTs} AND r.created_at < ${toTs}
        GROUP BY r.created_by`;
      const ret = new Map(returns.map((r) => [r.key, r]));
      rows = sales.map((s) => ({
        key: s.key,
        label: s.label,
        sales: n(s.n),
        revenueTtc: n(s.ttc),
        revenueHt: n(s.ht),
        discount: n(s.discount),
        cost: n(s.cost),
        returnsTtc: n(ret.get(s.key)?.ttc),
        returnsCount: n(ret.get(s.key)?.cnt),
      }));
      this.finishRows(rows);
      const columns = this.breakdownColumns(dim, false);
      columns.splice(7, 0, { key: 'returnsTtc', header: 'Retours saisis', type: money });
      return emptyResult(id, REPORTS[id as keyof typeof REPORTS].label, ctx, {
        columns,
        rows,
        totals: { ...this.totalsRow(rows, 'Total', false), returnsTtc: total(rows, 'returnsTtc') },
        chart: {
          type: 'bar',
          x: 'label',
          series: [{ key: 'revenueTtc', label: 'CA TTC', type: money }],
        },
      });
    }

    const joins: Record<Exclude<Dimension, 'user'>, [Prisma.Sql, Prisma.Sql, Prisma.Sql]> = {
      client: [
        Prisma.sql`JOIN clients cl ON cl.id = ev.client_id`,
        Prisma.sql`cl.id::text`,
        Prisma.sql`cl.name`,
      ],
      category: [
        Prisma.sql`JOIN products p ON p.id = ev.product_id JOIN categories cat ON cat.id = p.category_id`,
        Prisma.sql`cat.id::text`,
        Prisma.sql`cat.name`,
      ],
      laboratory: [
        Prisma.sql`JOIN products p ON p.id = ev.product_id LEFT JOIN laboratories lab ON lab.id = p.laboratory_id`,
        Prisma.sql`COALESCE(lab.id::text, 'none')`,
        Prisma.sql`COALESCE(lab.name, 'Sans laboratoire')`,
      ],
      product: [
        Prisma.sql`JOIN products p ON p.id = ev.product_id`,
        Prisma.sql`p.id::text`,
        Prisma.sql`p.name || COALESCE(' ' || p.dosage, '')`,
      ],
    };
    const [join, key, label] = joins[dim];
    const order = {
      ttc: 'ttc',
      margin: 'SUM(ROUND(ev.ttc::numeric * 10000 / (10000 + ev.tva))) - SUM(ev.cost)',
      qty: 'qty',
    }[options.order];
    const result = await this.prisma.$queryRaw<
      {
        key: string;
        label: string;
        sales: bigint;
        qty: bigint;
        ttc: bigint;
        ht: bigint;
        discount: bigint;
        cost: bigint;
      }[]
    >(Prisma.sql`
      WITH ev AS (${saleEvents(fromTs, toTs)})
      SELECT ${key} AS key, ${label} AS label,
             COUNT(DISTINCT ev.sale_id) FILTER (WHERE ev.kind = 'S')::bigint AS sales,
             COALESCE(SUM(ev.qty), 0)::bigint AS qty,
             COALESCE(SUM(ev.ttc), 0)::bigint AS ttc,
             COALESCE(SUM(ROUND(ev.ttc::numeric * 10000 / (10000 + ev.tva))), 0)::bigint AS ht,
             COALESCE(SUM(ev.discount), 0)::bigint AS discount,
             COALESCE(SUM(ev.cost), 0)::bigint AS cost
      FROM ev ${join}
      GROUP BY 1, 2
      ORDER BY ${Prisma.raw(order)} DESC, 2
      LIMIT ${options.limit}`);
    rows = result.map((r) => ({
      key: r.key,
      label: r.label,
      sales: n(r.sales),
      qty: n(r.qty),
      revenueTtc: n(r.ttc),
      revenueHt: n(r.ht),
      discount: n(r.discount),
      cost: n(r.cost),
    }));
    this.finishRows(rows);
    const withQty = dim === 'product' || dim === 'category' || dim === 'laboratory';
    return emptyResult(id, REPORTS[id as keyof typeof REPORTS].label, ctx, {
      columns: this.breakdownColumns(dim, withQty),
      rows,
      totals: this.totalsRow(rows, 'Total', withQty),
      chart: {
        type: dim === 'category' || dim === 'laboratory' ? 'pie' : 'bar',
        x: 'label',
        series: [
          options.order === 'margin'
            ? { key: 'margin', label: 'Marge', type: money }
            : { key: 'revenueTtc', label: 'CA TTC', type: money },
        ],
      },
      notes: ['Retours clients déduits (montant et quantité) à la date du retour.'],
    });
  }

  // -------------------------------------------------------------------------
  // Modes de paiement
  // -------------------------------------------------------------------------

  async byPayment(ctx: ReportContext): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<{ method: string; n: bigint; amount: bigint }[]>`
      SELECT method::text AS method, COUNT(*)::bigint AS n, SUM(amount - refunded_amount)::bigint AS amount
      FROM payments WHERE status = 'VALID' AND paid_at >= ${ctx.fromTs} AND paid_at < ${ctx.toTs}
      GROUP BY method ORDER BY SUM(amount - refunded_amount) DESC`;
    const sum = rows.reduce((a, r) => a + n(r.amount), 0);
    const data: Row[] = rows.map((r) => ({
      label: PAYMENT_METHODS[r.method as keyof typeof PAYMENT_METHODS] ?? r.method,
      payments: n(r.n),
      amount: n(r.amount),
      share: bp(n(r.amount), sum),
    }));
    return emptyResult('sales-by-payment', REPORTS['sales-by-payment'].label, ctx, {
      columns: [
        { key: 'label', header: 'Mode de paiement', type: text },
        { key: 'payments', header: 'Règlements', type: int },
        { key: 'amount', header: 'Montant', type: money },
        { key: 'share', header: 'Part', type: percent },
      ],
      rows: data,
      totals: { label: 'Total', payments: total(data, 'payments'), amount: sum, share: 10_000 },
      chart: {
        type: 'pie',
        x: 'label',
        series: [{ key: 'amount', label: 'Montant', type: money }],
      },
      notes: ['Règlements valides de la période, nets des remboursements.'],
    });
  }

  // -------------------------------------------------------------------------
  // Carte de chaleur, ABC
  // -------------------------------------------------------------------------

  async heatmap(ctx: ReportContext): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<{ wd: number; hr: number; n: bigint; ttc: bigint }[]>`
      SELECT (EXTRACT(ISODOW FROM timezone(${ctx.tz}, validated_at))::int - 1) AS wd,
             EXTRACT(HOUR FROM timezone(${ctx.tz}, validated_at))::int AS hr,
             COUNT(*)::bigint AS n, SUM(total_ttc - stamp_duty)::bigint AS ttc
      FROM sales WHERE status = 'VALIDATED' AND validated_at >= ${ctx.fromTs} AND validated_at < ${ctx.toTs}
      GROUP BY 1, 2 ORDER BY 1, 2`;
    const data: Row[] = rows.map((r) => ({
      weekday: r.wd,
      weekdayLabel: WEEKDAYS[r.wd]!,
      hour: r.hr,
      hourLabel: `${String(r.hr).padStart(2, '0')} h`,
      sales: n(r.n),
      revenueTtc: n(r.ttc),
    }));
    return emptyResult('sales-heatmap', REPORTS['sales-heatmap'].label, ctx, {
      columns: [
        { key: 'weekdayLabel', header: 'Jour', type: text },
        { key: 'hourLabel', header: 'Heure', type: text },
        { key: 'sales', header: 'Ventes', type: int },
        { key: 'revenueTtc', header: 'CA TTC', type: money },
      ],
      rows: data,
      totals: {
        weekdayLabel: 'Total',
        sales: total(data, 'sales'),
        revenueTtc: total(data, 'revenueTtc'),
      },
      chart: {
        type: 'heatmap',
        x: 'hourLabel',
        y: 'weekdayLabel',
        value: 'sales',
        series: [{ key: 'sales', label: 'Ventes', type: int }],
      },
    });
  }

  /** Analyse ABC : A jusqu'à 80 % du CA cumulé, B jusqu'à 95 %, C au-delà. */
  async abc(ctx: ReportContext): Promise<ReportResult> {
    const base = await this.breakdown('abc', ctx, 'product', { order: 'ttc', limit: 5000 });
    // Seuls les produits au CA net positif entrent dans l'analyse (un retour de vente antérieure peut le rendre négatif).
    const positive = base.rows.filter((r) => n(r.revenueTtc) > 0);
    const revenue = total(positive, 'revenueTtc');
    let cumulative = 0;
    const rows: Row[] = positive.map((r, i) => {
      const before = cumulative;
      cumulative += n(r.revenueTtc);
      const cls = bp(before, revenue) < 8000 ? 'A' : bp(before, revenue) < 9500 ? 'B' : 'C';
      return {
        rank: i + 1,
        label: r.label ?? null,
        qty: r.qty ?? null,
        revenueTtc: r.revenueTtc ?? null,
        share: bp(n(r.revenueTtc), revenue),
        cumulativeShare: bp(cumulative, revenue),
        class: cls,
      };
    });
    const counts = (c: string) => rows.filter((r) => r.class === c).length;
    return emptyResult('abc', REPORTS.abc.label, ctx, {
      kpis: [
        { key: 'a', label: 'Produits de classe A', type: 'int', value: counts('A') },
        { key: 'b', label: 'Produits de classe B', type: 'int', value: counts('B') },
        { key: 'c', label: 'Produits de classe C', type: 'int', value: counts('C') },
      ],
      columns: [
        { key: 'rank', header: 'Rang', type: int },
        { key: 'label', header: 'Produit', type: text },
        { key: 'qty', header: 'Quantité', type: 'qty' },
        { key: 'revenueTtc', header: 'CA TTC', type: money },
        { key: 'share', header: 'Part', type: percent },
        { key: 'cumulativeShare', header: 'Cumul', type: percent },
        { key: 'class', header: 'Classe', type: text },
      ],
      rows,
      totals: { label: 'Total', revenueTtc: revenue, qty: total(rows, 'qty') },
      chart: {
        type: 'line',
        x: 'rank',
        series: [{ key: 'cumulativeShare', label: 'CA cumulé', type: 'percent' }],
      },
    });
  }
}
