import {
  addDaysIso,
  addMonthsIso,
  htFromTtc,
  todayIso,
  type ReportResult,
} from '@pharmastock/shared';
import type { Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext, uniq, type Session } from './helpers.js';

const t = new TestContext();
let admin: Session & { code: string };
let prep: Session & { code: string };
let refs: { categoryId: string; categoryName: string; tva7: string; tva19: string; labId: string };
let supplier: { id: string; name: string };
const TZ = 'Africa/Tunis';
const today = () => todayIso(TZ);
const PIN = '1234';

beforeAll(async () => {
  await t.start();
  admin = await t.as('ADMIN');
  prep = await t.as('PREPARER');
  const categoryName = `Rapports ${uniq()}`;
  const category = await t
    .post('/catalog/categories', admin, { name: categoryName, kind: 'MEDICINE' })
    .expect(201);
  const lab = await t.post('/catalog/laboratories', admin, { name: `Labo ${uniq()}` }).expect(201);
  const tva7 = await t
    .post('/catalog/tva-rates', admin, { label: `TVA 7 % ${uniq()}`, rateBp: 700 })
    .expect(201);
  const tva19 = await t
    .post('/catalog/tva-rates', admin, { label: `TVA 19 % ${uniq()}`, rateBp: 1900 })
    .expect(201);
  const sup = await t
    .post('/suppliers', admin, { name: `Fournisseur ${uniq()}`, paymentTermsDays: 30 })
    .expect(201);
  supplier = { id: sup.body.id, name: sup.body.name };
  refs = {
    categoryId: category.body.id,
    categoryName,
    tva7: tva7.body.id,
    tva19: tva19.body.id,
    labId: lab.body.id,
  };
  await t.post('/cash/open', prep, { openingFloat: 100_000 }).expect(201);
});
afterAll(() => t.stop());

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/products', admin, {
    name: `Produit ${uniq()}`,
    dci: 'Test',
    dosage: '100 mg',
    form: 'Comprimé',
    laboratoryId: refs.labId,
    categoryId: refs.categoryId,
    tvaRateId: refs.tva7,
    refPurchasePriceHt: 1500,
    salePriceTtc: 2350,
    unitsPerPack: 1,
    sellByUnit: false,
    requiresPrescription: false,
    controlledClass: 'NONE',
    coldChain: false,
    returnable: true,
    minStock: 0,
    barcodes: [],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; name: string };
}

async function receive(
  productId: string,
  qty: number,
  tvaBp = 700,
  expiryDate = addMonthsIso(today(), 12),
) {
  const lotNumber = uniq('LOT');
  const draft = await t
    .post('/receipts', admin, {
      sourceType: 'SUPPLIER',
      supplierId: supplier.id,
      receivedAt: today(),
      supplierInvoiceRef: uniq('FACT'),
      lines: [
        {
          productId,
          lotNumber,
          expiryDate,
          qty,
          freeQty: 0,
          discountBp: 0,
          tvaRateBp: tvaBp,
          unitPriceHt: 1500,
        },
      ],
    })
    .expect(201);
  await t
    .post(`/receipts/${draft.body.id}/validate`, admin, { acknowledgeWarnings: true })
    .expect(200);
  return { lotNumber, receiptId: draft.body.id as string };
}

async function createClient(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/clients', admin, {
    type: 'INDIVIDUAL',
    name: `Client ${uniq()}`,
    phone: '71 000 000',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; name: string };
}

async function sell(
  clientId: string,
  productId: string,
  qty: number,
  method: 'CARD' | 'CREDIT' = 'CARD',
  prescription?: { prescriberName: string; prescriptionRef: string },
) {
  const draft = await t.post('/sales', prep, { clientId }).expect(201);
  const view = (await t.post(`/sales/${draft.body.id}/lines`, prep, { productId, qty }).expect(201))
    .body;
  if (prescription)
    await t
      .put(`/sales/${draft.body.id}/prescription`, prep, {
        ...prescription,
        prescriptionDate: today(),
      })
      .expect(200);
  const res = await t.post(`/sales/${draft.body.id}/validate`, prep, {
    document: 'NONE',
    payments: method === 'CARD' ? [{ method: 'CARD', amount: view.totals.totalTtc }] : [],
    override:
      method === 'CREDIT'
        ? { userCode: admin.code, pin: PIN, reason: 'Vente à crédit autorisée' }
        : undefined,
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.sale as { id: string; number: string; totals: { totalTtc: number } };
}

async function report(id: string, query = '', session: Session = admin): Promise<ReportResult> {
  const res = await t.get(`/reports/${id}?from=${today()}&to=${today()}${query}`, session);
  if (res.status !== 200) throw new Error(`${id} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as ReportResult;
}

const rowOf = (r: ReportResult, label: string) => r.rows.find((x) => String(x.label) === label);

function binary(req: Test) {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('Statistiques et rapports', () => {
  it('réservés à ceux qui ont reports.view ; identifiants et périodes validés', async () => {
    await t.get('/reports', prep).expect(403);
    await t.get('/reports/sales-summary', prep).expect(403);
    const catalog = (await t.get('/reports', admin).expect(200)).body;
    expect(catalog.reports.length).toBeGreaterThanOrEqual(30);
    await t.get('/reports/inconnu', admin).expect(404);
    await t
      .get(`/reports/sales-summary?from=${today()}&to=${addDaysIso(today(), -3)}`, admin)
      .expect(400);
    await t.get('/reports/purchase-prices', admin).expect(400);
  });

  it('chiffre d’affaires, marges et ventilations recoupés avec les ventes réelles', async () => {
    const p1 = await createProduct(); // TVA 7 %, prix 2,350 DT
    const p2 = await createProduct({ tvaRateId: refs.tva19, salePriceTtc: 3570 }); // TVA 19 %
    await receive(p1.id, 20);
    await receive(p2.id, 20, 1900);
    const c1 = await createClient();
    const c2 = await createClient();
    const s1 = await sell(c1.id, p1.id, 3); // 3 × 2 350 = 7 050
    const s2 = await sell(c2.id, p2.id, 2); // 2 × 3 570 = 7 140
    const s3 = await sell(c1.id, p2.id, 1); // 3 570
    const expectedTtc = 7050 + 7140 + 3570;
    expect(s1.totals.totalTtc + s2.totals.totalTtc + s3.totals.totalTtc).toBeGreaterThanOrEqual(
      expectedTtc,
    );
    const cost = (3 + 2 + 1) * 1500;
    const ht = (ttc: number, bp: number) => htFromTtc(ttc, bp);
    const expectedHt = ht(7050, 700) + ht(7140, 1900) + ht(3570, 1900);

    // Par utilisateur : le préparateur de ce fichier n'a fait que ces ventes.
    const byUser = await report('sales-by-user');
    const me = byUser.rows.find((r) => String(r.label).startsWith(prep.code))!;
    expect(me).toMatchObject({ sales: 3, revenueTtc: expectedTtc, cost });
    expect(Math.abs(Number(me.revenueHt) - expectedHt)).toBeLessThanOrEqual(3);
    expect(me.margin).toBe(Number(me.revenueHt) - cost);
    expect(byUser.totals?.sales).toBeGreaterThanOrEqual(3);

    // Par catégorie : la catégorie créée pour ce fichier.
    const byCategory = await report('sales-by-category');
    const cat = rowOf(byCategory, refs.categoryName)!;
    expect(cat).toMatchObject({ sales: 3, qty: 6, revenueTtc: expectedTtc, cost });

    // Par produit (marges) : P1 = 3 × (2,350 − coût 1,500).
    const margins = await report('margins-by-product');
    const m1 = margins.rows.find((r) => String(r.label).startsWith(p1.name))!;
    expect(m1).toMatchObject({ qty: 3, revenueTtc: 7050, cost: 4500 });
    expect(Math.abs(Number(m1.margin) - (ht(7050, 700) - 4500))).toBeLessThanOrEqual(1);

    // Par client.
    const byClient = await report('sales-by-client');
    expect(rowOf(byClient, c1.name)).toMatchObject({ sales: 2, revenueTtc: 7050 + 3570 });
    expect(rowOf(byClient, c2.name)).toMatchObject({ sales: 1, revenueTtc: 7140 });

    // Synthèse de la journée.
    const summary = await report('sales-summary');
    const revenue = summary.kpis.find((k) => k.key === 'revenueTtc')!.value!;
    const count = summary.kpis.find((k) => k.key === 'salesCount')!.value!;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(revenue).toBeGreaterThanOrEqual(expectedTtc);
    // La série jour par jour additionne exactement les indicateurs.
    expect(summary.totals?.revenueTtc).toBe(revenue);
    expect(summary.totals?.salesCount).toBe(count);
    expect(summary.rows).toHaveLength(1);
    const marginRate = summary.kpis.find((k) => k.key === 'marginRate')!.value!;
    expect(marginRate).toBeGreaterThan(0);

    // Comparaison avec la période précédente : chaque indicateur porte sa valeur précédente.
    const compared = await report('sales-summary', '&compare=previous');
    expect(compared.comparison?.label).toBe('Période précédente');
    expect(compared.kpis.every((k) => k.previous !== undefined)).toBe(true);
    const yearly = await report('sales-summary', '&compare=year&granularity=month');
    expect(yearly.comparison?.from).toBe(addMonthsIso(today(), -12));
    expect(yearly.rows[0]?.bucket).toBe(today().slice(0, 7));

    // Modes de paiement : nos paiements par carte sont comptés.
    const payments = await report('sales-by-payment');
    expect(Number(rowOf(payments, 'Carte')?.amount)).toBeGreaterThanOrEqual(expectedTtc);

    // Carte de chaleur : le total des cellules égale le nombre de ventes.
    const heat = await report('sales-heatmap');
    expect(heat.totals?.sales).toBe(count);
    expect(heat.chart?.type).toBe('heatmap');

    // ABC : cumul final = 100 %, classes cohérentes.
    const abc = await report('abc');
    expect(abc.rows.at(-1)?.cumulativeShare).toBe(10_000);
    expect(abc.rows[0]?.class).toBe('A');
    const topProducts = await report('top-products');
    expect(topProducts.rows.length).toBeGreaterThan(0);
    const qtys = topProducts.rows.map((r) => Number(r.qty));
    expect([...qtys].sort((a, b) => b - a)).toEqual(qtys);
  });

  it('retours : le CA et la marge sont nets, les rapports de retours et d’annulations sont exacts', async () => {
    const p = await createProduct();
    await receive(p.id, 10);
    const client = await createClient();
    const before = await report('sales-by-category');
    const rowBefore = rowOf(before, refs.categoryName);
    const sale = await sell(client.id, p.id, 4); // 4 × 2 350 = 9 400
    const detail = (await t.get(`/sales/${sale.id}`, admin).expect(200)).body;
    const lineId = detail.lines[0].id as string;
    const lot = await t.prisma.lot.findFirstOrThrow({ where: { productId: p.id } });
    const reason = `Erreur de dosage ${uniq()}`;
    await t
      .post('/returns', admin, {
        saleId: sale.id,
        reason,
        refundMode: 'CREDIT',
        entries: [{ saleLineId: lineId, lotId: lot.id, qty: 1 }],
      })
      .expect(201);
    const after = await report('sales-by-category');
    const rowAfter = rowOf(after, refs.categoryName)!;
    // 4 vendus, 1 retourné et remis en stock : CA net +7 050, coût net +4 500.
    expect(Number(rowAfter.revenueTtc) - Number(rowBefore?.revenueTtc ?? 0)).toBe(7050);
    expect(Number(rowAfter.cost) - Number(rowBefore?.cost ?? 0)).toBe(4500);
    expect(Number(rowAfter.qty) - Number(rowBefore?.qty ?? 0)).toBe(3);

    const byReason = await report('returns-by-reason');
    expect(rowOf(byReason, reason.toLowerCase())).toMatchObject({ returns: 1, amount: 2350 });
    const byUser = await report('returns-by-user');
    expect(byUser.rows.find((r) => String(r.label).startsWith(admin.code))).toBeDefined();
    const byProduct = await report('returns-by-product');
    const pr = byProduct.rows.find((r) => String(r.label).startsWith(p.name))!;
    expect(pr).toMatchObject({ qty: 1, amount: 2350, restock: 1, quarantine: 0, destroyed: 0 });

    // Annulation par l'administrateur.
    const other = await sell(client.id, p.id, 1);
    await t
      .post(`/sales/${other.id}/cancel`, admin, {
        reasonCode: 'ENTRY_ERROR',
        reason: 'Erreur de saisie',
        refundMode: 'REFUND',
      })
      .expect(200);
    const cancellations = await report('cancellations-by-user');
    const mine = cancellations.rows.find((r) => String(r.label).startsWith(admin.code))!;
    expect(Number(mine.cancellations)).toBeGreaterThanOrEqual(1);
    expect(Number(mine.amount)).toBeGreaterThanOrEqual(2350);
  });

  it('stock, péremptions, pertes et achats', async () => {
    const p = await createProduct();
    const { lotNumber, receiptId } = await receive(p.id, 12);
    const soon = await createProduct();
    await receive(soon.id, 5, 700, addDaysIso(today(), 20));
    const dormantProduct = await createProduct();
    await receive(dormantProduct.id, 3);

    const valuation = await report('stock-valuation');
    const cat = rowOf(valuation, refs.categoryName)!;
    const lots = await t.prisma.lot.findMany({
      where: { product: { categoryId: refs.categoryId }, remainingQty: { gt: 0 } },
    });
    expect(cat.units).toBe(lots.reduce((a, l) => a + l.remainingQty, 0));
    expect(cat.cost).toBe(lots.reduce((a, l) => a + l.remainingQty * Number(l.unitCostHt), 0));
    expect(Number(cat.sale)).toBeGreaterThan(Number(cat.cost));
    expect(valuation.kpis.find((k) => k.key === 'cost')!.value).toBeGreaterThanOrEqual(
      Number(cat.cost),
    );

    const expiry = await report('expiry-value');
    const within30 = expiry.rows.find((r) => String(r.label).includes('30'))!;
    expect(Number(within30.cost)).toBeGreaterThanOrEqual(5 * 1500);

    const dormant = await report('stock-dormant', '&days=7');
    expect(dormant.rows.some((r) => String(r.label).startsWith(dormantProduct.name))).toBe(true);

    // Pertes : une casse validée de 2 unités.
    const lot = await t.prisma.lot.findFirstOrThrow({ where: { productId: p.id } });
    await t
      .post('/adjustments', admin, {
        type: 'BREAKAGE',
        reason: 'Casse au rayon',
        lines: [{ lotId: lot.id, qty: 2 }],
        validateNow: true,
      })
      .expect(201);
    const losses = await report('stock-losses');
    expect(Number(rowOf(losses, 'Casse')?.cost)).toBeGreaterThanOrEqual(2 * 1500);
    expect(losses.kpis.find((k) => k.key === 'loss')!.value).toBeGreaterThanOrEqual(3000);

    // Rotation : le produit vendu apparaît avec une couverture.
    const client = await createClient();
    await sell(client.id, p.id, 2);
    const rotation = await report('stock-rotation');
    const rot = rotation.rows.find((r) => String(r.label).startsWith(p.name))!;
    expect(rot.sold).toBe(2);
    expect(rot.stock).toBe(8);
    expect(rot.coverageDays).toBe(4); // 8 en stock ÷ 2 vendus par jour (période d'un jour)

    // Achats.
    const bySupplier = await report('purchases-by-supplier');
    const sup = rowOf(bySupplier, supplier.name)!;
    expect(Number(sup.ht)).toBeGreaterThanOrEqual(12 * 1500);
    const receipt = await t.prisma.purchaseReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(Number(receipt.totalHt)).toBe(12 * 1500);
    const byProduct = await report('purchases-by-product');
    const pp = byProduct.rows.find((r) => String(r.label).startsWith(p.name))!;
    expect(pp).toMatchObject({ qty: 12, ht: 18_000, avgCost: 1500 });
    const prices = await report('purchase-prices', `&productId=${p.id}`);
    expect(prices.rows).toHaveLength(1);
    expect(prices.rows[0]).toMatchObject({ lot: lotNumber, net: 1500, effective: 1500 });
  });

  it('créances, encaissements et caisse', async () => {
    const p = await createProduct();
    await receive(p.id, 5);
    const debtor = await createClient({ creditLimit: 100_000, paymentTermsDays: 30 });
    await sell(debtor.id, p.id, 2, 'CREDIT');
    const top = await report('top-debtors');
    const row = top.rows.find((r) => String(r.client).startsWith(debtor.name))!;
    expect(row.balance).toBe(4700);
    const aging = await report('receivables-aging');
    const ag = aging.rows.find((r) => String(r.client).startsWith(debtor.name))!;
    expect(ag).toMatchObject({ b0: 4700, total: 4700, invoices: 1 });
    // Encaissement partiel puis relevé des encaissements du jour.
    const pay = await t.post('/payments', admin, {
      clientId: debtor.id,
      method: 'TRANSFER',
      amount: 1500,
      allocation: 'AUTO',
      items: [],
      reference: 'VIR-1',
    });
    expect(pay.status).toBe(201);
    const collections = await report('collections');
    expect(Number(collections.totals?.TRANSFER)).toBeGreaterThanOrEqual(1500);
    const topAfter = await report('top-debtors');
    expect(topAfter.rows.find((r) => String(r.client).startsWith(debtor.name))?.balance).toBe(3200);
    // Écarts de caisse : le rapport se construit (sessions clôturées de la période).
    const cash = await report('cash-variances');
    expect(cash.columns.map((c) => c.key)).toContain('difference');
  });

  it('journaux, TVA recoupée, registre des produits à tableau, traçabilité d’un lot', async () => {
    const controlled = await createProduct({ controlledClass: 'A', requiresPrescription: true });
    const { lotNumber } = await receive(controlled.id, 6);
    const client = await createClient();
    const ref = `ORD-${uniq()}`;
    const sale = await sell(client.id, controlled.id, 2, 'CARD', {
      prescriberName: 'Dr Mansour',
      prescriptionRef: ref,
    });
    const register = await report('controlled-register');
    const line = register.rows.find((r) => r.prescription === ref)!;
    expect(line).toMatchObject({
      prescriber: 'Dr Mansour',
      client: client.name,
      qty: 2,
      lot: lotNumber,
      invoice: sale.number,
    });

    const journal = await report('journal-sales');
    expect(journal.rows.some((r) => r.number === sale.number)).toBe(true);
    const numbers = journal.rows.map((r) => String(r.number));
    expect([...numbers].sort()).toEqual(numbers);
    const receiptsJournal = await report('journal-purchases');
    expect(receiptsJournal.rows.length).toBeGreaterThan(0);
    const paymentsJournal = await report('journal-payments');
    expect(paymentsJournal.rows.some((r) => r.client === client.name)).toBe(true);

    // TVA collectée : recoupée avec les lignes de vente (arrondi par facture et par taux).
    const vat = await report('vat-summary');
    const lines = await t.prisma.saleLine.findMany({
      where: {
        sale: { status: 'VALIDATED', validatedAt: { gte: new Date(Date.now() - 36 * 3_600_000) } },
      },
      select: {
        saleId: true,
        tvaRateBp: true,
        lineTotalTtc: true,
        sale: { select: { validatedAt: true } },
      },
    });
    const start = new Date(`${today()}T00:00:00Z`).getTime() - 3_600_000;
    const groups = new Map<string, number>();
    for (const l of lines) {
      if (l.sale.validatedAt!.getTime() < start) continue;
      const key = `${l.saleId}:${l.tvaRateBp}`;
      groups.set(key, (groups.get(key) ?? 0) + Number(l.lineTotalTtc));
    }
    const expectedByRate = new Map<number, number>();
    for (const [key, ttc] of groups) {
      const rate = Number(key.split(':')[1]);
      expectedByRate.set(rate, (expectedByRate.get(rate) ?? 0) + (ttc - htFromTtc(ttc, rate)));
    }
    for (const [rate, vatAmount] of expectedByRate) {
      const r = vat.rows.find((x) => x.rate === rate);
      expect(r, `taux ${rate}`).toBeDefined();
      // Les retours de la journée réduisent la TVA nette, pas la TVA collectée brute.
      expect(r!.collectedVat).toBe(vatAmount);
    }
    expect(vat.kpis.map((k) => k.key)).toEqual(['net', 'ded', 'due', 'stamp']);

    // Traçabilité : réception puis vente du lot.
    const trace = await report('lot-trace', `&lotNumber=${lotNumber}`);
    expect(trace.rows.map((r) => r.type)).toEqual(['Achat (réception)', 'Vente']);
    expect(trace.rows[1]).toMatchObject({ qty: -2, balance: 4, user: prep.code });
  });

  it('exports Excel et PDF', async () => {
    for (const id of ['sales-summary', 'vat-summary', 'stock-valuation', 'abc']) {
      const xlsx = await binary(
        t.get(`/reports/${id}?format=xlsx&from=${today()}&to=${today()}`, admin),
      ).expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const pdf = await binary(
        t.get(`/reports/${id}?format=pdf&from=${today()}&to=${today()}`, admin),
      ).expect(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'DATA_EXPORTED', summary: { contains: 'Chiffre d’affaires' } },
    });
    expect(audit).not.toBeNull();
  });
});

describe('Tableau de bord', () => {
  it('complet pour l’administrateur : indicateurs, comparaison, alertes ; sans marge pour un préparateur', async () => {
    const p = await createProduct({ minStock: 5 });
    await receive(p.id, 6);
    const client = await createClient();
    await sell(client.id, p.id, 2); // 6 → 4 : sous le seuil de 5
    const full = (await t.get('/dashboard', admin).expect(200)).body;
    expect(full.scope).toBe('FULL');
    expect(full.today).toBe(today());
    for (const key of ['day', 'week', 'month']) {
      const period = full.periods[key];
      expect(period.current.salesCount).toBeGreaterThanOrEqual(0);
      expect(period.previous).toBeDefined();
      expect(period.label).toBeTruthy();
    }
    expect(full.periods.day.current.salesCount).toBeGreaterThanOrEqual(1);
    expect(full.periods.month.current.revenueTtc).toBeGreaterThanOrEqual(
      full.periods.day.current.revenueTtc,
    );
    expect(full.series).toHaveLength(30);
    expect(full.series.at(-1).day).toBe(today());
    expect(full.stockValue.cost).toBeGreaterThan(0);
    expect(full.stockValue.sale).toBeGreaterThan(full.stockValue.cost);
    expect(full.topProducts.length).toBeLessThanOrEqual(10);
    expect(full.alerts.lowStock).toBeGreaterThanOrEqual(1);
    expect(full.alerts.expiring).toHaveLength(3);
    expect(full.alerts.cancellationsToday).toBeDefined();
    expect(Array.isArray(full.payments)).toBe(true);

    const personal = (await t.get('/dashboard', prep).expect(200)).body;
    expect(personal.scope).toBe('PERSONAL');
    expect(personal.mySales.count).toBeGreaterThanOrEqual(1);
    expect(personal.periods).toBeUndefined();
    expect(personal.stockValue).toBeUndefined();
    expect(JSON.stringify(personal)).not.toContain('margin');
    expect(personal.alerts.outOfStock).toBeDefined();
    expect(personal.alerts.creditExceeded).toBeUndefined();
  });
});
