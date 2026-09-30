import { Injectable } from '@nestjs/common';
import {
  addDaysIso,
  PAYMENT_METHODS,
  REPORTS,
  type PaymentMethod,
  type ReportResult,
} from '@pharmastock/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { bp, emptyResult, n, total, type ReportContext, type Row } from './report-helpers.js';

const money = 'money' as const;
const int = 'int' as const;
const text = 'text' as const;
const qty = 'qty' as const;
const percent = 'percent' as const;

const DESTINATIONS: Record<string, string> = {
  RESTOCK: 'Remis en stock',
  QUARANTINE: 'Quarantaine',
  DESTRUCTION: 'Détruit',
};

/** Retours, annulations, créances et caisse (§6.15). */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  // -------------------------------------------------------------------------
  // Retours clients et annulations
  // -------------------------------------------------------------------------

  async returnsBy(ctx: ReportContext, dim: 'reason' | 'user' | 'product'): Promise<ReportResult> {
    const id = `returns-by-${dim}` as
      'returns-by-reason' | 'returns-by-user' | 'returns-by-product';
    let rows: Row[];
    if (dim === 'product') {
      const result = await this.prisma.$queryRaw<
        {
          label: string;
          qty: bigint;
          amount: bigint;
          restock: bigint;
          quarantine: bigint;
          destroyed: bigint;
          cnt: bigint;
        }[]
      >`
        SELECT p.name || COALESCE(' ' || p.dosage, '') AS label, SUM(rl.qty_base)::bigint AS qty,
               SUM(rl.amount)::bigint AS amount, COUNT(DISTINCT r.id)::bigint AS cnt,
               COALESCE(SUM(rl.qty_base) FILTER (WHERE rl.destination = 'RESTOCK'), 0)::bigint AS restock,
               COALESCE(SUM(rl.qty_base) FILTER (WHERE rl.destination = 'QUARANTINE'), 0)::bigint AS quarantine,
               COALESCE(SUM(rl.qty_base) FILTER (WHERE rl.destination = 'DESTRUCTION'), 0)::bigint AS destroyed
        FROM customer_return_lines rl
        JOIN customer_returns r ON r.id = rl.return_id JOIN products p ON p.id = rl.product_id
        WHERE r.created_at >= ${ctx.fromTs} AND r.created_at < ${ctx.toTs}
        GROUP BY p.id, p.name, p.dosage ORDER BY SUM(rl.amount) DESC LIMIT 200`;
      rows = result.map((r) => ({
        label: r.label,
        returns: n(r.cnt),
        qty: n(r.qty),
        amount: n(r.amount),
        restock: n(r.restock),
        quarantine: n(r.quarantine),
        destroyed: n(r.destroyed),
      }));
      return emptyResult(id, REPORTS[id].label, ctx, {
        columns: [
          { key: 'label', header: 'Produit', type: text },
          { key: 'returns', header: 'Retours', type: int },
          { key: 'qty', header: 'Quantité', type: qty },
          { key: 'amount', header: 'Montant TTC', type: money },
          { key: 'restock', header: DESTINATIONS.RESTOCK!, type: qty },
          { key: 'quarantine', header: DESTINATIONS.QUARANTINE!, type: qty },
          { key: 'destroyed', header: DESTINATIONS.DESTRUCTION!, type: qty },
        ],
        rows,
        totals: {
          label: 'Total',
          returns: total(rows, 'returns'),
          qty: total(rows, 'qty'),
          amount: total(rows, 'amount'),
          restock: total(rows, 'restock'),
          quarantine: total(rows, 'quarantine'),
          destroyed: total(rows, 'destroyed'),
        },
        chart: {
          type: 'bar',
          x: 'label',
          series: [{ key: 'amount', label: 'Montant TTC', type: money }],
        },
      });
    }
    const result =
      dim === 'reason'
        ? await this.prisma.$queryRaw<{ label: string; cnt: bigint; amount: bigint }[]>`
            SELECT lower(btrim(r.reason)) AS label, COUNT(*)::bigint AS cnt, SUM(r.total_ttc)::bigint AS amount
            FROM customer_returns r WHERE r.created_at >= ${ctx.fromTs} AND r.created_at < ${ctx.toTs}
            GROUP BY 1 ORDER BY SUM(r.total_ttc) DESC LIMIT 200`
        : await this.prisma.$queryRaw<{ label: string; cnt: bigint; amount: bigint }[]>`
            SELECT u.code || ' — ' || u.full_name AS label, COUNT(*)::bigint AS cnt, SUM(r.total_ttc)::bigint AS amount
            FROM customer_returns r JOIN users u ON u.id = r.created_by
            WHERE r.created_at >= ${ctx.fromTs} AND r.created_at < ${ctx.toTs}
            GROUP BY u.id, u.code, u.full_name ORDER BY SUM(r.total_ttc) DESC`;
    const sum = result.reduce((a, r) => a + n(r.amount), 0);
    rows = result.map((r) => ({
      label: r.label,
      returns: n(r.cnt),
      amount: n(r.amount),
      share: bp(n(r.amount), sum),
    }));
    return emptyResult(id, REPORTS[id].label, ctx, {
      columns: [
        { key: 'label', header: dim === 'reason' ? 'Motif' : 'Utilisateur', type: text },
        { key: 'returns', header: 'Retours', type: int },
        { key: 'amount', header: 'Montant TTC', type: money },
        { key: 'share', header: 'Part', type: percent },
      ],
      rows,
      totals: { label: 'Total', returns: total(rows, 'returns'), amount: sum, share: 10_000 },
      chart: {
        type: 'pie',
        x: 'label',
        series: [{ key: 'amount', label: 'Montant TTC', type: money }],
      },
    });
  }

  async cancellationsByUser(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<
      { label: string; cnt: bigint; amount: bigint; reasons: string | null; replaced: bigint }[]
    >`
      SELECT u.code || ' — ' || u.full_name AS label, COUNT(*)::bigint AS cnt, SUM(s.total_ttc)::bigint AS amount,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales n WHERE n.replaces_sale_id = s.id))::bigint AS replaced,
             (SELECT string_agg(DISTINCT x.cancel_reason, ' ; ') FROM (
                SELECT s2.cancel_reason FROM sales s2
                WHERE s2.cancelled_by = u.id AND s2.status = 'CANCELLED' AND s2.cancel_reason IS NOT NULL
                  AND s2.cancelled_at >= ${ctx.fromTs} AND s2.cancelled_at < ${ctx.toTs} LIMIT 3) x) AS reasons
      FROM sales s JOIN users u ON u.id = s.cancelled_by
      WHERE s.status = 'CANCELLED' AND s.cancelled_at >= ${ctx.fromTs} AND s.cancelled_at < ${ctx.toTs}
      GROUP BY u.id, u.code, u.full_name ORDER BY SUM(s.total_ttc) DESC`;
    const rows: Row[] = result.map((r) => ({
      label: r.label,
      cancellations: n(r.cnt),
      replaced: n(r.replaced),
      amount: n(r.amount),
      reasons: r.reasons,
    }));
    return emptyResult('cancellations-by-user', REPORTS['cancellations-by-user'].label, ctx, {
      columns: [
        { key: 'label', header: 'Annulée par', type: text },
        { key: 'cancellations', header: 'Ventes annulées', type: int },
        { key: 'replaced', header: 'Dont modifiées (remplacées)', type: int },
        { key: 'amount', header: 'Montant TTC', type: money },
        { key: 'reasons', header: 'Motifs (extraits)', type: text },
      ],
      rows,
      totals: {
        label: 'Total',
        cancellations: total(rows, 'cancellations'),
        replaced: total(rows, 'replaced'),
        amount: total(rows, 'amount'),
      },
      chart: {
        type: 'bar',
        x: 'label',
        series: [{ key: 'amount', label: 'Montant TTC', type: money }],
      },
    });
  }

  // -------------------------------------------------------------------------
  // Créances
  // -------------------------------------------------------------------------

  async aging(ctx: ReportContext): Promise<ReportResult> {
    const aging = await this.payments.aging(ctx.today);
    const rows: Row[] = aging.clients.map((c) => ({
      client: `${c.name} (${c.code})`,
      invoices: c.invoices,
      b0: c.buckets[0],
      b1: c.buckets[1],
      b2: c.buckets[2],
      b3: c.buckets[3],
      total: c.total,
      overdue: c.overdue,
      credit: c.credit,
    }));
    return emptyResult('receivables-aging', REPORTS['receivables-aging'].label, null, {
      kpis: [
        { key: 'total', label: 'Créances totales', type: money, value: aging.totals.total },
        { key: 'overdue', label: 'Dont échues', type: money, value: aging.totals.overdue },
      ],
      columns: [
        { key: 'client', header: 'Client', type: text },
        { key: 'invoices', header: 'Factures', type: int },
        { key: 'b0', header: '0–30 j', type: money },
        { key: 'b1', header: '31–60 j', type: money },
        { key: 'b2', header: '61–90 j', type: money },
        { key: 'b3', header: '> 90 j', type: money },
        { key: 'total', header: 'Total dû', type: money },
        { key: 'overdue', header: 'Dont échu', type: money },
        { key: 'credit', header: 'Crédit disponible', type: money },
      ],
      rows,
      totals: {
        client: 'Total',
        invoices: total(rows, 'invoices'),
        b0: aging.totals.buckets[0]!,
        b1: aging.totals.buckets[1]!,
        b2: aging.totals.buckets[2]!,
        b3: aging.totals.buckets[3]!,
        total: aging.totals.total,
        overdue: aging.totals.overdue,
        credit: total(rows, 'credit'),
      },
      chart: {
        type: 'bar',
        x: 'client',
        series: [{ key: 'total', label: 'Total dû', type: money }],
      },
      notes: ['Ancienneté calculée depuis la date de la facture.'],
    });
  }

  async topDebtors(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<
      {
        name: string;
        code: string;
        balance: bigint;
        credit_limit: bigint | null;
        overdue: bigint;
        oldest: Date | null;
      }[]
    >`
      SELECT c.name, c.code, c.balance::bigint AS balance, c.credit_limit::bigint AS credit_limit,
             COALESCE((SELECT SUM(s.amount_due) FROM sales s WHERE s.client_id = c.id AND s.status = 'VALIDATED'
                       AND s.amount_due > 0 AND s.due_date < ${ctx.today}::date), 0)::bigint AS overdue,
             (SELECT MIN(s.validated_at) FROM sales s WHERE s.client_id = c.id AND s.status = 'VALIDATED' AND s.amount_due > 0) AS oldest
      FROM clients c WHERE c.balance > 0 AND NOT c.is_walk_in
      ORDER BY c.balance DESC LIMIT 100`;
    const rows: Row[] = result.map((r) => ({
      client: `${r.name} (${r.code})`,
      balance: n(r.balance),
      creditLimit: r.credit_limit === null ? null : n(r.credit_limit),
      overdue: n(r.overdue),
      oldest: r.oldest ? r.oldest.toISOString().slice(0, 10) : null,
    }));
    return emptyResult('top-debtors', REPORTS['top-debtors'].label, null, {
      kpis: [
        {
          key: 'total',
          label: 'Total des soldes débiteurs',
          type: money,
          value: total(rows, 'balance'),
        },
      ],
      columns: [
        { key: 'client', header: 'Client', type: text },
        { key: 'balance', header: 'Solde débiteur', type: money },
        { key: 'creditLimit', header: 'Plafond de crédit', type: money },
        { key: 'overdue', header: 'Dont échu', type: money },
        { key: 'oldest', header: 'Plus ancienne facture', type: 'date' },
      ],
      rows,
      totals: { client: 'Total', balance: total(rows, 'balance'), overdue: total(rows, 'overdue') },
      chart: {
        type: 'bar',
        x: 'client',
        series: [{ key: 'balance', label: 'Solde débiteur', type: money }],
      },
    });
  }

  /** Encaissements par jour et par mode de paiement. */
  async collections(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<{ day: string; method: string; amount: bigint }[]>`
      SELECT to_char(timezone(${ctx.tz}, paid_at), 'YYYY-MM-DD') AS day, method::text AS method,
             SUM(amount - refunded_amount)::bigint AS amount
      FROM payments WHERE status = 'VALID' AND paid_at >= ${ctx.fromTs} AND paid_at < ${ctx.toTs}
      GROUP BY 1, 2 ORDER BY 1`;
    const methods = (Object.keys(PAYMENT_METHODS) as PaymentMethod[]).filter((m) =>
      result.some((r) => r.method === m),
    );
    const byDay = new Map<string, Row>();
    for (let d = ctx.from, g = 0; d <= ctx.to && g < 1100; d = addDaysIso(d, 1), g += 1)
      byDay.set(d, { day: d, total: 0 });
    for (const r of result) {
      const row = byDay.get(r.day) ?? { day: r.day, total: 0 };
      row[r.method] = n(row[r.method]) + n(r.amount);
      row.total = n(row.total) + n(r.amount);
      byDay.set(r.day, row);
    }
    const rows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    return emptyResult('collections', REPORTS.collections.label, ctx, {
      columns: [
        { key: 'day', header: 'Jour', type: 'date' },
        ...methods.map((m) => ({ key: m, header: PAYMENT_METHODS[m], type: money })),
        { key: 'total', header: 'Total', type: money },
      ],
      rows,
      totals: {
        day: 'Total',
        ...Object.fromEntries(methods.map((m) => [m, total(rows, m)])),
        total: total(rows, 'total'),
      },
      chart: {
        type: 'bar',
        x: 'day',
        series: [{ key: 'total', label: 'Encaissements', type: money }],
      },
    });
  }

  // -------------------------------------------------------------------------
  // Caisse
  // -------------------------------------------------------------------------

  async cashVariances(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<
      {
        number: string;
        closed_at: Date;
        user: string;
        device: string;
        expected: bigint;
        counted: bigint;
        difference: bigint;
      }[]
    >`
      SELECT s.number, s.closed_at, u.code || ' — ' || u.full_name AS "user", d.name AS device,
             s.expected_amount::bigint AS expected, s.counted_amount::bigint AS counted, s.difference::bigint AS difference
      FROM cash_sessions s JOIN users u ON u.id = s.user_id JOIN devices d ON d.id = s.device_id
      WHERE s.status = 'CLOSED' AND s.closed_at >= ${ctx.fromTs} AND s.closed_at < ${ctx.toTs}
      ORDER BY s.closed_at`;
    const rows: Row[] = result.map((r) => ({
      number: r.number,
      closedAt: r.closed_at.toISOString(),
      user: r.user,
      device: r.device,
      expected: n(r.expected),
      counted: n(r.counted),
      difference: n(r.difference),
    }));
    const byUser = new Map<string, number>();
    for (const r of rows)
      byUser.set(String(r.user), (byUser.get(String(r.user)) ?? 0) + n(r.difference));
    const worst = [...byUser.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    return emptyResult('cash-variances', REPORTS['cash-variances'].label, ctx, {
      kpis: [
        { key: 'sessions', label: 'Sessions clôturées', type: int, value: rows.length },
        {
          key: 'withVariance',
          label: 'Sessions avec écart',
          type: int,
          value: rows.filter((r) => n(r.difference) !== 0).length,
        },
        { key: 'net', label: 'Écart net', type: money, value: total(rows, 'difference') },
        {
          key: 'gross',
          label: 'Écarts cumulés (valeur absolue)',
          type: money,
          value: rows.reduce((a, r) => a + Math.abs(n(r.difference)), 0),
        },
      ],
      columns: [
        { key: 'number', header: 'Session', type: text },
        { key: 'closedAt', header: 'Clôturée le', type: 'datetime' },
        { key: 'user', header: 'Utilisateur', type: text },
        { key: 'device', header: 'Poste', type: text },
        { key: 'expected', header: 'Théorique', type: money },
        { key: 'counted', header: 'Compté', type: money },
        { key: 'difference', header: 'Écart', type: money },
      ],
      rows,
      totals: {
        number: 'Total',
        expected: total(rows, 'expected'),
        counted: total(rows, 'counted'),
        difference: total(rows, 'difference'),
      },
      chart: {
        type: 'bar',
        x: 'number',
        series: [{ key: 'difference', label: 'Écart', type: money }],
      },
      notes: worst ? [`Écart cumulé le plus marqué : ${worst[0]} (${worst[1] / 1000} DT).`] : [],
    });
  }
}
