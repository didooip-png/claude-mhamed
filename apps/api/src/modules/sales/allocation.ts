import { AppError } from '../../common/app-error.js';
import { num } from '../../common/json.js';
import type { PrismaService, Tx } from '../../prisma/prisma.service.js';

export interface AllocationLine {
  index: number;
  productId: string;
  productName: string;
  qtyBase: number;
  forcedLotId: string | null;
}

export interface PlannedAllocation {
  lotId: string;
  lotNumber: string;
  expiryDate: string;
  qty: number;
  unitCostHt: bigint;
  siteId: string;
}

export interface StockIssue {
  productId: string;
  productName: string;
  requested: number;
  sellable: number;
  blocked: number;
  expired: number;
}

interface LotRow {
  id: string;
  product_id: string;
  site_id: string;
  lot_number: string;
  expiry_date: Date;
  remaining_qty: number;
  unit_cost_ht: bigint;
}

/**
 * Allocation des lots (RG-05) : lots vendables (actifs, non périmés, RG-04) triés
 * FEFO (péremption, réception, id) ou FIFO (réception, id). Un lot forcé passe en premier.
 * Plusieurs lignes d'un même produit consomment les lots successivement.
 * Avec `lock`, les lots sont verrouillés (FOR UPDATE) — les produits doivent l'être avant.
 */
export async function planAllocations(
  client: Tx | PrismaService,
  lines: AllocationLine[],
  options: {
    exitRule: 'FEFO' | 'FIFO';
    sellableFrom: string;
    lock: boolean;
    throwOnShortage: boolean;
  },
): Promise<{ plans: Map<number, PlannedAllocation[]>; issues: StockIssue[] }> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const plans = new Map<number, PlannedAllocation[]>();
  if (productIds.length === 0) return { plans, issues: [] };
  const order =
    options.exitRule === 'FIFO'
      ? 'received_at ASC, id ASC'
      : 'expiry_date ASC, received_at ASC, id ASC';
  const lockClause = options.lock ? 'FOR UPDATE' : '';
  // Paramètres liés ; seules l'ordre de tri et la clause de verrou (valeurs fixes) sont interpolés.
  const lots = await client.$queryRawUnsafe<LotRow[]>(
    `SELECT id, product_id, site_id, lot_number, expiry_date, remaining_qty, unit_cost_ht
     FROM lots
     WHERE product_id = ANY($1::uuid[]) AND status = 'ACTIVE' AND remaining_qty > 0 AND expiry_date > $2::date
     ORDER BY product_id, ${order} ${lockClause}`,
    productIds,
    options.sellableFrom,
  );
  const byProduct = new Map<string, LotRow[]>();
  for (const lot of lots)
    byProduct.set(lot.product_id, [...(byProduct.get(lot.product_id) ?? []), lot]);
  const remaining = new Map(lots.map((l) => [l.id, l.remaining_qty]));
  const issues: StockIssue[] = [];

  for (const line of lines) {
    const available = [...(byProduct.get(line.productId) ?? [])];
    if (line.forcedLotId) {
      const idx = available.findIndex((l) => l.id === line.forcedLotId);
      if (idx < 0) {
        if (options.throwOnShortage)
          throw new AppError('LOT_NOT_SELLABLE', {
            lotId: line.forcedLotId,
            product: line.productName,
          });
      } else {
        const [forced] = available.splice(idx, 1);
        available.unshift(forced!);
      }
    }
    let need = line.qtyBase;
    const plan: PlannedAllocation[] = [];
    for (const lot of available) {
      if (need === 0) break;
      const left = remaining.get(lot.id) ?? 0;
      if (left <= 0) continue;
      const take = Math.min(need, left);
      remaining.set(lot.id, left - take);
      plan.push({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        expiryDate: lot.expiry_date.toISOString().slice(0, 10),
        qty: take,
        unitCostHt: lot.unit_cost_ht,
        siteId: lot.site_id,
      });
      need -= take;
    }
    plans.set(line.index, plan);
    if (need > 0) {
      issues.push({
        productId: line.productId,
        productName: line.productName,
        requested: line.qtyBase,
        sellable: line.qtyBase - need,
        blocked: 0,
        expired: 0,
      });
    }
  }

  if (issues.length > 0) {
    // Détail du stock non vendable (bloqué / périmé) pour un message d'erreur clair (RG-03).
    const details = await client.$queryRaw<
      { product_id: string; blocked: bigint; expired: bigint; sellable: bigint }[]
    >`
      SELECT product_id,
        COALESCE(SUM(remaining_qty) FILTER (WHERE status IN ('BLOCKED', 'QUARANTINE')), 0)::bigint AS blocked,
        COALESCE(SUM(remaining_qty) FILTER (WHERE status = 'ACTIVE' AND expiry_date <= ${options.sellableFrom}::date), 0)::bigint AS expired,
        COALESCE(SUM(remaining_qty) FILTER (WHERE status = 'ACTIVE' AND expiry_date > ${options.sellableFrom}::date), 0)::bigint AS sellable
      FROM lots WHERE product_id = ANY(${issues.map((i) => i.productId)}::uuid[]) GROUP BY product_id`;
    for (const issue of issues) {
      const d = details.find((x) => x.product_id === issue.productId);
      issue.blocked = num(d?.blocked);
      issue.expired = num(d?.expired);
      issue.sellable = num(d?.sellable);
    }
    if (options.throwOnShortage) throw new AppError('STOCK_INSUFFICIENT', { issues });
  }
  return { plans, issues };
}
