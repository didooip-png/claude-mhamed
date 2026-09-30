import { Injectable } from '@nestjs/common';
import {
  PAYMENT_METHODS,
  REPORTS,
  STOCK_MOVEMENT_TYPES,
  type ReportResult,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { emptyResult, n, total, type ReportContext, type Row } from './report-helpers.js';

const money = 'money' as const;
const text = 'text' as const;
const qty = 'qty' as const;

const CLASS_LABEL: Record<string, string> = {
  NONE: '—',
  A: 'Tableau A (liste I)',
  B: 'Tableau B (liste II)',
  C: 'Tableau C (stupéfiants)',
};

/** Journaux imprimables et états réglementaires (§6.15) : ventes, achats, règlements, TVA, tableau, lot. */
@Injectable()
export class JournalsReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async salesJournal(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<
      {
        number: string;
        at: Date;
        status: string;
        client: string | null;
        user: string;
        ht: bigint;
        tva: bigint;
        stamp: bigint;
        ttc: bigint;
        paid: bigint;
        due: bigint;
      }[]
    >`
      SELECT s.number, s.validated_at AS at, s.status::text AS status, c.name AS client, u.code AS "user",
             s.subtotal_ht::bigint AS ht, s.total_tva::bigint AS tva, s.stamp_duty::bigint AS stamp,
             s.total_ttc::bigint AS ttc, s.amount_paid::bigint AS paid, s.amount_due::bigint AS due
      FROM sales s LEFT JOIN clients c ON c.id = s.client_id JOIN users u ON u.id = s.created_by
      WHERE s.number IS NOT NULL AND s.status IN ('VALIDATED', 'CANCELLED')
        AND s.validated_at >= ${ctx.fromTs} AND s.validated_at < ${ctx.toTs}
      ORDER BY s.number`;
    const rows: Row[] = result.map((r) => ({
      number: r.number,
      at: r.at.toISOString(),
      client: r.client,
      user: r.user,
      status: r.status === 'CANCELLED' ? 'Annulée' : 'Validée',
      ht: n(r.ht),
      tva: n(r.tva),
      stamp: n(r.stamp),
      ttc: n(r.ttc),
      paid: n(r.paid),
      due: n(r.due),
    }));
    const valid = rows.filter((r) => r.status === 'Validée');
    return emptyResult('journal-sales', REPORTS['journal-sales'].label, ctx, {
      columns: [
        { key: 'number', header: 'Facture', type: text },
        { key: 'at', header: 'Date', type: 'datetime' },
        { key: 'client', header: 'Client', type: text },
        { key: 'user', header: 'Vendeur', type: text },
        { key: 'status', header: 'Statut', type: text },
        { key: 'ht', header: 'HT', type: money },
        { key: 'tva', header: 'TVA', type: money },
        { key: 'stamp', header: 'Timbre', type: money },
        { key: 'ttc', header: 'TTC', type: money },
        { key: 'paid', header: 'Réglé', type: money },
        { key: 'due', header: 'Reste dû', type: money },
      ],
      rows,
      totals: {
        number: `Total (${valid.length} factures validées)`,
        ht: total(valid, 'ht'),
        tva: total(valid, 'tva'),
        stamp: total(valid, 'stamp'),
        ttc: total(valid, 'ttc'),
        paid: total(valid, 'paid'),
        due: total(valid, 'due'),
      },
      notes: ['Les ventes annulées sont listées mais exclues des totaux.'],
    });
  }

  async purchasesJournal(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<
      {
        number: string;
        at: Date;
        status: string;
        supplier: string | null;
        ref: string | null;
        ht: bigint;
        tva: bigint;
        ttc: bigint;
      }[]
    >`
      SELECT r.number, r.validated_at AS at, r.status::text AS status, s.name AS supplier,
             r.supplier_invoice_ref AS ref, r.total_ht::bigint AS ht, r.total_tva::bigint AS tva, r.total_ttc::bigint AS ttc
      FROM purchase_receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id
      WHERE r.number IS NOT NULL AND r.status IN ('VALIDATED', 'CANCELLED')
        AND r.validated_at >= ${ctx.fromTs} AND r.validated_at < ${ctx.toTs}
      ORDER BY r.number`;
    const rows: Row[] = result.map((r) => ({
      number: r.number,
      at: r.at.toISOString(),
      supplier: r.supplier,
      ref: r.ref,
      status: r.status === 'CANCELLED' ? 'Annulée' : 'Validée',
      ht: n(r.ht),
      tva: n(r.tva),
      ttc: n(r.ttc),
    }));
    const valid = rows.filter((r) => r.status === 'Validée');
    return emptyResult('journal-purchases', REPORTS['journal-purchases'].label, ctx, {
      columns: [
        { key: 'number', header: 'Réception', type: text },
        { key: 'at', header: 'Date', type: 'datetime' },
        { key: 'supplier', header: 'Fournisseur', type: text },
        { key: 'ref', header: 'Facture fournisseur', type: text },
        { key: 'status', header: 'Statut', type: text },
        { key: 'ht', header: 'HT', type: money },
        { key: 'tva', header: 'TVA', type: money },
        { key: 'ttc', header: 'TTC', type: money },
      ],
      rows,
      totals: {
        number: `Total (${valid.length} réceptions)`,
        ht: total(valid, 'ht'),
        tva: total(valid, 'tva'),
        ttc: total(valid, 'ttc'),
      },
    });
  }

  async paymentsJournal(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<
      {
        number: string;
        at: Date;
        client: string;
        method: string;
        amount: bigint;
        status: string;
        cheque: string | null;
        cheque_status: string | null;
        user: string;
      }[]
    >`
      SELECT p.number, p.paid_at AS at, c.name AS client, p.method::text AS method, p.amount::bigint AS amount,
             p.status::text AS status, p.cheque_number AS cheque, p.cheque_status::text AS cheque_status, u.code AS "user"
      FROM payments p JOIN clients c ON c.id = p.client_id JOIN users u ON u.id = p.created_by
      WHERE p.paid_at >= ${ctx.fromTs} AND p.paid_at < ${ctx.toTs}
      ORDER BY p.number`;
    const rows: Row[] = result.map((r) => ({
      number: r.number,
      at: r.at.toISOString(),
      client: r.client,
      method: PAYMENT_METHODS[r.method as keyof typeof PAYMENT_METHODS] ?? r.method,
      cheque: r.cheque,
      amount: n(r.amount),
      status: r.status === 'CANCELLED' ? 'Annulé' : 'Valide',
      user: r.user,
    }));
    const valid = rows.filter((r) => r.status === 'Valide');
    return emptyResult('journal-payments', REPORTS['journal-payments'].label, ctx, {
      columns: [
        { key: 'number', header: 'Règlement', type: text },
        { key: 'at', header: 'Date', type: 'datetime' },
        { key: 'client', header: 'Client', type: text },
        { key: 'method', header: 'Mode', type: text },
        { key: 'cheque', header: 'N° de chèque', type: text },
        { key: 'amount', header: 'Montant', type: money },
        { key: 'status', header: 'Statut', type: text },
        { key: 'user', header: 'Saisi par', type: text },
      ],
      rows,
      totals: {
        number: `Total (${valid.length} règlements valides)`,
        amount: total(valid, 'amount'),
      },
    });
  }

  /** TVA collectée (ventes moins retours) et déductible (achats) par taux, arrondie comme les factures. */
  async vatSummary(ctx: ReportContext): Promise<ReportResult> {
    const [sales, returns, purchases] = await Promise.all([
      this.prisma.$queryRaw<{ rate: number; ttc: bigint; ht: bigint }[]>`
        SELECT x.tva AS rate, SUM(x.ttc)::bigint AS ttc, SUM(ROUND(x.ttc::numeric * 10000 / (10000 + x.tva)))::bigint AS ht
        FROM (SELECT sl.sale_id, sl.tva_rate_bp AS tva, SUM(sl.line_total_ttc) AS ttc
              FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
              WHERE s.status = 'VALIDATED' AND s.validated_at >= ${ctx.fromTs} AND s.validated_at < ${ctx.toTs}
              GROUP BY sl.sale_id, sl.tva_rate_bp) x
        GROUP BY x.tva`,
      this.prisma.$queryRaw<{ rate: number; ttc: bigint; ht: bigint }[]>`
        SELECT x.tva AS rate, SUM(x.ttc)::bigint AS ttc, SUM(ROUND(x.ttc::numeric * 10000 / (10000 + x.tva)))::bigint AS ht
        FROM (SELECT rl.return_id, COALESCE(sl.tva_rate_bp, t.rate_bp) AS tva, SUM(rl.amount) AS ttc
              FROM customer_return_lines rl
              JOIN customer_returns r ON r.id = rl.return_id
              JOIN products p ON p.id = rl.product_id JOIN tva_rates t ON t.id = p.tva_rate_id
              LEFT JOIN sale_lines sl ON sl.id = rl.sale_line_id
              WHERE r.created_at >= ${ctx.fromTs} AND r.created_at < ${ctx.toTs}
              GROUP BY rl.return_id, COALESCE(sl.tva_rate_bp, t.rate_bp)) x
        GROUP BY x.tva`,
      this.prisma.$queryRaw<{ rate: number; ht: bigint; tva: bigint }[]>`
        SELECT x.rate AS rate, SUM(x.ht)::bigint AS ht, SUM(ROUND(x.ht::numeric * x.rate / 10000))::bigint AS tva
        FROM (SELECT l.receipt_id, l.tva_rate_bp AS rate, SUM(l.line_total_ht) AS ht
              FROM purchase_receipt_lines l JOIN purchase_receipts r ON r.id = l.receipt_id
              WHERE r.status = 'VALIDATED' AND r.validated_at >= ${ctx.fromTs} AND r.validated_at < ${ctx.toTs}
              GROUP BY l.receipt_id, l.tva_rate_bp) x
        GROUP BY x.rate`,
    ]);
    const stamp = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(stamp_duty), 0)::bigint AS total FROM sales
      WHERE status = 'VALIDATED' AND validated_at >= ${ctx.fromTs} AND validated_at < ${ctx.toTs}`;
    const rates = [...new Set([...sales, ...returns, ...purchases].map((r) => r.rate))].sort(
      (a, b) => a - b,
    );
    const rows: Row[] = rates.map((rate) => {
      const s = sales.find((r) => r.rate === rate);
      const r = returns.find((x) => x.rate === rate);
      const p = purchases.find((x) => x.rate === rate);
      const collectedBase = n(s?.ht);
      const collectedVat = n(s?.ttc) - n(s?.ht);
      const returnsBase = n(r?.ht);
      const returnsVat = n(r?.ttc) - n(r?.ht);
      const deductibleBase = n(p?.ht);
      const deductibleVat = n(p?.tva);
      return {
        rate,
        collectedBase,
        collectedVat,
        returnsBase,
        returnsVat,
        netVat: collectedVat - returnsVat,
        deductibleBase,
        deductibleVat,
        due: collectedVat - returnsVat - deductibleVat,
      };
    });
    const columns = [
      { key: 'rate', header: 'Taux de TVA', type: 'percent' as const },
      { key: 'collectedBase', header: 'Base HT collectée', type: money },
      { key: 'collectedVat', header: 'TVA collectée', type: money },
      { key: 'returnsBase', header: 'Base HT des retours', type: money },
      { key: 'returnsVat', header: 'TVA des retours', type: money },
      { key: 'netVat', header: 'TVA collectée nette', type: money },
      { key: 'deductibleBase', header: 'Base HT des achats', type: money },
      { key: 'deductibleVat', header: 'TVA déductible', type: money },
      { key: 'due', header: 'TVA à payer', type: money },
    ];
    return emptyResult('vat-summary', REPORTS['vat-summary'].label, ctx, {
      kpis: [
        { key: 'net', label: 'TVA collectée nette', type: money, value: total(rows, 'netVat') },
        { key: 'ded', label: 'TVA déductible', type: money, value: total(rows, 'deductibleVat') },
        { key: 'due', label: 'TVA à payer', type: money, value: total(rows, 'due') },
        { key: 'stamp', label: 'Timbres fiscaux perçus', type: money, value: n(stamp[0]?.total) },
      ],
      columns,
      rows,
      totals: {
        rate: null,
        ...Object.fromEntries(columns.slice(1).map((c) => [c.key, total(rows, c.key)])),
      },
      notes: [
        'Arrondi par facture et par taux, comme sur les factures. Les retours sont rattachés à leur date de saisie.',
        'Le timbre fiscal n’est pas inclus dans les bases de TVA.',
      ],
    });
  }

  /** Registre des produits à tableau : une ligne par lot délivré. */
  async controlledRegister(ctx: ReportContext): Promise<ReportResult> {
    const result = await this.prisma.$queryRaw<
      {
        at: Date;
        product: string;
        class: string;
        lot: string;
        qty: bigint;
        client: string | null;
        prescriber: string | null;
        prescription: string | null;
        number: string;
      }[]
    >`
      SELECT s.validated_at AS at, p.name || COALESCE(' ' || p.dosage, '') AS product, p.controlled_class::text AS class,
             l.lot_number AS lot, (a.qty_base - a.returned_qty_base)::bigint AS qty, c.name AS client,
             s.prescriber_name AS prescriber, s.prescription_ref AS prescription, s.number
      FROM sale_line_allocations a
      JOIN sale_lines sl ON sl.id = a.sale_line_id JOIN sales s ON s.id = sl.sale_id
      JOIN products p ON p.id = sl.product_id JOIN lots l ON l.id = a.lot_id
      LEFT JOIN clients c ON c.id = s.client_id
      WHERE p.controlled_class <> 'NONE' AND s.status = 'VALIDATED'
        AND s.validated_at >= ${ctx.fromTs} AND s.validated_at < ${ctx.toTs} AND a.qty_base - a.returned_qty_base > 0
      ORDER BY s.validated_at, s.number`;
    const rows: Row[] = result.map((r) => ({
      at: r.at.toISOString(),
      product: r.product,
      class: CLASS_LABEL[r.class] ?? r.class,
      lot: r.lot,
      qty: n(r.qty),
      client: r.client,
      prescriber: r.prescriber,
      prescription: r.prescription,
      invoice: r.number,
    }));
    return emptyResult('controlled-register', REPORTS['controlled-register'].label, ctx, {
      columns: [
        { key: 'at', header: 'Date', type: 'datetime' },
        { key: 'product', header: 'Produit', type: text },
        { key: 'class', header: 'Classe', type: text },
        { key: 'lot', header: 'Lot', type: text },
        { key: 'qty', header: 'Quantité', type: qty },
        { key: 'client', header: 'Client', type: text },
        { key: 'prescriber', header: 'Prescripteur', type: text },
        { key: 'prescription', header: 'N° d’ordonnance', type: text },
        { key: 'invoice', header: 'Facture', type: text },
      ],
      rows,
      totals: { at: 'Total', qty: total(rows, 'qty') },
      notes: ['Quantités nettes des retours, une ligne par lot délivré.'],
    });
  }

  /** Traçabilité d'un numéro de lot : tous les mouvements, de la réception aux ventes. */
  async lotTrace(ctx: ReportContext): Promise<ReportResult> {
    const lotNumber = ctx.query.lotNumber;
    if (!lotNumber)
      throw new AppError('VALIDATION_ERROR', undefined, { message: 'Saisissez un numéro de lot.' });
    const result = await this.prisma.$queryRaw<
      {
        at: Date;
        type: string;
        product: string;
        lot: string;
        qty: number;
        balance: number;
        doc: string | null;
        counterpart: string | null;
        user: string;
        reason: string | null;
      }[]
    >(Prisma.sql`
      SELECT m.created_at AS at, m.type::text AS type, p.name || COALESCE(' ' || p.dosage, '') AS product,
             l.lot_number AS lot, m.qty, m.lot_balance_after AS balance, m.document_number AS doc,
             m.counterpart_name AS counterpart, u.code AS "user", m.reason
      FROM stock_movements m JOIN lots l ON l.id = m.lot_id JOIN products p ON p.id = m.product_id
      JOIN users u ON u.id = m.user_id
      WHERE lower(l.lot_number) = lower(${lotNumber})
      ORDER BY l.id, m.id`);
    const rows: Row[] = result.map((r) => ({
      at: r.at.toISOString(),
      type: STOCK_MOVEMENT_TYPES[r.type as keyof typeof STOCK_MOVEMENT_TYPES] ?? r.type,
      product: r.product,
      lot: r.lot,
      qty: r.qty,
      balance: r.balance,
      doc: r.doc,
      counterpart: r.counterpart,
      user: r.user,
      reason: r.reason,
    }));
    return emptyResult('lot-trace', `${REPORTS['lot-trace'].label} — ${lotNumber}`, null, {
      columns: [
        { key: 'at', header: 'Date', type: 'datetime' },
        { key: 'type', header: 'Mouvement', type: text },
        { key: 'product', header: 'Produit', type: text },
        { key: 'lot', header: 'Lot', type: text },
        { key: 'qty', header: 'Quantité', type: qty },
        { key: 'balance', header: 'Solde du lot', type: qty },
        { key: 'doc', header: 'Document', type: text },
        { key: 'counterpart', header: 'Tiers', type: text },
        { key: 'user', header: 'Utilisateur', type: text },
        { key: 'reason', header: 'Motif', type: text },
      ],
      rows,
      notes: rows.length === 0 ? ['Aucun lot ne porte ce numéro.'] : [],
    });
  }
}
