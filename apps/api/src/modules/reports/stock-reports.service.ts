import { Injectable } from '@nestjs/common';
import {
  addDaysIso,
  diffDaysIso,
  REPORTS,
  STOCK_MOVEMENT_TYPES,
  type ReportResult,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { bp, emptyResult, n, total, type ReportContext, type Row } from './report-helpers.js';

const money = 'money' as const;
const int = 'int' as const;
const text = 'text' as const;
const qty = 'qty' as const;
const percent = 'percent' as const;

/** Prix de vente TTC d'une unité de base d'un produit (boîte, ou unité si vendu à l'unité). */
const UNIT_SALE_PRICE = Prisma.sql`(CASE WHEN p.sell_by_unit AND p.units_per_pack > 1
  THEN COALESCE(p.unit_sale_price_ttc, ROUND(p.sale_price_ttc::numeric / p.units_per_pack))
  ELSE p.sale_price_ttc END)`;

/**
 * Rapports de stock, de péremptions, de pertes et d'achats (§6.15). Les états de stock sont
 * pris à l'instant de la demande ; le stock à une date passée est dans « Stock à date ».
 */
@Injectable()
export class StockReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async valuation(ctx: ReportContext): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<
      {
        label: string;
        products: bigint;
        units: bigint;
        cost: bigint;
        sale: bigint;
        expired_cost: bigint;
      }[]
    >(Prisma.sql`
      SELECT c.name AS label, COUNT(DISTINCT p.id)::bigint AS products,
             SUM(l.remaining_qty)::bigint AS units,
             SUM(l.remaining_qty * l.unit_cost_ht)::bigint AS cost,
             SUM(l.remaining_qty * ${UNIT_SALE_PRICE})::bigint AS sale,
             COALESCE(SUM(l.remaining_qty * l.unit_cost_ht) FILTER (WHERE l.expiry_date <= ${ctx.today}::date), 0)::bigint AS expired_cost
      FROM lots l JOIN products p ON p.id = l.product_id JOIN categories c ON c.id = p.category_id
      WHERE l.remaining_qty > 0
      GROUP BY c.name ORDER BY SUM(l.remaining_qty * l.unit_cost_ht) DESC`);
    const data: Row[] = rows.map((r) => ({
      label: r.label,
      products: n(r.products),
      units: n(r.units),
      cost: n(r.cost),
      sale: n(r.sale),
      expired: n(r.expired_cost),
      markup: bp(n(r.sale) - n(r.cost), n(r.cost)),
    }));
    const cost = total(data, 'cost');
    const sale = total(data, 'sale');
    return emptyResult('stock-valuation', REPORTS['stock-valuation'].label, null, {
      kpis: [
        { key: 'cost', label: 'Valeur au coût d’achat', type: money, value: cost },
        { key: 'sale', label: 'Valeur au prix de vente TTC', type: money, value: sale },
        {
          key: 'expired',
          label: 'Dont lots périmés (coût)',
          type: money,
          value: total(data, 'expired'),
        },
      ],
      columns: [
        { key: 'label', header: 'Catégorie', type: text },
        { key: 'products', header: 'Produits', type: int },
        { key: 'units', header: 'Unités', type: qty },
        { key: 'cost', header: 'Valeur au coût', type: money },
        { key: 'sale', header: 'Valeur de vente TTC', type: money },
        { key: 'expired', header: 'Périmés (coût)', type: money },
        { key: 'markup', header: 'Marge potentielle', type: percent },
      ],
      rows: data,
      totals: {
        label: 'Total',
        units: total(data, 'units'),
        cost,
        sale,
        expired: total(data, 'expired'),
        markup: bp(sale - cost, cost),
      },
      chart: {
        type: 'pie',
        x: 'label',
        series: [{ key: 'cost', label: 'Valeur au coût', type: money }],
      },
      notes: [
        `État au ${ctx.today.split('-').reverse().join('/')} ; tous les lots en stock (y compris bloqués et périmés).`,
        'Valeur de vente : prix catalogue TTC de l’unité de base.',
      ],
    });
  }

  async rotation(ctx: ReportContext): Promise<ReportResult> {
    const days = Math.max(1, diffDaysIso(ctx.from, ctx.to) + 1);
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        label: string;
        sold: bigint;
        cogs: bigint;
        stock: bigint;
        stock_cost: bigint;
      }[]
    >(Prisma.sql`
      SELECT p.id::text AS id, p.name || COALESCE(' ' || p.dosage, '') AS label,
             COALESCE(m.sold, 0)::bigint AS sold, COALESCE(m.cogs, 0)::bigint AS cogs,
             COALESCE(l.stock, 0)::bigint AS stock, COALESCE(l.stock_cost, 0)::bigint AS stock_cost
      FROM products p
      LEFT JOIN (
        SELECT product_id, -SUM(qty) AS sold, -SUM(qty * unit_cost_ht) AS cogs
        FROM stock_movements
        WHERE type IN ('SALE_OUT', 'SALE_CANCEL', 'CUSTOMER_RETURN_IN')
          AND created_at >= ${ctx.fromTs} AND created_at < ${ctx.toTs}
        GROUP BY product_id
      ) m ON m.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(remaining_qty) AS stock, SUM(remaining_qty * unit_cost_ht) AS stock_cost
        FROM lots WHERE remaining_qty > 0 GROUP BY product_id
      ) l ON l.product_id = p.id
      WHERE p.is_active AND (COALESCE(m.sold, 0) > 0 OR COALESCE(l.stock, 0) > 0)
      ORDER BY COALESCE(m.cogs, 0) DESC, p.name
      LIMIT 500`);
    const data: Row[] = rows.map((r) => {
      const sold = n(r.sold);
      const daily = sold / days;
      return {
        label: r.label,
        sold,
        stock: n(r.stock),
        stockCost: n(r.stock_cost),
        cogs: n(r.cogs),
        // Rotation annualisée : coût des ventes ramené à l'année / valeur du stock actuel.
        rotation:
          n(r.stock_cost) > 0
            ? Math.round(((n(r.cogs) * 365) / days / n(r.stock_cost)) * 100) / 100
            : null,
        coverageDays: daily > 0 ? Math.round((n(r.stock) / daily) * 10) / 10 : null,
      };
    });
    return emptyResult('stock-rotation', REPORTS['stock-rotation'].label, ctx, {
      columns: [
        { key: 'label', header: 'Produit', type: text },
        { key: 'sold', header: 'Vendu (unités)', type: qty },
        { key: 'cogs', header: 'Coût des ventes', type: money },
        { key: 'stock', header: 'Stock (unités)', type: qty },
        { key: 'stockCost', header: 'Valeur du stock', type: money },
        { key: 'rotation', header: 'Rotation annuelle', type: 'decimal' },
        { key: 'coverageDays', header: 'Couverture (jours)', type: 'decimal' },
      ],
      rows: data,
      totals: {
        label: 'Total',
        sold: total(data, 'sold'),
        cogs: total(data, 'cogs'),
        stock: total(data, 'stock'),
        stockCost: total(data, 'stockCost'),
      },
      notes: [
        'Rotation = coût des ventes annualisé / valeur du stock actuel. Couverture = stock / vente moyenne par jour sur la période.',
        'Les 500 produits au coût des ventes le plus élevé.',
      ],
    });
  }

  async dormant(ctx: ReportContext): Promise<ReportResult> {
    const days = ctx.query.days ?? ctx.settings['stock.dormant_days'];
    const limit = new Date(`${addDaysIso(ctx.today, -days)}T00:00:00Z`);
    const rows = await this.prisma.$queryRaw<
      {
        label: string;
        code: string;
        stock: bigint;
        stock_cost: bigint;
        last_sale: Date | null;
      }[]
    >(Prisma.sql`
      SELECT p.name || COALESCE(' ' || p.dosage, '') AS label, p.internal_code AS code,
             l.stock::bigint AS stock, l.stock_cost::bigint AS stock_cost, m.last_sale
      FROM products p
      JOIN (SELECT product_id, SUM(remaining_qty) AS stock, SUM(remaining_qty * unit_cost_ht) AS stock_cost
            FROM lots WHERE remaining_qty > 0 GROUP BY product_id) l ON l.product_id = p.id
      LEFT JOIN (SELECT product_id, MAX(created_at) AS last_sale FROM stock_movements
                 WHERE type = 'SALE_OUT' GROUP BY product_id) m ON m.product_id = p.id
      WHERE p.is_active AND (m.last_sale IS NULL OR m.last_sale < ${limit})
      ORDER BY l.stock_cost DESC`);
    const data: Row[] = rows.map((r) => ({
      code: r.code,
      label: r.label,
      stock: n(r.stock),
      stockCost: n(r.stock_cost),
      lastSale: r.last_sale ? r.last_sale.toISOString().slice(0, 10) : null,
      daysSince: r.last_sale
        ? diffDaysIso(r.last_sale.toISOString().slice(0, 10), ctx.today)
        : null,
    }));
    return emptyResult('stock-dormant', REPORTS['stock-dormant'].label, null, {
      kpis: [
        {
          key: 'count',
          label: `Produits sans vente depuis ${days} jours`,
          type: int,
          value: data.length,
        },
        {
          key: 'value',
          label: 'Capital immobilisé (coût)',
          type: money,
          value: total(data, 'stockCost'),
        },
      ],
      columns: [
        { key: 'code', header: 'Code', type: text },
        { key: 'label', header: 'Produit', type: text },
        { key: 'stock', header: 'Stock (unités)', type: qty },
        { key: 'stockCost', header: 'Valeur au coût', type: money },
        { key: 'lastSale', header: 'Dernière vente', type: 'date' },
        { key: 'daysSince', header: 'Jours sans vente', type: int },
      ],
      rows: data,
      totals: { label: 'Total', stock: total(data, 'stock'), stockCost: total(data, 'stockCost') },
      notes: [`Seuil : ${days} jours sans vente (paramètre « Produit dormant »).`],
    });
  }

  // -------------------------------------------------------------------------
  // Péremptions et pertes
  // -------------------------------------------------------------------------

  async expiryValue(ctx: ReportContext): Promise<ReportResult> {
    const thresholds = [...ctx.settings['stock.expiry_alert_days']].sort((a, b) => a - b);
    const horizon = new Date(
      `${addDaysIso(ctx.today, thresholds[thresholds.length - 1]!)}T00:00:00Z`,
    );
    const lots = await this.prisma.$queryRaw<
      { expiry: Date; units: bigint; cost: bigint; sale: bigint; blocked: boolean }[]
    >(Prisma.sql`
      SELECT l.expiry_date AS expiry, l.remaining_qty::bigint AS units,
             (l.remaining_qty * l.unit_cost_ht)::bigint AS cost,
             (l.remaining_qty * ${UNIT_SALE_PRICE})::bigint AS sale,
             (l.status IN ('BLOCKED', 'QUARANTINE')) AS blocked
      FROM lots l JOIN products p ON p.id = l.product_id
      WHERE l.remaining_qty > 0 AND l.expiry_date <= ${horizon}::date`);
    const buckets: { label: string; test: (d: number) => boolean }[] = [
      { label: 'Périmés', test: (d) => d <= 0 },
      ...thresholds.map((t, i) => ({
        label: `Dans ${i === 0 ? '' : `${thresholds[i - 1]! + 1} à `}${t} jours`,
        test: (d: number) => d > (i === 0 ? 0 : thresholds[i - 1]!) && d <= t,
      })),
    ];
    const data: Row[] = buckets.map((b) => {
      const list = lots.filter((l) =>
        b.test(diffDaysIso(ctx.today, l.expiry.toISOString().slice(0, 10))),
      );
      return {
        label: b.label,
        lots: list.length,
        units: list.reduce((a, l) => a + n(l.units), 0),
        cost: list.reduce((a, l) => a + n(l.cost), 0),
        sale: list.reduce((a, l) => a + n(l.sale), 0),
        blocked: list.filter((l) => l.blocked).length,
      };
    });
    return emptyResult('expiry-value', REPORTS['expiry-value'].label, null, {
      kpis: [
        {
          key: 'expired',
          label: 'Périmés encore en stock (coût)',
          type: money,
          value: n(data[0]?.cost),
        },
        {
          key: 'risk',
          label: 'À risque, tous seuils (coût)',
          type: money,
          value: total(data, 'cost'),
        },
      ],
      columns: [
        { key: 'label', header: 'Échéance', type: text },
        { key: 'lots', header: 'Lots', type: int },
        { key: 'units', header: 'Unités', type: qty },
        { key: 'cost', header: 'Valeur au coût', type: money },
        { key: 'sale', header: 'Valeur de vente TTC', type: money },
        { key: 'blocked', header: 'Dont bloqués', type: int },
      ],
      rows: data,
      totals: {
        label: 'Total',
        lots: total(data, 'lots'),
        units: total(data, 'units'),
        cost: total(data, 'cost'),
        sale: total(data, 'sale'),
        blocked: total(data, 'blocked'),
      },
      chart: {
        type: 'bar',
        x: 'label',
        series: [{ key: 'cost', label: 'Valeur au coût', type: money }],
      },
    });
  }

  async losses(ctx: ReportContext): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<
      { type: string; sign: string; n: bigint; units: bigint; cost: bigint }[]
    >(Prisma.sql`
      SELECT type::text AS type, (CASE WHEN qty < 0 THEN 'loss' ELSE 'gain' END) AS sign,
             COUNT(*)::bigint AS n, SUM(ABS(qty))::bigint AS units, SUM(ABS(qty) * unit_cost_ht)::bigint AS cost
      FROM stock_movements
      WHERE type IN ('LOSS', 'BREAKAGE', 'EXPIRED_DESTRUCTION', 'INVENTORY_ADJUSTMENT', 'CORRECTION')
        AND created_at >= ${ctx.fromTs} AND created_at < ${ctx.toTs}
      GROUP BY 1, 2 ORDER BY 1, 2`);
    const label = (t: string, sign: string) =>
      `${STOCK_MOVEMENT_TYPES[t as keyof typeof STOCK_MOVEMENT_TYPES] ?? t}${
        t === 'INVENTORY_ADJUSTMENT' || t === 'CORRECTION'
          ? sign === 'loss'
            ? ' (manque)'
            : ' (surplus)'
          : ''
      }`;
    const data: Row[] = rows.map((r) => ({
      label: label(r.type, r.sign),
      movements: n(r.n),
      units: n(r.units),
      cost: r.sign === 'loss' ? n(r.cost) : -n(r.cost),
    }));
    const lossCost = rows.filter((r) => r.sign === 'loss').reduce((a, r) => a + n(r.cost), 0);
    const gainCost = rows.filter((r) => r.sign === 'gain').reduce((a, r) => a + n(r.cost), 0);
    return emptyResult('stock-losses', REPORTS['stock-losses'].label, ctx, {
      kpis: [
        { key: 'loss', label: 'Pertes (coût)', type: money, value: lossCost },
        { key: 'gain', label: 'Surplus constatés (coût)', type: money, value: gainCost },
        { key: 'net', label: 'Perte nette (coût)', type: money, value: lossCost - gainCost },
      ],
      columns: [
        { key: 'label', header: 'Nature', type: text },
        { key: 'movements', header: 'Mouvements', type: int },
        { key: 'units', header: 'Unités', type: qty },
        { key: 'cost', header: 'Valeur au coût (perte +, surplus −)', type: money },
      ],
      rows: data,
      totals: {
        label: 'Perte nette',
        movements: total(data, 'movements'),
        units: total(data, 'units'),
        cost: lossCost - gainCost,
      },
      chart: {
        type: 'bar',
        x: 'label',
        series: [{ key: 'cost', label: 'Valeur au coût', type: money }],
      },
    });
  }

  // -------------------------------------------------------------------------
  // Achats
  // -------------------------------------------------------------------------

  async purchasesBySupplier(ctx: ReportContext): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<
      { label: string; n: bigint; ht: bigint; tva: bigint; ttc: bigint }[]
    >`
      SELECT COALESCE(s.name, CASE r.source_type WHEN 'DONATION' THEN 'Dons' WHEN 'TRANSFER' THEN 'Transferts' ELSE 'Autres sources' END) AS label,
             COUNT(*)::bigint AS n, SUM(r.total_ht)::bigint AS ht, SUM(r.total_tva)::bigint AS tva, SUM(r.total_ttc)::bigint AS ttc
      FROM purchase_receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id
      WHERE r.status = 'VALIDATED' AND r.validated_at >= ${ctx.fromTs} AND r.validated_at < ${ctx.toTs}
      GROUP BY 1 ORDER BY SUM(r.total_ht) DESC`;
    const sum = rows.reduce((a, r) => a + n(r.ht), 0);
    const data: Row[] = rows.map((r) => ({
      label: r.label,
      receipts: n(r.n),
      ht: n(r.ht),
      tva: n(r.tva),
      ttc: n(r.ttc),
      share: bp(n(r.ht), sum),
    }));
    return emptyResult('purchases-by-supplier', REPORTS['purchases-by-supplier'].label, ctx, {
      columns: [
        { key: 'label', header: 'Fournisseur', type: text },
        { key: 'receipts', header: 'Réceptions', type: int },
        { key: 'ht', header: 'Total HT', type: money },
        { key: 'tva', header: 'TVA', type: money },
        { key: 'ttc', header: 'Total TTC', type: money },
        { key: 'share', header: 'Part', type: percent },
      ],
      rows: data,
      totals: {
        label: 'Total',
        receipts: total(data, 'receipts'),
        ht: sum,
        tva: total(data, 'tva'),
        ttc: total(data, 'ttc'),
        share: 10_000,
      },
      chart: { type: 'pie', x: 'label', series: [{ key: 'ht', label: 'Total HT', type: money }] },
    });
  }

  async purchasesByProduct(ctx: ReportContext): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<
      { label: string; qty: bigint; free: bigint; ht: bigint }[]
    >`
      SELECT p.name || COALESCE(' ' || p.dosage, '') AS label, SUM(l.qty)::bigint AS qty,
             SUM(l.free_qty)::bigint AS free, SUM(l.line_total_ht)::bigint AS ht
      FROM purchase_receipt_lines l
      JOIN purchase_receipts r ON r.id = l.receipt_id JOIN products p ON p.id = l.product_id
      WHERE r.status = 'VALIDATED' AND r.validated_at >= ${ctx.fromTs} AND r.validated_at < ${ctx.toTs}
      GROUP BY p.id, p.name, p.dosage ORDER BY SUM(l.line_total_ht) DESC LIMIT 500`;
    const data: Row[] = rows.map((r) => ({
      label: r.label,
      qty: n(r.qty),
      free: n(r.free),
      ht: n(r.ht),
      avgCost: n(r.qty) + n(r.free) === 0 ? 0 : Math.round(n(r.ht) / (n(r.qty) + n(r.free))),
    }));
    return emptyResult('purchases-by-product', REPORTS['purchases-by-product'].label, ctx, {
      columns: [
        { key: 'label', header: 'Produit', type: text },
        { key: 'qty', header: 'Quantité achetée', type: qty },
        { key: 'free', header: 'Unités gratuites', type: qty },
        { key: 'ht', header: 'Total HT', type: money },
        { key: 'avgCost', header: 'Coût moyen HT / unité', type: money },
      ],
      rows: data,
      totals: {
        label: 'Total',
        qty: total(data, 'qty'),
        free: total(data, 'free'),
        ht: total(data, 'ht'),
      },
      notes: ['Quantités dans l’unité de réception (boîtes). Les 500 produits les plus achetés.'],
    });
  }

  async purchasePrices(ctx: ReportContext): Promise<ReportResult> {
    const productId = ctx.query.productId;
    if (!productId)
      throw new AppError('VALIDATION_ERROR', undefined, { message: 'Choisissez un produit.' });
    const rows = await this.prisma.$queryRaw<
      {
        at: Date;
        supplier: string | null;
        lot: string;
        qty: bigint;
        free: bigint;
        unit: bigint;
        discount: number;
        total: bigint;
        name: string;
      }[]
    >`
      SELECT r.validated_at AS at, s.name AS supplier, l.lot_number AS lot, l.qty::bigint AS qty,
             l.free_qty::bigint AS free, l.unit_price_ht::bigint AS unit, l.discount_bp AS discount,
             l.line_total_ht::bigint AS total, p.name AS name
      FROM purchase_receipt_lines l
      JOIN purchase_receipts r ON r.id = l.receipt_id JOIN products p ON p.id = l.product_id
      LEFT JOIN suppliers s ON s.id = r.supplier_id
      WHERE l.product_id = ${productId}::uuid AND r.status = 'VALIDATED'
        AND r.validated_at >= ${ctx.fromTs} AND r.validated_at < ${ctx.toTs}
      ORDER BY r.validated_at`;
    const data: Row[] = rows.map((r) => ({
      date: r.at.toISOString().slice(0, 10),
      supplier: r.supplier,
      lot: r.lot,
      qty: n(r.qty),
      free: n(r.free),
      unit: n(r.unit),
      discount: r.discount,
      net: Math.round((n(r.unit) * (10_000 - r.discount)) / 10_000),
      effective: n(r.qty) + n(r.free) === 0 ? 0 : Math.round(n(r.total) / (n(r.qty) + n(r.free))),
    }));
    return emptyResult(
      'purchase-prices',
      `${REPORTS['purchase-prices'].label}${rows[0] ? ` — ${rows[0].name}` : ''}`,
      ctx,
      {
        columns: [
          { key: 'date', header: 'Date', type: 'date' },
          { key: 'supplier', header: 'Fournisseur', type: text },
          { key: 'lot', header: 'Lot', type: text },
          { key: 'qty', header: 'Quantité', type: qty },
          { key: 'free', header: 'UG', type: qty },
          { key: 'unit', header: 'Prix HT', type: money },
          { key: 'discount', header: 'Remise', type: percent },
          { key: 'net', header: 'Prix net HT', type: money },
          { key: 'effective', header: 'Coût effectif (UG comprises)', type: money },
        ],
        rows: data,
        chart: {
          type: 'line',
          x: 'date',
          series: [
            { key: 'net', label: 'Prix net HT', type: money },
            { key: 'effective', label: 'Coût effectif', type: money },
          ],
        },
      },
    );
  }
}
