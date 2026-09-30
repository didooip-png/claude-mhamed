import { addDaysIso } from '@pharmastock/shared';
import { setSeedClock } from '../../src/common/clock.js';
import { AdjustmentsService } from '../../src/modules/adjustments/adjustments.service.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { JobsService } from '../../src/modules/jobs/jobs.service.js';
import { SupplierReturnsService } from '../../src/modules/supplier-returns/supplier-returns.service.js';
import type { SeedContext } from './history.js';

/**
 * Phase 4 : un inventaire partiel validé (avec écarts), un inventaire en cours de comptage, des
 * ajustements (casse validée, perte en attente, destruction de périmés), deux retours
 * fournisseurs (avoir attendu, avoir reçu) et une première passe des tâches planifiées.
 */
export async function seedStockOps(ctx: SeedContext): Promise<string> {
  const { prisma, actors, random } = ctx;
  const inventories = ctx.app.get(InventoryService);
  const adjustments = ctx.app.get(AdjustmentsService);
  const supplierReturns = ctx.app.get(SupplierReturnsService);
  const jobs = ctx.app.get(JobsService);
  const summary: string[] = [];

  // --- Inventaire partiel validé : 8 produits, quelques écarts ------------------------
  setSeedClock(ctx.at(ctx.today, 9, 0));
  const counted = ctx.products.filter((p) => p.seed.popularity >= 5).slice(0, 8);
  const inv = await inventories.open(
    {
      scope: { kind: 'PRODUCTS', ids: counted.map((p) => p.id) },
      includeEmptyLots: false,
      notes: 'Inventaire tournant du rayon principal',
    },
    actors.admin,
  );
  const lines = await inventories.lines(
    inv.id,
    { page: 1, pageSize: 200, filter: 'ALL' },
    actors.admin,
  );
  setSeedClock(ctx.at(ctx.today, 9, 40));
  let differences = 0;
  const counts = lines.items.map((l) => {
    const theoretical = l.snapshotQty ?? 0;
    const roll = random.next();
    let countedQty = theoretical;
    if (roll < 0.25 && theoretical > 2) {
      countedQty = theoretical - random.int(1, 2);
      differences += 1;
    } else if (roll < 0.35) {
      countedQty = theoretical + 1;
      differences += 1;
    }
    return { lineId: l.id, countedQty };
  });
  await inventories.count(inv.id, counts, actors.pre1);
  setSeedClock(ctx.at(ctx.today, 10, 5));
  await inventories.validate(inv.id, { ignoreUncounted: false }, actors.admin);
  summary.push(`1 inventaire validé (${differences} écart(s))`);

  // --- Inventaire en cours : une catégorie, comptage à moitié fait --------------------
  setSeedClock(ctx.at(ctx.today, 14, 0));
  const others = ctx.products.filter(
    (p) => !counted.some((c) => c.id === p.id) && p.seed.popularity >= 4,
  );
  const openInv = await inventories.open(
    {
      scope: { kind: 'PRODUCTS', ids: others.slice(0, 6).map((p) => p.id) },
      includeEmptyLots: false,
    },
    actors.admin,
  );
  const openLines = await inventories.lines(
    openInv.id,
    { page: 1, pageSize: 200, filter: 'ALL' },
    actors.admin,
  );
  const half = openLines.items.slice(0, Math.ceil(openLines.items.length / 2));
  setSeedClock(ctx.at(ctx.today, 14, 30));
  await inventories.count(
    openInv.id,
    half.map((l) => ({ lineId: l.id, countedQty: l.snapshotQty ?? 0 })),
    actors.pre2,
  );
  summary.push('1 inventaire en cours');

  // --- Ajustements --------------------------------------------------------------------
  setSeedClock(ctx.at(ctx.today, 11, 0));
  const stocked = await prisma.lot.findMany({
    where: { status: 'ACTIVE', remainingQty: { gt: 5 }, expiryDate: { gt: new Date() } },
    orderBy: { receivedAt: 'desc' },
    take: 6,
  });
  if (stocked[0]) {
    await adjustments.create(
      {
        type: 'BREAKAGE',
        reason: 'Flacon brisé pendant le rangement',
        lines: [{ lotId: stocked[0].id, qty: 1 }],
        validateNow: true,
      },
      actors.admin,
    );
  }
  if (stocked[1]) {
    await adjustments.create(
      {
        type: 'LOSS',
        reason: 'Boîte introuvable après le déménagement du rayon',
        lines: [{ lotId: stocked[1].id, qty: 2 }],
        validateNow: false,
      },
      actors.pre1,
    );
  }
  const expired = await prisma.lot.findMany({
    where: { remainingQty: { gt: 0 }, expiryDate: { lt: new Date(`${ctx.today}T00:00:00Z`) } },
    orderBy: { expiryDate: 'asc' },
    take: 3,
  });
  if (expired.length >= 2) {
    setSeedClock(ctx.at(ctx.today, 11, 30));
    await adjustments.create(
      {
        type: 'EXPIRED_DESTRUCTION',
        reason: 'Destruction trimestrielle des produits périmés',
        lines: expired.slice(0, 2).map((l) => ({ lotId: l.id, qty: l.remainingQty })),
        validateNow: true,
      },
      actors.admin,
    );
    summary.push('destruction de périmés');
  }

  // --- Retours fournisseurs -----------------------------------------------------------
  setSeedClock(ctx.at(ctx.today, 12, 0));
  const soon = await prisma.lot.findMany({
    where: {
      remainingQty: { gt: 3 },
      supplierId: { not: null },
      status: 'ACTIVE',
      expiryDate: {
        gt: new Date(`${ctx.today}T00:00:00Z`),
        lt: new Date(`${addDaysIso(ctx.today, 60)}T00:00:00Z`),
      },
    },
    orderBy: { expiryDate: 'asc' },
    take: 40,
  });
  const bySupplier = new Map<string, typeof soon>();
  for (const l of soon)
    bySupplier.set(l.supplierId!, [...(bySupplier.get(l.supplierId!) ?? []), l]);
  const groups = [...bySupplier.entries()].filter(([, ls]) => ls.length >= 1).slice(0, 2);
  let n = 0;
  for (const [supplierId, ls] of groups) {
    const ret = await supplierReturns.create(
      {
        supplierId,
        reason: 'Lots à courte date, retour convenu avec le fournisseur',
        lines: ls.slice(0, 2).map((l) => ({
          lotId: l.id,
          qty: Math.max(1, Math.floor(l.remainingQty / 2)),
          reason: 'Péremption proche',
        })),
      },
      actors.admin,
    );
    n += 1;
    if (n === 2) {
      setSeedClock(ctx.at(ctx.today, 12, 30));
      await supplierReturns.recordCredit(
        ret.id,
        { amount: ret.totalHt, reference: `AV-${random.int(1000, 9999)}` },
        actors.admin,
      );
    }
  }
  if (n > 0) summary.push(`${n} retour(s) fournisseur`);

  // --- Tâches planifiées : première passe ----------------------------------------------
  setSeedClock(ctx.at(ctx.today, 21, 0));
  const ran = await jobs.runDue(ctx.at(ctx.today, 21, 0));
  summary.push(`${ran.length} tâche(s) planifiée(s) exécutée(s)`);
  return summary.join(', ');
}
