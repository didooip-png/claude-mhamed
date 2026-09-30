import { Injectable } from '@nestjs/common';
import { addDaysIso, todayIso } from '@pharmastock/shared';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Jours de couverture visés au-delà du délai fournisseur quand le produit n'a pas de stock maximum. */
export const REORDER_COVER_DAYS = 15;

export interface ReorderSuggestion {
  productId: string;
  internalCode: string;
  name: string;
  dosage: string | null;
  form: string | null;
  unitsPerPack: number;
  sellByUnit: boolean;
  /** Stock vendable (lots actifs non périmés), en unités de base. */
  sellable: number;
  minStock: number;
  maxStock: number | null;
  /** Consommation moyenne par jour sur la période, en unités de base. */
  avgDaily: number;
  leadDays: number;
  /** Stock restant en jours de consommation (null si aucune consommation). */
  daysOfStock: number | null;
  suggestedQty: number;
  supplier: { id: string; code: string; name: string } | null;
  lastUnitCostHt: number | null;
  estimatedCostHt: number | null;
}

/**
 * Suggestions de réapprovisionnement (§6.14) : quantité = objectif − stock vendable, avec
 * objectif = stock maximum du produit, sinon minimum + consommation moyenne × (délai + 15 jours).
 * Un produit est proposé lorsque son stock vendable est sous son point de commande
 * (minimum + consommation pendant le délai fournisseur).
 */
@Injectable()
export class ReorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async suggestions(
    actor: Actor | null,
    options: { supplierId?: string } = {},
  ): Promise<ReorderSuggestion[]> {
    const settings = await this.settings.all();
    const days = settings['stock.reorder_consumption_days'];
    const defaultLead = settings['stock.default_supplier_lead_days'];
    const today = todayIso(settings['general.timezone'], now());
    const since = new Date(now().getTime() - days * 86_400_000);
    const showCosts = !actor || actor.permissions.has('catalog.view_costs');

    const [products, consumption, stocks, lastLots] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          internalCode: true,
          name: true,
          dosage: true,
          form: true,
          unitsPerPack: true,
          sellByUnit: true,
          minStock: true,
          maxStock: true,
          refPurchasePriceHt: true,
        },
      }),
      this.prisma.$queryRaw<{ product_id: string; sold: bigint }[]>`
        SELECT product_id, COALESCE(-SUM(qty), 0)::bigint AS sold
        FROM stock_movements
        WHERE created_at >= ${since}
          AND type IN ('SALE_OUT', 'SALE_CANCEL', 'CUSTOMER_RETURN_IN')
        GROUP BY product_id`,
      this.prisma.$queryRaw<{ product_id: string; sellable: bigint }[]>`
        SELECT product_id, COALESCE(SUM(remaining_qty), 0)::bigint AS sellable
        FROM lots
        WHERE status = 'ACTIVE' AND expiry_date > ${new Date(`${today}T00:00:00Z`)}
        GROUP BY product_id`,
      this.prisma.$queryRaw<
        { product_id: string; supplier_id: string | null; unit_cost_ht: bigint }[]
      >`
        SELECT DISTINCT ON (product_id) product_id, supplier_id, unit_cost_ht
        FROM lots WHERE supplier_id IS NOT NULL
        ORDER BY product_id, received_at DESC`,
    ]);
    const soldBy = new Map(consumption.map((c) => [c.product_id, Number(c.sold)]));
    const stockBy = new Map(stocks.map((s) => [s.product_id, Number(s.sellable)]));
    const lastBy = new Map(lastLots.map((l) => [l.product_id, l]));
    const suppliers = await this.prisma.supplier.findMany({
      select: { id: true, code: true, name: true, leadTimeDays: true },
    });
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    const out: ReorderSuggestion[] = [];
    for (const p of products) {
      const last = lastBy.get(p.id);
      const supplier = last?.supplier_id ? (supplierById.get(last.supplier_id) ?? null) : null;
      if (options.supplierId && supplier?.id !== options.supplierId) continue;
      const sold = Math.max(0, soldBy.get(p.id) ?? 0);
      if (sold === 0 && p.minStock === 0) continue; // ni consommation ni seuil : rien à proposer
      const sellable = stockBy.get(p.id) ?? 0;
      const avgDaily = sold / days;
      const leadDays = supplier?.leadTimeDays ?? defaultLead;
      const reorderPoint = p.minStock + Math.ceil(avgDaily * leadDays);
      if (sellable > reorderPoint) continue;
      const target =
        p.maxStock ?? Math.ceil(p.minStock + avgDaily * (leadDays + REORDER_COVER_DAYS));
      const packSize = p.sellByUnit ? p.unitsPerPack : 1;
      const need = target - sellable;
      if (need <= 0) continue;
      const suggestedQty = Math.ceil(need / packSize) * packSize;
      const unitCost = last ? num(last.unit_cost_ht) : null;
      out.push({
        productId: p.id,
        internalCode: p.internalCode,
        name: p.name,
        dosage: p.dosage,
        form: p.form,
        unitsPerPack: p.unitsPerPack,
        sellByUnit: p.sellByUnit,
        sellable,
        minStock: p.minStock,
        maxStock: p.maxStock,
        avgDaily: Math.round(avgDaily * 100) / 100,
        leadDays,
        daysOfStock: avgDaily > 0 ? Math.round((sellable / avgDaily) * 10) / 10 : null,
        suggestedQty,
        supplier: supplier ? { id: supplier.id, code: supplier.code, name: supplier.name } : null,
        lastUnitCostHt: showCosts ? unitCost : null,
        estimatedCostHt: showCosts && unitCost !== null ? unitCost * suggestedQty : null,
      });
    }
    // Les ruptures d'abord, puis les moins couverts.
    return out.sort(
      (a, b) =>
        Number(b.sellable === 0) - Number(a.sellable === 0) ||
        (a.daysOfStock ?? 9999) - (b.daysOfStock ?? 9999) ||
        a.name.localeCompare(b.name, 'fr'),
    );
  }
}

/** Date locale d'il y a N jours (utilitaire de tâches). */
export function isoDaysAgo(today: string, n: number): string {
  return addDaysIso(today, -n);
}
