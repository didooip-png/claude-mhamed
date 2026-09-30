import { addMonthsIso, todayIso } from '@pharmastock/shared';
import type { Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailOutboxService } from '../src/modules/email/outbox.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { FakeSmtp } from './fake-smtp.js';
import { TestContext, uniq, type Session, type TestDevice } from './helpers.js';

const t = new TestContext();
let admin: Session & { code: string };
let prep: Session & { code: string };
let refs: { categoryId: string; tva7: string; labId: string; supplierId: string };
const today = () => todayIso('Africa/Tunis');
const PIN = '1234';

beforeAll(async () => {
  await t.start();
  admin = await t.as('ADMIN');
  prep = await t.as('PREPARER');
  const category = await t
    .post('/catalog/categories', admin, { name: `Médicaments ${uniq()}`, kind: 'MEDICINE' })
    .expect(201);
  const lab = await t.post('/catalog/laboratories', admin, { name: `Labo ${uniq()}` }).expect(201);
  const tva = await t
    .post('/catalog/tva-rates', admin, { label: `TVA 7 % ${uniq()}`, rateBp: 700 })
    .expect(201);
  const supplier = await t
    .post('/suppliers', admin, { name: `Grossiste ${uniq()}`, paymentTermsDays: 30 })
    .expect(201);
  refs = {
    categoryId: category.body.id,
    tva7: tva.body.id,
    labId: lab.body.id,
    supplierId: supplier.body.id,
  };
  // Caisse ouverte sur le poste de test (espèces).
  await t.post('/cash/open', prep, { openingFloat: 100_000 }).expect(201);
});
afterAll(() => t.stop());

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/products', admin, {
    name: `Amoxicilline ${uniq()}`,
    dci: 'Amoxicilline',
    dosage: '1 g',
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
  lines: {
    productId: string;
    lotNumber: string;
    expiryDate: string;
    qty: number;
    unitPriceHt?: number;
  }[],
) {
  const draft = await t
    .post('/receipts', admin, {
      sourceType: 'SUPPLIER',
      supplierId: refs.supplierId,
      receivedAt: today(),
      supplierInvoiceRef: uniq('FACT'),
      lines: lines.map((l) => ({
        freeQty: 0,
        discountBp: 0,
        tvaRateBp: 700,
        unitPriceHt: 1500,
        ...l,
      })),
    })
    .expect(201);
  const res = await t.post(`/receipts/${draft.body.id}/validate`, admin, {
    acknowledgeWarnings: true,
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
}

async function stockedProduct(qty = 20, overrides: Record<string, unknown> = {}) {
  const p = await createProduct(overrides);
  await receive([
    { productId: p.id, lotNumber: uniq('L'), expiryDate: addMonthsIso(today(), 18), qty },
  ]);
  return p;
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

async function draftWith(
  session: Session,
  clientId: string | null,
  lines: { productId: string; qty: number }[],
) {
  const draft = await t.post('/sales', session, { clientId }).expect(201);
  let view = draft.body;
  for (const l of lines)
    view = (await t.post(`/sales/${draft.body.id}/lines`, session, l).expect(201)).body;
  return view as {
    id: string;
    totals: { totalTtc: number };
    lines: { id: string; lots: { lotNumber: string; qty: number }[] }[];
  };
}

function validate(session: Session, saleId: string, body: Record<string, unknown>, key?: string) {
  const req = t.post(`/sales/${saleId}/validate`, session, { document: 'NONE', ...body });
  return key ? req.set('Idempotency-Key', key) : req;
}

async function sellCard(
  session: Session,
  clientId: string,
  lines: { productId: string; qty: number }[],
) {
  const view = await draftWith(session, clientId, lines);
  const res = await validate(session, view.id, {
    payments: [{ method: 'CARD', amount: view.totals.totalTtc }],
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.sale as { id: string; number: string; totals: { totalTtc: number } };
}

async function lotsOf(productId: string) {
  return t.prisma.lot.findMany({
    where: { productId },
    orderBy: { expiryDate: 'asc' },
    select: { lotNumber: true, remainingQty: true },
  });
}

function binary(req: Test) {
  return req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

async function newDevice(name: string): Promise<TestDevice> {
  return t.registerDevice(`${name} ${uniq()}`, true);
}

describe('Ventes — caisse', () => {
  it('consomme deux lots dans l’ordre FEFO, numérote la facture et encaisse en espèces (idempotent)', async () => {
    const p = await createProduct();
    await receive([
      { productId: p.id, lotNumber: 'TARDIF', expiryDate: addMonthsIso(today(), 18), qty: 5 },
      { productId: p.id, lotNumber: 'PROCHE', expiryDate: addMonthsIso(today(), 8), qty: 3 },
    ]);
    const client = await createClient();
    const view = await draftWith(prep, client.id, [{ productId: p.id, qty: 5 }]);
    // Aperçu des lots qui seront sortis.
    expect(view.lines[0]!.lots).toEqual([
      expect.objectContaining({ lotNumber: 'PROCHE', qty: 3 }),
      expect.objectContaining({ lotNumber: 'TARDIF', qty: 2 }),
    ]);
    const total = view.totals.totalTtc;
    expect(total).toBe(5 * 2350);
    const key = `test-${uniq()}`;
    const body = { payments: [{ method: 'CASH', amount: total, tendered: 20_000 }] };
    const res = await validate(prep, view.id, body, key).expect(200);
    expect(res.body.sale.number).toMatch(/^FAC-\d{4}-\d{6}$/);
    expect(res.body.sale.status).toBe('VALIDATED');
    expect(res.body.sale.paymentStatus).toBe('PAID');
    expect(res.body.sale.changeGiven).toBe(20_000 - total);
    expect(await lotsOf(p.id)).toEqual([
      { lotNumber: 'PROCHE', remainingQty: 0 },
      { lotNumber: 'TARDIF', remainingQty: 3 },
    ]);
    // Rejeu (double clic) : même résultat, aucune double écriture.
    const replay = await validate(prep, view.id, body, key).expect(200);
    expect(replay.body.sale.number).toBe(res.body.sale.number);
    const movements = await t.prisma.stockMovement.findMany({ where: { documentId: view.id } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.type === 'SALE_OUT' && m.userId === prep.userId)).toBe(true);
    const payments = await t.prisma.payment.findMany({ where: { saleId: view.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.cashSessionId).not.toBeNull();
    // Fiche de mouvement : les sorties apparaissent avec le numéro de facture.
    const sheet = await t
      .get(`/stock/movements?productId=${p.id}&from=${today()}&to=${today()}`, admin)
      .expect(200);
    expect(
      sheet.body.items.filter(
        (m: { documentNumber: string }) => m.documentNumber === res.body.sale.number,
      ),
    ).toHaveLength(2);
  });

  it('refuse l’annulation au préparateur ; l’administrateur annule avec réintégration dans les lots d’origine', async () => {
    const p = await createProduct();
    await receive([
      { productId: p.id, lotNumber: 'A1', expiryDate: addMonthsIso(today(), 6), qty: 2 },
      { productId: p.id, lotNumber: 'B1', expiryDate: addMonthsIso(today(), 12), qty: 4 },
    ]);
    const client = await createClient();
    const view = await draftWith(prep, client.id, [{ productId: p.id, qty: 3 }]);
    const res = await validate(prep, view.id, {
      payments: [{ method: 'CASH', amount: view.totals.totalTtc }],
    }).expect(200);
    const saleId = res.body.sale.id as string;

    const denied = await t.post(`/sales/${saleId}/cancel`, prep, {
      reasonCode: 'CUSTOMER_REQUEST',
      reason: 'Le client a changé d’avis',
      refundMode: 'REFUND',
    });
    expect(denied.status).toBe(403);

    const cancelled = await t
      .post(`/sales/${saleId}/cancel`, admin, {
        reasonCode: 'CUSTOMER_REQUEST',
        reason: 'Le client a changé d’avis',
        refundMode: 'REFUND',
      })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.number).toBe(res.body.sale.number);
    expect(await lotsOf(p.id)).toEqual([
      { lotNumber: 'A1', remainingQty: 2 },
      { lotNumber: 'B1', remainingQty: 4 },
    ]);
    const cancelMoves = await t.prisma.stockMovement.findMany({
      where: { documentId: saleId, type: 'SALE_CANCEL' },
    });
    expect(cancelMoves.reduce((a, m) => a + m.qty, 0)).toBe(3);
    // Remboursement en espèces : sortie de caisse.
    const refund = await t.prisma.cashMovement.findFirst({
      where: { documentId: saleId, type: 'REFUND' },
    });
    expect(Number(refund?.amount)).toBe(-view.totals.totalTtc);
    // Mouchard : SALE_CANCELLED critique avec l'état complet avant annulation.
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'SALE_CANCELLED', entityId: saleId },
    });
    expect(audit?.severity).toBe('CRITICAL');
    expect(audit?.userCode).toBe(admin.code);
    expect((audit?.before as { lines: unknown[] }).lines).toHaveLength(1);
    expect(audit?.reason).toBe('Le client a changé d’avis');
    // Onglet « Ventes annulées » et indicateurs.
    const tab = await t.get(`/sales/cancelled?from=${today()}&to=${today()}`, admin).expect(200);
    expect(tab.body.items.map((s: { id: string }) => s.id)).toContain(saleId);
    expect(tab.body.totalCancelled).toBeGreaterThanOrEqual(view.totals.totalTtc);
    const indicators = await t
      .get(`/sales/indicators?from=${today()}&to=${today()}`, admin)
      .expect(200);
    const mine = indicators.body.find((r: { user: { code: string } }) => r.user.code === prep.code);
    expect(mine.ownSalesCancelled).toBeGreaterThanOrEqual(1);
    await t.get('/sales/cancelled', prep).expect(403);
    // Une vente annulée ne peut pas l'être deux fois.
    const again = await t.post(`/sales/${saleId}/cancel`, admin, {
      reasonCode: 'OTHER',
      reason: 'Deuxième essai',
      refundMode: 'CREDIT',
    });
    expect(again.body.code).toBe('SALE_ALREADY_CANCELLED');
  });

  it('deux ventes simultanées sur le dernier article : une seule réussit', async () => {
    const p = await stockedProduct(1);
    const client = await createClient();
    const [d1, d2] = [await newDevice('Comptoir A'), await newDevice('Comptoir B')];
    const s1 = await t.as('PREPARER', d1);
    const s2 = await t.as('PREPARER', d2);
    const v1 = await draftWith(s1, client.id, [{ productId: p.id, qty: 1 }]);
    const v2 = await draftWith(s2, client.id, [{ productId: p.id, qty: 1 }]);
    const results = await Promise.all([
      validate(s1, v1.id, { payments: [{ method: 'CARD', amount: 2350 }] }),
      validate(s2, v2.id, { payments: [{ method: 'CARD', amount: 2350 }] }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).not.toBe(200);
    const failed = results.find((r) => r.status !== 200)!;
    expect(failed.body.code).toBe('STOCK_INSUFFICIENT');
    expect(await lotsOf(p.id)).toEqual([expect.objectContaining({ remainingQty: 0 })]);
  });

  it('exige un client (RG-09) et les informations d’ordonnance', async () => {
    const p = await stockedProduct(5, { requiresPrescription: true });
    const noClient = await draftWith(prep, null, [{ productId: p.id, qty: 1 }]);
    const r1 = await validate(prep, noClient.id, { payments: [{ method: 'CARD', amount: 2350 }] });
    expect(r1.body.code).toBe('CLIENT_REQUIRED');
    await t.post(`/sales/${noClient.id}/discard`, prep).expect(200);

    const client = await createClient();
    const view = await draftWith(prep, client.id, [{ productId: p.id, qty: 1 }]);
    const r2 = await validate(prep, view.id, { payments: [{ method: 'CARD', amount: 2350 }] });
    expect(r2.body.code).toBe('PRESCRIPTION_REQUIRED');
    await t
      .put(`/sales/${view.id}/prescription`, prep, {
        prescriberName: 'Dr Ben Salah',
        prescriptionRef: 'ORD-77',
        prescriptionDate: today(),
      })
      .expect(200);
    await validate(prep, view.id, { payments: [{ method: 'CARD', amount: 2350 }] }).expect(200);
  });

  it('plafond de crédit : le dépassement exige un code administrateur (RG-17)', async () => {
    const p = await stockedProduct(10);
    const client = await createClient({ creditLimit: 3_000, paymentTermsDays: 30 });
    const view = await draftWith(prep, client.id, [{ productId: p.id, qty: 2 }]);
    const total = view.totals.totalTtc;
    const refused = await validate(prep, view.id, { payments: [] });
    expect(refused.body.code).toBe('OVERRIDE_REQUIRED');
    expect(refused.body.details.requirements[0].permission).toBe('sales.credit_over_limit');
    const bad = await validate(prep, view.id, {
      payments: [],
      override: { userCode: admin.code, pin: '9999', reason: 'Client fidèle' },
    });
    expect(bad.body.code).toBe('OVERRIDE_INVALID');
    const ok = await validate(prep, view.id, {
      payments: [],
      override: { userCode: admin.code, pin: PIN, reason: 'Client fidèle' },
    }).expect(200);
    expect(ok.body.sale.amountDue).toBe(total);
    expect(ok.body.sale.paymentStatus).toBe('UNPAID');
    expect(ok.body.sale.dueDate).not.toBeNull();
    expect(ok.body.sale.creditAuthorizedBy.code).toBe(admin.code);
    const dbClient = await t.prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(Number(dbClient.balance)).toBe(total);
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'CREDIT_LIMIT_OVERRIDE', entityId: view.id },
    });
    expect(audit?.authorizedByCode).toBe(admin.code);
    // Un paiement partiel dans la limite du plafond ne demande rien.
    const view2 = await draftWith(prep, (await createClient({ creditLimit: 10_000 })).id, [
      { productId: p.id, qty: 2 },
    ]);
    const partial = await validate(prep, view2.id, {
      payments: [{ method: 'CARD', amount: 1000 }],
    }).expect(200);
    expect(partial.body.sale.paymentStatus).toBe('PARTIALLY_PAID');
    expect(partial.body.sale.amountDue).toBe(view2.totals.totalTtc - 1000);
  });

  it('remise au-delà du plafond préparateur : code administrateur ; retrait de ligne tracé', async () => {
    const p = await stockedProduct(10);
    const q = await stockedProduct(10);
    const client = await createClient();
    const view = await draftWith(prep, client.id, [
      { productId: p.id, qty: 1 },
      { productId: q.id, qty: 1 },
    ]);
    const lineId = view.lines[0]!.id;
    const refused = await t.http
      .patch(`/api/v1/sales/${view.id}/lines/${lineId}`)
      .set(t.auth(prep))
      .send({ discountBp: 2000 });
    expect(refused.body.code).toBe('OVERRIDE_REQUIRED');
    const ok = await t.http
      .patch(`/api/v1/sales/${view.id}/lines/${lineId}`)
      .set(t.auth(prep))
      .send({
        discountBp: 2000,
        override: { userCode: admin.code, pin: PIN, reason: 'Geste commercial' },
      })
      .expect(200);
    expect(ok.body.lines[0].discountBp).toBe(2000);
    expect(ok.body.lines[0].authorized.discount).toBe(true);
    expect(ok.body.lines[0].lineTotalTtc).toBe(1880);
    const discountAudit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'DISCOUNT_OVER_LIMIT', entityId: view.id },
    });
    expect(discountAudit?.authorizedByCode).toBe(admin.code);
    // Une remise dans le plafond (5 %) ne demande rien.
    await t.http
      .patch(`/api/v1/sales/${view.id}/lines/${view.lines[1]!.id}`)
      .set(t.auth(prep))
      .send({ discountBp: 500 })
      .expect(200);
    // Retrait d'une ligne : tracé au mouchard.
    await t.delete(`/sales/${view.id}/lines/${view.lines[1]!.id}`, prep).expect(200);
    const removal = await t.prisma.auditLog.findFirst({
      where: { eventType: 'CART_LINE_REMOVED', entityId: view.id },
    });
    expect(removal?.userCode).toBe(prep.code);
    expect(removal?.summary).toContain(q.name);
    const validated = await validate(prep, view.id, {
      payments: [{ method: 'CARD', amount: 1880 }],
    }).expect(200);
    expect(validated.body.sale.totals.totalTtc).toBe(1880);
    expect(validated.body.sale.lines[0].discountBp).toBe(2000);
  });

  it('mise en attente, reprise depuis un autre poste ; un panier n’est modifiable que par son auteur', async () => {
    const p = await stockedProduct(5);
    const client = await createClient();
    const view = await draftWith(prep, client.id, [{ productId: p.id, qty: 1 }]);
    const other = await t.as('PREPARER', await newDevice('Comptoir C'));
    // Panier en cours d'un autre utilisateur : non modifiable.
    const forbidden = await t.post(`/sales/${view.id}/lines`, other, { productId: p.id, qty: 1 });
    expect(forbidden.status).toBe(403);
    await t.post(`/sales/${view.id}/hold`, prep).expect(200);
    const held = await t.get('/sales/on-hold', other).expect(200);
    expect(held.body.map((s: { id: string }) => s.id)).toContain(view.id);
    const resumed = await t.post(`/sales/${view.id}/resume`, other).expect(200);
    expect(resumed.body.status).toBe('DRAFT');
    const draft = await t.get('/sales/draft', other).expect(200);
    expect(draft.body.sale.id).toBe(view.id);
    const late = await t.post(`/sales/${view.id}/lines`, prep, { productId: p.id, qty: 1 });
    expect(late.status).toBe(403);
    await validate(other, view.id, { payments: [{ method: 'CARD', amount: 2350 }] }).expect(200);
  });

  it('modification : annule l’originale et crée une vente liée avec transfert des règlements (RG-13)', async () => {
    const p = await stockedProduct(10);
    const client = await createClient();
    const original = await sellCard(prep, client.id, [{ productId: p.id, qty: 2 }]);
    await t
      .post(`/sales/${original.id}/modify`, prep, {
        reasonCode: 'ENTRY_ERROR',
        reason: 'Quantité erronée',
        lines: [{ productId: p.id, qty: 1 }],
      })
      .expect(403);
    const res = await t
      .post(`/sales/${original.id}/modify`, admin, {
        reasonCode: 'ENTRY_ERROR',
        reason: 'Quantité erronée',
        lines: [{ productId: p.id, qty: 1 }],
        excessMode: 'CREDIT',
      })
      .expect(200);
    const modified = res.body.sale;
    expect(modified.number).not.toBe(original.number);
    expect(modified.replaces.id).toBe(original.id);
    expect(modified.paymentStatus).toBe('PAID');
    expect(modified.client.account.availableCredit).toBe(2350);
    const old = await t.get(`/sales/${original.id}`, admin).expect(200);
    expect(old.body.status).toBe('CANCELLED');
    expect(old.body.replacedBy.id).toBe(modified.id);
    expect((await lotsOf(p.id))[0]!.remainingQty).toBe(9);
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'SALE_MODIFIED', entityId: original.id },
    });
    expect(audit?.severity).toBe('CRITICAL');
    expect((audit?.metadata as { newNumber: string }).newNumber).toBe(modified.number);
  });

  it('imprime la facture A4 et le ticket ; la réimpression porte « DUPLICATA » et est tracée', async () => {
    const p = await stockedProduct(5);
    const sale = await sellCard(prep, (await createClient()).id, [{ productId: p.id, qty: 1 }]);
    const first = await binary(t.get(`/sales/${sale.id}/print?format=A4`, prep)).expect(200);
    expect(first.headers['content-type']).toContain('application/pdf');
    expect((first.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const ticket = await binary(t.get(`/sales/${sale.id}/print?format=TICKET`, prep)).expect(200);
    expect((ticket.body as Buffer).length).toBeGreaterThan(1000);
    const reprint = await t.prisma.auditLog.findFirst({
      where: { eventType: 'DOCUMENT_REPRINTED', entityId: sale.id },
    });
    expect(reprint?.userCode).toBe(prep.code);
  });

  it('caisse : clôture à l’aveugle, écart calculé côté serveur (RG-19)', async () => {
    const device = await newDevice('Comptoir D');
    const cashier = await t.as('PREPARER', device);
    const current = await t.get('/cash/current', cashier).expect(200);
    expect(current.body.session).toBeNull();
    const p = await stockedProduct(5);
    const client = await createClient();
    // Espèces sans caisse ouverte : refusé.
    const view = await draftWith(cashier, client.id, [{ productId: p.id, qty: 2 }]);
    const noSession = await validate(cashier, view.id, {
      payments: [{ method: 'CASH', amount: 4700 }],
    });
    expect(noSession.body.code).toBe('CASH_SESSION_REQUIRED');
    const session = await t.post('/cash/open', cashier, { openingFloat: 20_000 }).expect(201);
    await t.post('/cash/open', cashier, { openingFloat: 20_000 }).expect(409);
    await validate(cashier, view.id, {
      payments: [{ method: 'CASH', amount: 4700, tendered: 5000 }],
    }).expect(200);
    // Le préparateur ne peut ni faire de sortie de caisse ni voir le théorique.
    await t
      .post('/cash/movements', cashier, { type: 'EXPENSE', amount: 1000, reason: 'Café' })
      .expect(403);
    await t.get(`/cash/${session.body.id}`, cashier).expect(403);
    // Compté : 20 + 2 × 2 DT − 1 DT manquant = 23,700 DT au lieu de 24,700 DT.
    const closed = await t
      .post(`/cash/${session.body.id}/close`, cashier, {
        denominations: [
          { value: 20_000, count: 1 },
          { value: 1000, count: 3 },
          { value: 500, count: 1 },
          { value: 200, count: 1 },
        ],
      })
      .expect(200);
    expect(closed.body.counted).toBe(23_700);
    expect(closed.body.expected).toBeUndefined();
    const detail = await t.get(`/cash/${session.body.id}`, admin).expect(200);
    expect(Number(detail.body.expectedAmount)).toBe(24_700);
    expect(Number(detail.body.difference)).toBe(-1000);
    expect(detail.body.summary.salesCash).toBe(4700);
    const report = await binary(t.get(`/cash/${session.body.id}/report`, admin)).expect(200);
    expect((report.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    // Écart inférieur au seuil (5 DT) : pas d'alerte CASH_DISCREPANCY.
    expect(
      await t.prisma.auditLog.count({
        where: { eventType: 'CASH_DISCREPANCY', entityId: session.body.id },
      }),
    ).toBe(0);
  });

  it('refuse au préparateur les écrans d’administration de la phase 2', async () => {
    await t.get('/cash/sessions', prep).expect(403);
    await t.get('/email/smtp', prep).expect(403);
    await t.get('/email/log', prep).expect(403);
    await t.get('/email/templates', prep).expect(403);
    await t.get('/sales/indicators', prep).expect(403);
  });
});

describe('E-mail et notifications', () => {
  const smtp = new FakeSmtp();
  let outbox: EmailOutboxService;
  let notifications: NotificationsService;

  beforeAll(async () => {
    await smtp.start();
    outbox = t.app.get(EmailOutboxService);
    notifications = t.app.get(NotificationsService);
    // Traite les événements des tests précédents pour partir d'une file vide.
    await notifications.processPending();
  });
  afterAll(() => smtp.stop());

  it('refuse d’envoyer tant que le SMTP n’est pas configuré et testé', async () => {
    const status = await t.get('/email/status', prep).expect(200);
    expect(status.body.operational).toBe(false);
    const config = await t
      .put('/email/smtp', admin, {
        enabled: true,
        host: '127.0.0.1',
        port: smtp.port,
        security: 'NONE',
        username: '',
        password: 'secret-smtp',
        fromName: 'Pharmacie Test',
        fromEmail: 'factures@example.com',
        replyTo: '',
        bccArchive: '',
        hourlyLimit: 100,
      })
      .expect(200);
    expect(config.body.password).toBeUndefined();
    expect(config.body.passwordSet).toBe(true);
    expect(config.body.operational).toBe(false);
    const test = await t.post('/email/smtp/test-connection', admin).expect(200);
    expect(test.body.ok).toBe(true);
    const sent = await t
      .post('/email/smtp/test-send', admin, { to: 'admin@example.com' })
      .expect(200);
    expect(sent.body.ok).toBe(true);
    expect(smtp.messages.at(-1)?.subject).toContain('test');
    expect((await t.get('/email/status', prep).expect(200)).body.operational).toBe(true);
    // Le mot de passe est chiffré en base et masqué au mouchard.
    const stored = await t.prisma.setting.findUnique({ where: { key: 'smtp.password_encrypted' } });
    expect(JSON.stringify(stored?.value)).not.toContain('secret-smtp');
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'SETTING_CHANGED', entityId: 'smtp.config' },
      orderBy: { id: 'desc' },
    });
    expect(JSON.stringify(audit)).not.toContain('secret-smtp');
  });

  it('envoie la facture PDF au client consentant, sans nom de médicament dans le corps', async () => {
    const p = await stockedProduct(5, { name: `Doliprane Secret ${uniq()}` });
    const client = await createClient({ email: 'leila@example.com', emailConsent: true });
    const view = await draftWith(prep, client.id, [{ productId: p.id, qty: 1 }]);
    const res = await validate(prep, view.id, {
      payments: [{ method: 'CARD', amount: 2350 }],
      sendEmail: true,
    }).expect(200);
    expect(res.body.warnings).toEqual([]);
    const queued = await t.prisma.emailOutbox.findFirst({
      where: { relatedEntityId: view.id, kind: 'INVOICE' },
    });
    expect(queued?.status).toBe('QUEUED');
    const before = smtp.messages.length;
    const result = await outbox.processBatch();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const mail = smtp.messages.slice(before).find((m) => m.subject?.includes(res.body.sale.number));
    expect(mail).toBeDefined();
    expect(mail!.subject).toBe(
      `Facture ${res.body.sale.number} — ${await t.app.get(SettingsService).get('establishment.name')}`,
    );
    expect(mail!.attachments[0]?.contentType).toBe('application/pdf');
    expect(mail!.attachments[0]?.filename).toBe(`${res.body.sale.number}.pdf`);
    expect(mail!.html || '').not.toContain('Doliprane');
    expect(mail!.text || '').not.toContain('Doliprane');
    expect(
      (await t.prisma.emailOutbox.findUniqueOrThrow({ where: { id: queued!.id } })).status,
    ).toBe('SENT');
  });

  it('n’envoie rien automatiquement sans consentement ; l’envoi manuel exige une confirmation', async () => {
    const p = await stockedProduct(5);
    const client = await createClient({
      email: 'sans.consentement@example.com',
      emailConsent: false,
    });
    const sale = await sellCard(prep, client.id, [{ productId: p.id, qty: 1 }]);
    expect(await t.prisma.emailOutbox.count({ where: { relatedEntityId: sale.id } })).toBe(0);
    const refused = await t.post(`/sales/${sale.id}/email`, prep, {
      to: ['sans.consentement@example.com'],
    });
    expect(refused.body.code).toBe('EMAIL_CONSENT_REQUIRED');
    await t
      .post(`/sales/${sale.id}/email`, prep, {
        to: ['sans.consentement@example.com'],
        confirmNoConsent: true,
        message: 'Comme convenu.',
      })
      .expect(200);
    const emails = await t.get(`/sales/${sale.id}/emails`, prep).expect(200);
    expect(emails.body).toHaveLength(1);
    // Injection d'en-têtes refusée.
    const injected = await t.post(`/sales/${sale.id}/email`, prep, {
      to: ['a@example.com\r\nBcc: x@example.com'],
      confirmNoConsent: true,
    });
    expect(injected.status).toBe(400);
  });

  it('SMTP coupé : la vente est validée, l’e-mail est réessayé puis part au rétablissement', async () => {
    await smtp.stop();
    const p = await stockedProduct(5);
    const client = await createClient({ email: 'karim@example.com', emailConsent: true });
    const view = await draftWith(prep, client.id, [{ productId: p.id, qty: 1 }]);
    const res = await validate(prep, view.id, {
      payments: [{ method: 'CARD', amount: 2350 }],
      sendEmail: true,
    }).expect(200);
    expect(res.body.sale.status).toBe('VALIDATED');
    const failed = await outbox.processBatch();
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    const row = await t.prisma.emailOutbox.findFirstOrThrow({
      where: { relatedEntityId: view.id },
    });
    expect(row.status).toBe('QUEUED');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBeTruthy();
    // Reprise après 1 minute : on avance l'échéance au lieu d'attendre.
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    await smtp.start();
    await t.prisma.emailOutbox.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date() },
    });
    const retried = await outbox.processBatch();
    expect(retried.sent).toBeGreaterThanOrEqual(1);
    expect((await t.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'SENT',
    );
  });

  it('notifie immédiatement l’administrateur d’une annulation (cloche + e-mail)', async () => {
    await t.prisma.user.update({
      where: { id: admin.userId },
      data: { notificationEmail: 'patron@example.com' },
    });
    const p = await stockedProduct(5);
    const sale = await sellCard(prep, (await createClient()).id, [{ productId: p.id, qty: 1 }]);
    await t
      .post(`/sales/${sale.id}/cancel`, admin, {
        reasonCode: 'ENTRY_ERROR',
        reason: 'Vente en double',
        refundMode: 'CREDIT',
      })
      .expect(200);
    await notifications.processPending();
    const bell = await t.get('/notifications', admin).expect(200);
    const n = bell.body.items.find(
      (x: { type: string; entityId: string }) =>
        x.type === 'SALE_CANCELLED' && x.entityId === sale.id,
    );
    expect(n).toBeDefined();
    expect(bell.body.unread).toBeGreaterThanOrEqual(1);
    // Le préparateur ne reçoit pas les notifications d'activité des employés.
    const prepBell = await t.get('/notifications', prep).expect(200);
    expect(prepBell.body.items.some((x: { type: string }) => x.type === 'SALE_CANCELLED')).toBe(
      false,
    );
    const email = await t.prisma.emailOutbox.findFirst({
      where: {
        kind: 'NOTIFICATION:SALE_CANCELLED',
        to: { has: 'patron@example.com' },
        relatedEntityId: sale.id,
      },
    });
    expect(email).not.toBeNull();
    const before = smtp.messages.length;
    await outbox.processBatch();
    const mail = smtp.messages.slice(before).find((m) => m.subject?.includes('Vente annulée'));
    expect(mail?.text).toContain(sale.number);
    await t.post(`/notifications/${n.id}/read`, admin).expect(200);
    await t.post('/notifications/read-all', admin).expect(200);
    expect((await t.get('/notifications/unread-count', admin).expect(200)).body.unread).toBe(0);
  });

  it('modèles d’e-mails : aperçu, modification tracée, restauration', async () => {
    const list = await t.get('/email/templates', admin).expect(200);
    expect(list.body.map((x: { key: string }) => x.key)).toEqual(
      expect.arrayContaining(['INVOICE', 'ADMIN_NOTIFICATION', 'TEST']),
    );
    const preview = await t.post('/email/templates/INVOICE/preview', admin, {}).expect(200);
    expect(preview.body.subject).toContain('FAC-2026-000123');
    expect(preview.body.html).toContain('<html');
    const invoice = list.body.find((x: { key: string }) => x.key === 'INVOICE');
    const updated = await t
      .put('/email/templates/INVOICE', admin, {
        subject: 'Votre facture {{document.numero}}',
        body: invoice.body,
        text: invoice.text,
      })
      .expect(200);
    expect(updated.body.isCustomized).toBe(true);
    expect(
      await t.prisma.auditLog.count({
        where: { eventType: 'EMAIL_TEMPLATE_CHANGED', entityId: 'INVOICE' },
      }),
    ).toBeGreaterThanOrEqual(1);
    const reset = await t.post('/email/templates/INVOICE/reset', admin).expect(200);
    expect(reset.body.isCustomized).toBe(false);
    const log = await t.get('/email/log?status=SENT', admin).expect(200);
    expect(log.body.total).toBeGreaterThanOrEqual(2);
  });
});
