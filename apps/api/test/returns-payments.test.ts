import { addDaysIso, addMonthsIso, todayIso } from '@pharmastock/shared';
import type { Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerService } from '../src/modules/accounts/ledger.service.js';
import { EmailOutboxService } from '../src/modules/email/outbox.service.js';
import { FakeSmtp } from './fake-smtp.js';
import { TestContext, uniq, type Session } from './helpers.js';

const t = new TestContext();
let admin: Session & { code: string };
let prep: Session & { code: string };
let refs: { categoryId: string; tva7: string; labId: string; supplierId: string };
const today = () => todayIso('Africa/Tunis');
const PIN = '1234';
const OVERRIDE = { userCode: '', pin: PIN, reason: 'Retour accepté par l’administrateur' };

beforeAll(async () => {
  await t.start();
  admin = await t.as('ADMIN');
  prep = await t.as('PREPARER');
  OVERRIDE.userCode = admin.code;
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
  await t.post('/cash/open', prep, { openingFloat: 100_000 }).expect(201);
});
afterAll(() => t.stop());

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/products', admin, {
    name: `Ibuprofène ${uniq()}`,
    dci: 'Ibuprofène',
    dosage: '400 mg',
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
  lines: { productId: string; lotNumber: string; expiryDate: string; qty: number }[],
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

/** Produit avec deux lots : A (péremption proche) puis B. */
async function twoLotProduct(qtyA = 2, qtyB = 8, overrides: Record<string, unknown> = {}) {
  const p = await createProduct(overrides);
  const a = uniq('LA');
  const b = uniq('LB');
  await receive([
    { productId: p.id, lotNumber: a, expiryDate: addMonthsIso(today(), 6), qty: qtyA },
    { productId: p.id, lotNumber: b, expiryDate: addMonthsIso(today(), 14), qty: qtyB },
  ]);
  const lots = await t.prisma.lot.findMany({
    where: { productId: p.id },
    orderBy: { expiryDate: 'asc' },
  });
  return { ...p, lotA: lots[0]!, lotB: lots[1]! };
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

interface SaleOut {
  id: string;
  number: string;
  totals: { totalTtc: number };
  amountDue: number;
  lines: { id: string }[];
}

async function sell(
  clientId: string,
  lines: { productId: string; qty: number }[],
  pay: 'CARD' | 'CASH' | 'CREDIT' | { cash: number },
  session: Session = prep,
): Promise<SaleOut> {
  const draft = await t.post('/sales', session, { clientId }).expect(201);
  let view = draft.body;
  for (const l of lines)
    view = (await t.post(`/sales/${draft.body.id}/lines`, session, l).expect(201)).body;
  const total = view.totals.totalTtc as number;
  const payments =
    pay === 'CREDIT'
      ? []
      : typeof pay === 'object'
        ? [{ method: 'CASH', amount: pay.cash }]
        : [{ method: pay, amount: total }];
  const res = await t.post(`/sales/${draft.body.id}/validate`, session, {
    document: 'NONE',
    payments,
    override: pay === 'CREDIT' ? OVERRIDE : undefined,
  });
  if (res.status !== 200) throw new Error(`Vente refusée : ${JSON.stringify(res.body)}`);
  return res.body.sale as SaleOut;
}

async function saleDetail(id: string) {
  return (await t.get(`/sales/${id}`, admin).expect(200)).body;
}

function returnBody(
  saleId: string,
  entries: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return { saleId, reason: 'Produit non utilisé', refundMode: 'CREDIT', entries, ...extra };
}

async function client(id: string) {
  return t.prisma.client.findUniqueOrThrow({ where: { id } });
}

function binary(req: Test) {
  return req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('Retours clients et avoirs', () => {
  it('scénario 3 : retour partiel puis complémentaire → avoir → achat payé avec l’avoir → solde exact', async () => {
    const p = await twoLotProduct(2, 8);
    const c = await createClient();
    const sale = await sell(c.id, [{ productId: p.id, qty: 4 }], 'CARD'); // lot A × 2, lot B × 2
    const detail = await saleDetail(sale.id);
    const lineId = detail.lines[0].id as string;

    // Le préparateur a besoin du code administrateur (par défaut) ; sans lui : refusé.
    const info = await t.get(`/returns/sale/${sale.id}/returnable`, prep).expect(200);
    expect(
      info.body.lines[0].lots.map((l: { lotNumber: string; returnableQtyBase: number }) => [
        l.lotNumber,
        l.returnableQtyBase,
      ]),
    ).toEqual([
      [p.lotA.lotNumber, 2],
      [p.lotB.lotNumber, 2],
    ]);
    const refused = await t.post(
      '/returns',
      prep,
      returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotB.id, qty: 1 }]),
    );
    expect(refused.body.code).toBe('OVERRIDE_REQUIRED');
    expect(
      refused.body.details.requirements.map((r: { permission: string }) => r.permission),
    ).toContain('returns.approve');

    // Retour partiel : 1 dans le lot A, 1 dans le lot B — remis dans leurs lots d'origine.
    const first = await t
      .post(
        '/returns',
        prep,
        returnBody(
          sale.id,
          [
            { saleLineId: lineId, lotId: p.lotA.id, qty: 1 },
            { saleLineId: lineId, lotId: p.lotB.id, qty: 1 },
          ],
          { override: OVERRIDE },
        ),
      )
      .set('Idempotency-Key', `ret-${uniq()}`)
      .expect(201);
    expect(first.body.return.number).toMatch(/^RT-\d{4}-\d{6}$/);
    expect(first.body.return.creditNote.number).toMatch(/^AV-\d{4}-\d{6}$/);
    expect(Number(first.body.return.totalTtc)).toBe(2 * 2350);
    expect(first.body.return.authorizedBy.code).toBe(admin.code);
    expect((await t.prisma.lot.findUniqueOrThrow({ where: { id: p.lotA.id } })).remainingQty).toBe(
      1,
    );
    expect((await t.prisma.lot.findUniqueOrThrow({ where: { id: p.lotB.id } })).remainingQty).toBe(
      7,
    );
    const moves = await t.prisma.stockMovement.findMany({
      where: { documentId: first.body.return.id },
    });
    expect(moves.map((m) => m.type)).toEqual(['CUSTOMER_RETURN_IN', 'CUSTOMER_RETURN_IN']);
    let d = await saleDetail(sale.id);
    expect(d.returnStatus).toBe('PARTIALLY_RETURNED');
    expect(d.returnedAmount).toBe(4700);
    // RG-12 : une vente avec retour ne peut plus être annulée.
    const cancel = await t.post(`/sales/${sale.id}/cancel`, admin, {
      reasonCode: 'OTHER',
      reason: 'Tentative',
      refundMode: 'CREDIT',
    });
    expect(cancel.body.code).toBe('SALE_HAS_RETURNS');

    // Retour complémentaire du reste, puis dépassement refusé.
    await t
      .post(
        '/returns',
        admin,
        returnBody(sale.id, [
          { saleLineId: lineId, lotId: p.lotA.id, qty: 1 },
          { saleLineId: lineId, lotId: p.lotB.id, qty: 1 },
        ]),
      )
      .expect(201);
    d = await saleDetail(sale.id);
    expect(d.returnStatus).toBe('RETURNED');
    const over = await t.post(
      '/returns',
      admin,
      returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotB.id, qty: 1 }]),
    );
    expect(over.body.code).toBe('RETURN_QTY_EXCEEDED');

    // Solde : facture 4 × 2350 payée par carte, 2 avoirs de 4 700 → crédit disponible de 9 400 ? non : 4 × 2350 = 9 400 rendus.
    let account = (await t.get(`/clients/${c.id}/account`, prep).expect(200)).body;
    expect(account.availableCredit).toBe(9400);
    expect(account.balance).toBe(-9400);
    // Nouvel achat payé avec l'avoir (achat de 2 boîtes = 4 700).
    const draft = await t.post('/sales', prep, { clientId: c.id }).expect(201);
    await t.post(`/sales/${draft.body.id}/lines`, prep, { productId: p.id, qty: 2 }).expect(201);
    const paid = await t
      .post(`/sales/${draft.body.id}/validate`, prep, {
        document: 'NONE',
        payments: [],
        useCredit: 4700,
      })
      .expect(200);
    expect(paid.body.sale.paymentStatus).toBe('PAID');
    expect(paid.body.sale.payments[0].method).toBe('CREDIT_NOTE');
    account = (await t.get(`/clients/${c.id}/account`, prep).expect(200)).body;
    expect(account.availableCredit).toBe(4700);
    expect(Number((await client(c.id)).balance)).toBe(-4700);
    // Grand livre cohérent avec le cache du solde.
    const ledger = await t.get(`/clients/${c.id}/ledger`, prep).expect(200);
    const sum = ledger.body.items.reduce(
      (a: number, e: { debit: number; credit: number }) => a + e.debit - e.credit,
      0,
    );
    expect(sum).toBe(-4700);
  });

  it('l’avoir réduit d’abord le reste à payer de la facture d’origine ; l’excédent devient crédit', async () => {
    const p = await twoLotProduct(1, 9);
    const c = await createClient({ creditLimit: 100_000, paymentTermsDays: 30 });
    const sale = await sell(c.id, [{ productId: p.id, qty: 2 }], { cash: 1000 }); // 4 700 dont 3 700 dus
    expect(sale.amountDue).toBe(3700);
    const lineId = (await saleDetail(sale.id)).lines[0].id as string;
    const res = await t
      .post(
        '/returns',
        admin,
        returnBody(sale.id, [
          { saleLineId: lineId, lotId: p.lotA.id, qty: 1 },
          { saleLineId: lineId, lotId: p.lotB.id, qty: 1 },
        ]),
      )
      .expect(201);
    expect(res.body.return.creditNote.appliedTo).toEqual([
      expect.objectContaining({ saleNumber: sale.number, amount: 3700 }),
    ]);
    expect(res.body.return.creditNote.remainingAmount).toBe(1000);
    const d = await saleDetail(sale.id);
    expect(d.amountDue).toBe(0);
    expect(d.paymentStatus).toBe('PAID');
    const account = (await t.get(`/clients/${c.id}/account`, prep).expect(200)).body;
    expect(account.availableCredit).toBe(1000);
    expect(account.balance).toBe(-1000);
  });

  it('remboursement en espèces : réservé à l’administrateur, sortie de la session de caisse', async () => {
    const p = await twoLotProduct(1, 9);
    const c = await createClient();
    const sale = await sell(c.id, [{ productId: p.id, qty: 1 }], 'CASH');
    const lineId = (await saleDetail(sale.id)).lines[0].id as string;
    const denied = await t.post(
      '/returns',
      prep,
      returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotA.id, qty: 1 }], {
        refundMode: 'CASH',
        override: OVERRIDE,
      }),
    );
    expect(denied.status).toBe(403);
    const res = await t
      .post(
        '/returns',
        admin,
        returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotA.id, qty: 1 }], {
          refundMode: 'CASH',
        }),
      )
      .expect(201);
    const refund = await t.prisma.cashMovement.findFirst({
      where: { documentId: res.body.return.id, type: 'REFUND' },
    });
    expect(Number(refund?.amount)).toBe(-2350);
    expect(res.body.return.creditNote.remainingAmount).toBe(0);
    expect(Number((await client(c.id)).balance)).toBe(0);
    expect(
      await t.prisma.auditLog.count({
        where: { eventType: 'CASH_REFUND', entityId: res.body.return.id },
      }),
    ).toBe(1);
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'CUSTOMER_RETURN', entityId: res.body.return.id },
    });
    expect(audit?.severity).toBe('WARNING');
    expect(audit?.reason).toBe('Produit non utilisé');
  });

  it('produit non revendable : quarantaine ou destruction, jamais remis dans le stock vendable', async () => {
    const p = await twoLotProduct(1, 9);
    const c = await createClient();
    const sale = await sell(c.id, [{ productId: p.id, qty: 3 }], 'CARD'); // A × 1, B × 2
    const lineId = (await saleDetail(sale.id)).lines[0].id as string;
    const res = await t
      .post(
        '/returns',
        admin,
        returnBody(sale.id, [
          { saleLineId: lineId, lotId: p.lotB.id, qty: 1, condition: 'QUARANTINE' },
          { saleLineId: lineId, lotId: p.lotA.id, qty: 1, condition: 'DESTROY' },
        ]),
      )
      .expect(201);
    const lots = await t.prisma.lot.findMany({
      where: { productId: p.id },
      orderBy: { lotNumber: 'asc' },
    });
    const quarantine = lots.find(
      (l) => l.status === 'QUARANTINE' && l.lotNumber === `${p.lotB.lotNumber}-RET`,
    )!;
    expect(quarantine.remainingQty).toBe(1);
    // Le lot d'origine B n'a pas récupéré l'unité ; le lot A (détruit) reste à zéro.
    expect((await t.prisma.lot.findUniqueOrThrow({ where: { id: p.lotB.id } })).remainingQty).toBe(
      7,
    );
    expect((await t.prisma.lot.findUniqueOrThrow({ where: { id: p.lotA.id } })).remainingQty).toBe(
      0,
    );
    const destroyed = lots.find((l) => l.lotNumber === `${p.lotA.lotNumber}-RET`)!;
    expect(destroyed.remainingQty).toBe(0);
    const moves = await t.prisma.stockMovement.findMany({
      where: { documentId: res.body.return.id },
      orderBy: { id: 'asc' },
    });
    expect(moves.map((m) => `${m.type}:${m.qty}`)).toEqual([
      'CUSTOMER_RETURN_IN:1',
      'CUSTOMER_RETURN_IN:1',
      'LOSS:-1',
    ]);
    // Le stock vendable ne compte pas la quarantaine.
    const state = await t.get(`/products/${p.id}`, admin).expect(200);
    expect(state.body.stock.sellable).toBe(7);
    // Lot devenu périmé entre-temps → non revendable d'office.
    const sale2 = await sell(c.id, [{ productId: p.id, qty: 1 }], 'CARD');
    await t.prisma
      .$executeRaw`UPDATE lots SET expiry_date = current_date - 1 WHERE id = ${p.lotB.id}::uuid`;
    const line2 = (await saleDetail(sale2.id)).lines[0].id as string;
    const forced = await t
      .post(
        '/returns',
        admin,
        returnBody(sale2.id, [{ saleLineId: line2, lotId: p.lotB.id, qty: 1 }]),
      )
      .expect(201);
    expect(forced.body.warnings.join(' ')).toContain('Non revendable d’office');
    expect(forced.body.return.lines[0].resellable).toBe(false);
  });

  it('délai dépassé, produit non retournable et retour sans vente exigent une autorisation', async () => {
    const p = await twoLotProduct(1, 9);
    const c = await createClient();
    const sale = await sell(c.id, [{ productId: p.id, qty: 1 }], 'CARD');
    const lineId = (await saleDetail(sale.id)).lines[0].id as string;
    await t.prisma.sale.update({
      where: { id: sale.id },
      data: { validatedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    const late = await t.post(
      '/returns',
      prep,
      returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotA.id, qty: 1 }], {
        override: undefined,
      }),
    );
    expect(late.body.details.requirements.map((r: { permission: string }) => r.permission)).toEqual(
      expect.arrayContaining(['returns.late', 'returns.approve']),
    );
    await t
      .post(
        '/returns',
        prep,
        returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotA.id, qty: 1 }], {
          override: OVERRIDE,
        }),
      )
      .expect(201);

    const cold = await twoLotProduct(1, 4, { coldChain: true });
    const sale2 = await sell(c.id, [{ productId: cold.id, qty: 1 }], 'CARD');
    const line2 = (await saleDetail(sale2.id)).lines[0].id as string;
    const blocked = await t.post(
      '/returns',
      prep,
      returnBody(sale2.id, [{ saleLineId: line2, lotId: cold.lotA.id, qty: 1 }]),
    );
    expect(
      blocked.body.details.requirements.map((r: { permission: string }) => r.permission),
    ).toContain('returns.non_returnable');

    const noSale = await t.post('/returns', admin, {
      clientId: c.id,
      reason: 'Boîte apportée sans facture',
      refundMode: 'CREDIT',
      entries: [{ productId: p.id, lotId: p.lotB.id, qty: 1, amount: 2000 }],
    });
    expect(noSale.body.code).toBe('RETURN_NOT_ALLOWED');
  });

  it('idempotence : un rejeu ne crée ni deuxième retour ni deuxième mouvement', async () => {
    const p = await twoLotProduct(1, 9);
    const c = await createClient();
    const sale = await sell(c.id, [{ productId: p.id, qty: 2 }], 'CARD');
    const lineId = (await saleDetail(sale.id)).lines[0].id as string;
    const key = `ret-${uniq()}`;
    const body = returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotB.id, qty: 1 }]);
    const a = await t.post('/returns', admin, body).set('Idempotency-Key', key).expect(201);
    const b = await t.post('/returns', admin, body).set('Idempotency-Key', key).expect(201);
    expect(b.body.return.id).toBe(a.body.return.id);
    expect(await t.prisma.customerReturn.count({ where: { saleId: sale.id } })).toBe(1);
  });

  it('imprime l’avoir en A4 et en ticket ; la réimpression porte DUPLICATA et est tracée', async () => {
    const p = await twoLotProduct(1, 9);
    const c = await createClient();
    const sale = await sell(c.id, [{ productId: p.id, qty: 1 }], 'CARD');
    const lineId = (await saleDetail(sale.id)).lines[0].id as string;
    const ret = await t
      .post(
        '/returns',
        admin,
        returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotA.id, qty: 1 }]),
      )
      .expect(201);
    const a4 = await binary(t.get(`/returns/${ret.body.return.id}/print?format=A4`, admin)).expect(
      200,
    );
    expect((a4.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await binary(t.get(`/returns/${ret.body.return.id}/print?format=TICKET`, admin)).expect(200);
    expect(
      await t.prisma.auditLog.count({
        where: { eventType: 'DOCUMENT_REPRINTED', entityId: ret.body.return.id },
      }),
    ).toBe(1);
    const list = await t.get(`/returns?clientId=${c.id}`, prep).expect(200);
    expect(list.body.items).toHaveLength(1);
  });
});

describe('Règlements, lettrage, chèques, comptes', () => {
  it('scénario 4 : vente à crédit → règlement partiel lettré → règlement du reste → facture soldée', async () => {
    const p = await twoLotProduct(2, 30);
    const c = await createClient({ creditLimit: 500_000, paymentTermsDays: 30 });
    const inv1 = await sell(c.id, [{ productId: p.id, qty: 2 }], 'CREDIT'); // 4 700
    const inv2 = await sell(c.id, [{ productId: p.id, qty: 1 }], 'CREDIT'); // 2 350
    expect(Number((await client(c.id)).balance)).toBe(7050);

    const part = await t
      .post('/payments', prep, { clientId: c.id, method: 'CASH', amount: 3000, allocation: 'AUTO' })
      .set('Idempotency-Key', `pay-${uniq()}`)
      .expect(201);
    expect(part.body.payment.number).toMatch(/^REG-\d{4}-\d{6}$/);
    expect(part.body.payment.allocations).toHaveLength(1);
    expect(part.body.payment.allocated).toBe(3000);
    let d1 = await saleDetail(inv1.id);
    expect(d1.paymentStatus).toBe('PARTIALLY_PAID');
    expect(d1.amountDue).toBe(1700);
    const cash = await t.prisma.cashMovement.findFirst({
      where: { documentId: part.body.payment.id, type: 'SALE_PAYMENT' },
    });
    expect(Number(cash?.amount)).toBe(3000);

    // Le reste (1 700 + 2 350) par carte : factures les plus anciennes d'abord.
    const rest = await t
      .post('/payments', prep, { clientId: c.id, method: 'CARD', amount: 4050, allocation: 'AUTO' })
      .expect(201);
    expect(
      rest.body.payment.allocations.map((a: { sale: { number: string }; amount: number }) => [
        a.sale.number,
        a.amount,
      ]),
    ).toEqual([
      [inv1.number, 1700],
      [inv2.number, 2350],
    ]);
    d1 = await saleDetail(inv1.id);
    expect(d1.paymentStatus).toBe('PAID');
    expect((await saleDetail(inv2.id)).paymentStatus).toBe('PAID');
    expect(Number((await client(c.id)).balance)).toBe(0);
    expect(d1.payments.map((x: { number: string }) => x.number)).toHaveLength(2);
    // Rejeu avec la même clé : même résultat, un seul règlement.
    const key = `pay-${uniq()}`;
    const a = await t
      .post('/payments', prep, {
        clientId: c.id,
        method: 'TRANSFER',
        reference: 'VIR-1',
        amount: 1000,
        allocation: 'NONE',
      })
      .set('Idempotency-Key', key)
      .expect(201);
    const b = await t
      .post('/payments', prep, {
        clientId: c.id,
        method: 'TRANSFER',
        reference: 'VIR-1',
        amount: 1000,
        allocation: 'NONE',
      })
      .set('Idempotency-Key', key)
      .expect(201);
    expect(b.body.payment.id).toBe(a.body.payment.id);
  });

  it('lettrage manuel, reliquat en acompte, puis usage de l’acompte sans nouvel encaissement', async () => {
    const p = await twoLotProduct(2, 30);
    const c = await createClient({ creditLimit: 500_000 });
    const inv1 = await sell(c.id, [{ productId: p.id, qty: 2 }], 'CREDIT'); // 4 700
    const inv2 = await sell(c.id, [{ productId: p.id, qty: 1 }], 'CREDIT'); // 2 350
    // Manuel : 5 000 dont 2 350 sur la seconde facture → 2 650 d'acompte.
    const tooMuch = await t.post('/payments', prep, {
      clientId: c.id,
      method: 'CARD',
      amount: 5000,
      allocation: 'MANUAL',
      items: [{ saleId: inv2.id, amount: 9999 }],
    });
    expect(tooMuch.status).toBe(400);
    const over = await t.post('/payments', prep, {
      clientId: c.id,
      method: 'CARD',
      amount: 20_000,
      allocation: 'MANUAL',
      items: [{ saleId: inv2.id, amount: 3000 }],
    });
    expect(over.body.code).toBe('ALLOCATION_EXCEEDS_DUE');
    const pay = await t
      .post('/payments', prep, {
        clientId: c.id,
        method: 'CARD',
        amount: 5000,
        allocation: 'MANUAL',
        items: [{ saleId: inv2.id, amount: 2350 }],
      })
      .expect(201);
    expect(pay.body.payment.unallocated).toBe(2650);
    expect((await saleDetail(inv2.id)).paymentStatus).toBe('PAID');
    expect((await saleDetail(inv1.id)).paymentStatus).toBe('UNPAID');
    let account = (await t.get(`/clients/${c.id}/account`, prep).expect(200)).body;
    expect(account.availableCredit).toBe(2650);
    // Lettrage sans encaissement : l'acompte sur la première facture.
    const settled = await t.post(`/clients/${c.id}/settle`, prep, { mode: 'AUTO' }).expect(200);
    expect(settled.body.allocated).toBe(2650);
    expect((await saleDetail(inv1.id)).amountDue).toBe(2050);
    account = (await t.get(`/clients/${c.id}/account`, prep).expect(200)).body;
    expect(account.availableCredit).toBe(0);
    expect(account.balance).toBe(2050);
    const nothing = await t.post(`/clients/${c.id}/settle`, prep, { mode: 'AUTO' });
    expect(nothing.status).toBe(400);
  });

  it('annulation d’un règlement : administrateur seul, motif obligatoire, facture rouverte, contre-écriture de caisse', async () => {
    const p = await twoLotProduct(2, 30);
    const c = await createClient({ creditLimit: 500_000 });
    const inv = await sell(c.id, [{ productId: p.id, qty: 2 }], 'CREDIT');
    const pay = await t
      .post('/payments', prep, { clientId: c.id, method: 'CASH', amount: 4700, allocation: 'AUTO' })
      .expect(201);
    expect((await saleDetail(inv.id)).paymentStatus).toBe('PAID');
    const id = pay.body.payment.id as string;
    await t.post(`/payments/${id}/cancel`, prep, { reason: 'Erreur de saisie' }).expect(403);
    const noReason = await t.post(`/payments/${id}/cancel`, admin, { reason: '' });
    expect(noReason.status).toBe(400);
    const cancelled = await t
      .post(`/payments/${id}/cancel`, admin, { reason: 'Erreur de saisie du montant' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const d = await saleDetail(inv.id);
    expect(d.paymentStatus).toBe('UNPAID');
    expect(d.amountDue).toBe(4700);
    expect(Number((await client(c.id)).balance)).toBe(4700);
    const out = await t.prisma.cashMovement.findFirst({
      where: { documentId: id, type: 'REFUND' },
    });
    expect(Number(out?.amount)).toBe(-4700);
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'PAYMENT_CANCELLED', entityId: id },
    });
    expect(audit?.severity).toBe('CRITICAL');
    const again = await t.post(`/payments/${id}/cancel`, admin, { reason: 'Deuxième essai' });
    expect(again.body.code).toBe('PAYMENT_NOT_VALID');
  });

  it('chèques : portefeuille par échéance, remis en banque, encaissé ; impayé → lettrage annulé, facture rouverte', async () => {
    const p = await twoLotProduct(2, 30);
    const c = await createClient({ creditLimit: 500_000 });
    const inv = await sell(c.id, [{ productId: p.id, qty: 2 }], 'CREDIT');
    const missing = await t.post('/payments', prep, {
      clientId: c.id,
      method: 'CHEQUE',
      amount: 4700,
      allocation: 'AUTO',
    });
    expect(missing.status).toBe(400);
    const due = addDaysIso(today(), 10);
    const pay = await t
      .post('/payments', prep, {
        clientId: c.id,
        method: 'CHEQUE',
        amount: 4700,
        chequeNumber: '1234567',
        bank: 'BIAT',
        dueDate: due,
        allocation: 'AUTO',
      })
      .expect(201);
    const id = pay.body.payment.id as string;
    expect(pay.body.payment.chequeStatus).toBe('IN_PORTFOLIO');
    const portfolio = await t
      .get(`/payments/cheques?status=IN_PORTFOLIO&clientId=${c.id}`, prep)
      .expect(200);
    expect(portfolio.body.items[0]).toEqual(
      expect.objectContaining({ id, dueDate: due, daysToDue: 10, overdue: false }),
    );
    await t.post(`/payments/${id}/cheque-status`, prep, { status: 'DEPOSITED' }).expect(200);
    const back = await t.post(`/payments/${id}/cheque-status`, prep, { status: 'DEPOSITED' });
    expect(back.body.code).toBe('CONFLICT');
    // Impayé : administrateur seul.
    await t.post(`/payments/${id}/bounce`, prep, { reason: 'Provision insuffisante' }).expect(403);
    const bounced = await t
      .post(`/payments/${id}/bounce`, admin, { reason: 'Provision insuffisante' })
      .expect(200);
    expect(bounced.body.status).toBe('BOUNCED');
    expect(bounced.body.chequeStatus).toBe('BOUNCED');
    const d = await saleDetail(inv.id);
    expect(d.paymentStatus).toBe('UNPAID');
    expect(Number((await client(c.id)).balance)).toBe(4700);
    expect(await t.prisma.cashMovement.count({ where: { documentId: id } })).toBe(0);
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'CHEQUE_BOUNCED', entityId: id },
    });
    expect(audit?.severity).toBe('CRITICAL');
    const after = await t.post(`/payments/${id}/cheque-status`, prep, { status: 'CASHED' });
    expect(after.body.code).toBe('PAYMENT_NOT_VALID');
    // Un règlement en espèces ne peut pas être déclaré impayé.
    const cash = await t
      .post('/payments', prep, { clientId: c.id, method: 'CASH', amount: 1000, allocation: 'NONE' })
      .expect(201);
    const notCheque = await t.post(`/payments/${cash.body.payment.id}/bounce`, admin, {
      reason: 'Test',
    });
    expect(notCheque.body.code).toBe('PAYMENT_NOT_VALID');
  });

  it('balance âgée : tranches 0–30, 31–60, 61–90, > 90 jours', async () => {
    const p = await twoLotProduct(2, 30);
    const c = await createClient({ creditLimit: 500_000, paymentTermsDays: 30 });
    const old = await sell(c.id, [{ productId: p.id, qty: 2 }], 'CREDIT'); // 4 700
    const recent = await sell(c.id, [{ productId: p.id, qty: 1 }], 'CREDIT'); // 2 350
    await t.prisma.sale.update({
      where: { id: old.id },
      data: {
        validatedAt: new Date(Date.now() - 100 * 86_400_000),
        dueDate: new Date(Date.now() - 70 * 86_400_000),
      },
    });
    const aging = await t.get('/payments/aging', prep).expect(200);
    const row = aging.body.clients.find((r: { clientId: string }) => r.clientId === c.id);
    expect(row.buckets).toEqual([2350, 0, 0, 4700]);
    expect(row.total).toBe(7050);
    expect(row.overdue).toBe(4700);
    expect(aging.body.totals.total).toBeGreaterThanOrEqual(7050);
    const open = await t.get(`/clients/${c.id}/open-invoices`, prep).expect(200);
    expect(open.body.map((o: { number: string }) => o.number)).toEqual([old.number, recent.number]);
    expect(open.body[0].overdueDays).toBeGreaterThan(60);
  });

  it('relevé de compte : solde d’ouverture + mouvements = solde de clôture ; PDF et Excel', async () => {
    const p = await twoLotProduct(2, 30);
    const c = await createClient({ creditLimit: 500_000 });
    await sell(c.id, [{ productId: p.id, qty: 2 }], 'CREDIT');
    await t
      .post('/payments', prep, { clientId: c.id, method: 'CARD', amount: 1000, allocation: 'AUTO' })
      .expect(201);
    const ledger = t.app.get(LedgerService);
    const st = await ledger.statement(c.id, today(), today());
    expect(st.opening).toBe(0);
    expect(st.totalDebit).toBe(4700);
    expect(st.totalCredit).toBe(1000);
    expect(st.closing).toBe(3700);
    expect(st.closing).toBe(Number((await client(c.id)).balance));
    // Période future : solde d'ouverture = solde actuel, aucun mouvement.
    const tomorrow = addDaysIso(today(), 1);
    const future = await ledger.statement(c.id, tomorrow, addDaysIso(tomorrow, 5));
    expect(future.opening).toBe(3700);
    expect(future.rows).toHaveLength(0);
    const pdf = await binary(
      t.get(`/clients/${c.id}/statement?from=${today()}&to=${today()}&format=pdf`, prep),
    ).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const xlsx = await binary(
      t.get(`/clients/${c.id}/statement?from=${today()}&to=${today()}&format=xlsx`, prep),
    ).expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const inverted = await t.get(`/clients/${c.id}/statement?from=${tomorrow}&to=${today()}`, prep);
    expect(inverted.status).toBe(400);
    const receipt = await binary(
      t.get(
        `/payments/${(await t.prisma.payment.findFirstOrThrow({ where: { clientId: c.id } })).id}/print?format=TICKET`,
        prep,
      ),
    ).expect(200);
    expect((receipt.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('refuse au préparateur les opérations réservées à l’administrateur', async () => {
    await t
      .post(`/payments/${(await t.prisma.payment.findFirstOrThrow()).id}/cancel`, prep, {
        reason: 'Test',
      })
      .expect(403);
    await t
      .post(`/payments/${(await t.prisma.payment.findFirstOrThrow()).id}/bounce`, prep, {
        reason: 'Test',
      })
      .expect(403);
  });
});

describe('E-mails des avoirs, reçus et relevés', () => {
  const smtp = new FakeSmtp();
  let outbox: EmailOutboxService;

  beforeAll(async () => {
    await smtp.start();
    outbox = t.app.get(EmailOutboxService);
    await t
      .put('/email/smtp', admin, {
        enabled: true,
        host: '127.0.0.1',
        port: smtp.port,
        security: 'NONE',
        username: '',
        fromName: 'Pharmacie Test',
        fromEmail: 'factures@example.com',
        replyTo: '',
        bccArchive: '',
        hourlyLimit: 100,
      })
      .expect(200);
    await t.post('/email/smtp/test-connection', admin).expect(200);
  });
  afterAll(async () => {
    // Les fichiers de test partagent la base : on rend le SMTP inactif pour les suivants.
    await t
      .put('/email/smtp', admin, {
        enabled: false,
        host: '',
        port: 587,
        security: 'STARTTLS',
        username: '',
        fromName: '',
        fromEmail: '',
        replyTo: '',
        bccArchive: '',
        hourlyLimit: 100,
      })
      .expect(200);
    await smtp.stop();
  });

  it('envoie automatiquement l’avoir et le reçu (PDF joint) aux clients consentants, sans nom de médicament', async () => {
    const p = await twoLotProduct(2, 30, { name: `Produit Confidentiel ${uniq()}` });
    const c = await createClient({
      email: 'client.avoir@example.com',
      emailConsent: true,
      creditLimit: 500_000,
    });
    const sale = await sell(c.id, [{ productId: p.id, qty: 2 }], 'CREDIT');
    const lineId = (await saleDetail(sale.id)).lines[0].id as string;
    const ret = await t
      .post(
        '/returns',
        admin,
        returnBody(sale.id, [{ saleLineId: lineId, lotId: p.lotA.id, qty: 1 }]),
      )
      .expect(201);
    const pay = await t
      .post('/payments', prep, { clientId: c.id, method: 'CARD', amount: 1000, allocation: 'AUTO' })
      .expect(201);
    const before = smtp.messages.length;
    await outbox.processBatch();
    const mails = smtp.messages.slice(before);
    const avoir = mails.find((m) => m.subject?.includes(ret.body.return.creditNote.number));
    const recu = mails.find((m) => m.subject?.includes(pay.body.payment.number));
    expect(avoir?.attachments[0]?.filename).toBe(`${ret.body.return.creditNote.number}.pdf`);
    expect(recu?.attachments[0]?.filename).toBe(`${pay.body.payment.number}.pdf`);
    for (const m of mails) {
      expect(m.html || '').not.toContain('Confidentiel');
      expect(m.text || '').not.toContain('Confidentiel');
    }
    // Journal : les documents sont liés (numéro lisible).
    const log = await t.get(`/email/log?clientId=${c.id}`, admin).expect(200);
    expect(log.body.items.map((i: { documentNumber: string }) => i.documentNumber)).toEqual(
      expect.arrayContaining([ret.body.return.creditNote.number, pay.body.payment.number]),
    );
  });

  it('relevé par e-mail : envoi manuel ; sans consentement, confirmation explicite', async () => {
    const c = await createClient({
      email: 'sans.consentement.releve@example.com',
      emailConsent: false,
    });
    const refused = await t.post(`/clients/${c.id}/statement/email`, prep, {
      from: today(),
      to: today(),
      recipients: ['sans.consentement.releve@example.com'],
    });
    expect(refused.body.code).toBe('EMAIL_CONSENT_REQUIRED');
    await t
      .post(`/clients/${c.id}/statement/email`, prep, {
        from: today(),
        to: today(),
        recipients: ['sans.consentement.releve@example.com'],
        confirmNoConsent: true,
      })
      .expect(200);
    const before = smtp.messages.length;
    await outbox.processBatch();
    const mail = smtp.messages
      .slice(before)
      .find((m) => m.to && JSON.stringify(m.to).includes('sans.consentement.releve'));
    expect(mail?.attachments[0]?.filename).toContain('Releve-');
    const history = await t.get(`/clients/${c.id}/emails`, prep).expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0].status).toBe('SENT');
  });
});
