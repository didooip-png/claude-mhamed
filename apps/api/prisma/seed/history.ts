import type { INestApplicationContext } from '@nestjs/common';
import { addMonthsIso, weekdayOf } from '@pharmastock/shared';
import { setSeedClock } from '../../src/common/clock.js';
import type { Actor } from '../../src/common/request-context.js';
import type { ReceiptsService } from '../../src/modules/receipts/receipts.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import type { rng, SeedClient, SeedProduct } from './data.js';
import { supplierFor } from './demo.js';

export interface SeedContext {
  app: INestApplicationContext;
  prisma: PrismaService;
  random: ReturnType<typeof rng>;
  at: (day: string, hour: number, minute?: number) => Date;
  start: string;
  today: string;
  actors: { admin: Actor; adminReserve: Actor; pre1: Actor; pre2: Actor; pre1Reserve: Actor };
  products: {
    id: string;
    seed: SeedProduct;
    purchaseHt: number;
    tvaBp: number;
    unitsPerPack: number;
    sellByUnit: boolean;
    salePrice: number;
  }[];
  supplierIds: string[];
  clientIds: string[];
  clientsData: SeedClient[];
  receipts: ReceiptsService;
}

/** Activité d'une journée d'historique (appelée dans l'ordre chronologique). */
export async function runDailyActivity(
  ctx: SeedContext,
  day: string,
  isToday: boolean,
): Promise<void> {
  const weekday = weekdayOf(day); // 0 = lundi … 6 = dimanche
  if (weekday === 6) return; // fermé le dimanche
  if (!isToday && (weekday === 1 || weekday === 4)) await replenish(ctx, day);
}

/** Réapprovisionnement deux fois par semaine : les produits sous le point de commande. */
async function replenish(ctx: SeedContext, day: string): Promise<void> {
  const sellableFrom = day;
  const rows = await ctx.prisma.$queryRaw<{ product_id: string; sellable: bigint }[]>`
    SELECT product_id, COALESCE(SUM(remaining_qty) FILTER (WHERE status = 'ACTIVE' AND expiry_date > ${sellableFrom}::date), 0)::bigint AS sellable
    FROM lots GROUP BY product_id`;
  const sellable = new Map(rows.map((r) => [r.product_id, Number(r.sellable)]));
  const bySupplier = new Map<string, SeedContext['products']>();
  for (const p of ctx.products) {
    const factor = p.sellByUnit ? p.unitsPerPack : 1;
    const current = (sellable.get(p.id) ?? 0) / factor;
    const threshold = p.seed.minStock * 2;
    if (current < threshold || ctx.random.chance(0.04)) {
      const supplierId = supplierFor(ctx, p);
      bySupplier.set(supplierId, [...(bySupplier.get(supplierId) ?? []), p]);
    }
  }
  let hour = 9;
  for (const [supplierId, products] of bySupplier) {
    const actor = ctx.random.chance(0.6) ? ctx.actors.pre1Reserve : ctx.actors.adminReserve;
    const lines = products.map((p) => {
      const qty = Math.max(5, Math.round(p.seed.minStock * ctx.random.int(3, 6)));
      const priceDrift = ctx.random.chance(0.15) ? ctx.random.int(-4, 6) / 100 : 0;
      return {
        productId: p.id,
        lotNumber: `${p.seed.dci.slice(0, 3).toUpperCase()}${ctx.random.int(10000, 99999)}`,
        expiryDate: addMonthsIso(day, ctx.random.int(8, 30)),
        qty,
        freeQty: qty >= 30 && ctx.random.chance(0.25) ? Math.round(qty / 10) : 0,
        unitPriceHt: Math.round((p.purchaseHt * (1 + priceDrift)) / 10) * 10,
        discountBp: ctx.random.chance(0.2) ? 300 : 0,
        tvaRateBp: p.tvaBp,
      };
    });
    setSeedClock(ctx.at(day, hour, ctx.random.int(0, 20)));
    const draft = await ctx.receipts.createDraft(
      {
        sourceType: 'SUPPLIER',
        supplierId,
        supplierInvoiceRef: `FV-${ctx.random.int(10000, 99999)}`,
        supplierInvoiceDate: day,
        receivedAt: day,
        notes: null,
        lines,
        sourceReason: null,
        attachmentId: null,
      },
      actor,
    );
    setSeedClock(ctx.at(day, hour, ctx.random.int(25, 55)));
    await ctx.receipts.validate(
      draft.id,
      { acknowledgeWarnings: true, updateReferencePrices: false },
      actor,
    );
    hour += 1;
  }
}
