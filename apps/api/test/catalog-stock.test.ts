import ExcelJS from 'exceljs';
import { addDaysIso, addMonthsIso, todayIso } from '@pharmastock/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext, uniq, type Session } from './helpers.js';

const t = new TestContext();
let admin: Session & { code: string };
let prep: Session & { code: string };
let refs: { categoryId: string; tva7: string; labId: string; supplierId: string };
const today = () => todayIso('Africa/Tunis');

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
});
afterAll(() => t.stop());

function productBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `Paracétamol ${uniq()}`,
    dci: 'Paracétamol',
    dosage: '500 mg',
    form: 'Comprimé',
    presentation: 'Boîte de 20',
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
    minStock: 5,
    barcodes: [],
    ...overrides,
  };
}

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/products', admin, productBody(overrides));
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; internalCode: string; version: number };
}

async function receive(
  lines: Record<string, unknown>[],
  session: Session = admin,
  validate = true,
) {
  const draft = await t
    .post('/receipts', session, {
      sourceType: 'SUPPLIER',
      supplierId: refs.supplierId,
      receivedAt: today(),
      supplierInvoiceRef: uniq('FACT'),
      lines,
    })
    .expect(201);
  if (!validate) return draft.body as { id: string; number: string };
  const validated = await t.post(`/receipts/${draft.body.id}/validate`, session, {
    acknowledgeWarnings: true,
  });
  if (validated.status !== 200)
    throw new Error(`Validation refusée : ${JSON.stringify(validated.body)}`);
  return validated.body as { id: string; number: string };
}

describe('Catalogue', () => {
  it('crée un produit avec code automatique, refuse un code-barres en double', async () => {
    const barcode = `619${Date.now().toString().slice(-10)}`;
    const p = await createProduct({ barcodes: [barcode] });
    expect(p.internalCode).toMatch(/^P\d{6}$/);
    const dup = await t.post('/products', admin, productBody({ barcodes: [barcode] }));
    expect(dup.body.code).toBe('DUPLICATE_BARCODE');
    const found = await t.get(`/products/search?q=${barcode}`, admin).expect(200);
    expect(found.body[0].id).toBe(p.id);
  });

  it('trouve un produit malgré les accents et une faute légère', async () => {
    const p = await createProduct({
      name: `Éfferalgan Vitaminé ${uniq()}`,
      dci: 'Paracétamol vitamine C',
    });
    const res = await t.get('/products/search?q=efferalgan vitamine', admin).expect(200);
    expect(res.body.map((x: { id: string }) => x.id)).toContain(p.id);
    // Faute de frappe (lettre manquante) : recherche approximative en repli.
    const typo = await t.get('/products/search?q=eferalgan', admin).expect(200);
    expect(typo.body.map((x: { id: string }) => x.id)).toContain(p.id);
  });

  it('historise les changements de prix et masque les coûts au préparateur', async () => {
    const p = await createProduct();
    const full = await t.get(`/products/${p.id}`, admin).expect(200);
    await t
      .put(`/products/${p.id}`, admin, {
        ...productBody(),
        name: full.body.name,
        salePriceTtc: 2500,
        version: full.body.version,
      })
      .expect(200);
    const history = await t.get(`/products/${p.id}/price-history`, admin).expect(200);
    expect(history.body[0]).toMatchObject({
      field: 'salePriceTtc',
      oldValue: 2350,
      newValue: 2500,
    });
    expect(
      await t.prisma.auditLog.count({
        where: { eventType: 'PRODUCT_PRICE_CHANGED', entityId: p.id },
      }),
    ).toBe(1);
    const asPrep = await t.get(`/products/${p.id}`, prep).expect(200);
    expect(asPrep.body.refPurchasePriceHt).toBeUndefined();
    expect((await t.post('/products', prep, productBody())).status).toBe(403);
  });

  it('refuse une modification concurrente (contrôle de version)', async () => {
    const p = await createProduct();
    const full = await t.get(`/products/${p.id}`, admin).expect(200);
    await t
      .put(`/products/${p.id}`, admin, {
        ...productBody(),
        name: full.body.name,
        version: full.body.version,
      })
      .expect(200);
    const stale = await t.put(`/products/${p.id}`, admin, {
      ...productBody(),
      name: full.body.name,
      version: full.body.version,
    });
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });
});

describe('Réceptions et lots (RG-08, RG-15)', () => {
  it('crée un lot par ligne avec le coût unitaire tenant compte des unités gratuites', async () => {
    const p = await createProduct();
    const exp1 = addMonthsIso(today(), 12);
    const exp2 = addMonthsIso(today(), 24);
    const receipt = await receive([
      {
        productId: p.id,
        lotNumber: 'L-A',
        expiryDate: exp1,
        qty: 10,
        freeQty: 2,
        unitPriceHt: 3000,
        tvaRateBp: 700,
      },
      {
        productId: p.id,
        lotNumber: 'L-B',
        expiryDate: exp2,
        qty: 5,
        freeQty: 0,
        unitPriceHt: 3000,
        discountBp: 1000,
        tvaRateBp: 700,
      },
    ]);
    expect(receipt.number).toMatch(new RegExp(`^REC-${today().slice(0, 4)}-\\d{6}$`));
    const lots = await t.prisma.lot.findMany({
      where: { productId: p.id },
      orderBy: { lotNumber: 'asc' },
    });
    expect(
      lots.map((l) => [l.lotNumber, l.initialQty, l.remainingQty, Number(l.unitCostHt)]),
    ).toEqual([
      ['L-A', 12, 12, 2500], // 10 × 3,000 / 12
      ['L-B', 5, 5, 2700], // remise 10 %
    ]);
    const movements = await t.prisma.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: { id: 'asc' },
    });
    expect(movements.map((m) => [m.type, m.qty, m.productBalanceAfter, m.documentNumber])).toEqual([
      ['PURCHASE_IN', 12, 12, receipt.number],
      ['PURCHASE_IN', 5, 17, receipt.number],
    ]);
    const product = await t.get(`/products/${p.id}`, prep).expect(200);
    expect(product.body.stock).toMatchObject({
      total: 17,
      sellable: 17,
      lotCount: 2,
      nextExpiry: exp1,
      status: 'OK',
    });
  });

  it('bloque une péremption passée et exige la confirmation d’une péremption proche', async () => {
    const p = await createProduct();
    const past = await receive(
      [
        {
          productId: p.id,
          lotNumber: 'X',
          expiryDate: today(),
          qty: 1,
          unitPriceHt: 1000,
          tvaRateBp: 700,
        },
      ],
      admin,
      false,
    );
    const refused = await t.post(`/receipts/${past.id}/validate`, admin, {
      acknowledgeWarnings: true,
    });
    expect(refused.body.code).toBe('EXPIRY_IN_PAST');

    const soon = await receive(
      [
        {
          productId: p.id,
          lotNumber: 'Y',
          expiryDate: addDaysIso(today(), 40),
          qty: 1,
          unitPriceHt: 1500,
          tvaRateBp: 700,
        },
      ],
      admin,
      false,
    );
    const needAck = await t.post(`/receipts/${soon.id}/validate`, admin, {});
    expect(needAck.body.details.warnings[0].kind).toBe('EXPIRY_SOON');
    await t.post(`/receipts/${soon.id}/validate`, admin, { acknowledgeWarnings: true }).expect(200);
  });

  it('convertit les boîtes en unités pour un produit vendu à l’unité', async () => {
    const p = await createProduct({ unitsPerPack: 30, sellByUnit: true, unitSalePriceTtc: 100 });
    await receive([
      {
        productId: p.id,
        lotNumber: 'U1',
        expiryDate: addMonthsIso(today(), 18),
        qty: 4,
        unitPriceHt: 3000,
        tvaRateBp: 700,
      },
    ]);
    const lot = await t.prisma.lot.findFirstOrThrow({ where: { productId: p.id } });
    expect(lot.initialQty).toBe(120);
    expect(Number(lot.unitCostHt)).toBe(100);
    const locked = await t.put(
      `/products/${p.id}`,
      admin,
      productBody({ unitsPerPack: 20, sellByUnit: true, unitSalePriceTtc: 100 }),
    );
    expect(locked.body.code).toBe('CONFLICT');
  });

  it('annule une réception non consommée et interdit l’annulation au préparateur', async () => {
    const p = await createProduct();
    const receipt = await receive([
      {
        productId: p.id,
        lotNumber: 'C1',
        expiryDate: addMonthsIso(today(), 12),
        qty: 6,
        unitPriceHt: 1000,
        tvaRateBp: 700,
      },
    ]);
    expect(
      (await t.post(`/receipts/${receipt.id}/cancel`, prep, { reason: 'Erreur de saisie' })).status,
    ).toBe(403);
    await t
      .post(`/receipts/${receipt.id}/cancel`, admin, { reason: 'Erreur de saisie' })
      .expect(200);
    const lot = await t.prisma.lot.findFirstOrThrow({ where: { productId: p.id } });
    expect(lot).toMatchObject({ remainingQty: 0, status: 'EXHAUSTED' });
    const last = await t.prisma.stockMovement.findFirstOrThrow({
      where: { productId: p.id },
      orderBy: { id: 'desc' },
    });
    expect(last).toMatchObject({ type: 'RECEIPT_CANCEL', qty: -6, productBalanceAfter: 0 });
    const log = await t.prisma.auditLog.findFirstOrThrow({
      where: { eventType: 'RECEIPT_CANCELLED', entityId: receipt.id },
    });
    expect(log.severity).toBe('CRITICAL');
    expect(log.reason).toBe('Erreur de saisie');
  });

  it('attribue des numéros continus sans trou sous concurrence (RG-10)', async () => {
    const p = await createProduct();
    const drafts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        receive(
          [
            {
              productId: p.id,
              lotNumber: `N${i}`,
              expiryDate: addMonthsIso(today(), 12),
              qty: 1,
              unitPriceHt: 1000,
              tvaRateBp: 700,
            },
          ],
          admin,
          false,
        ),
      ),
    );
    const results = await Promise.all(
      drafts.map((d) => t.post(`/receipts/${d.id}/validate`, admin, { acknowledgeWarnings: true })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const numbers = results
      .map((r) => Number((r.body.number as string).slice(-6)))
      .sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i += 1) expect(numbers[i]! - numbers[i - 1]!).toBe(1);
    const all = await t.prisma.purchaseReceipt.findMany({
      where: { number: { not: null } },
      select: { number: true },
    });
    const seq = all.map((r) => Number(r.number!.slice(-6))).sort((a, b) => a - b);
    expect(seq).toEqual(Array.from({ length: seq.length }, (_, i) => i + 1));
  });
});

describe('Stock : lots, fiche de mouvement, stock à date', () => {
  it('produit une fiche de mouvement avec stock initial, utilisateur et solde exact (RG-21)', async () => {
    const p = await createProduct();
    await receive([
      {
        productId: p.id,
        lotNumber: 'M1',
        expiryDate: addMonthsIso(today(), 12),
        qty: 10,
        unitPriceHt: 1000,
        tvaRateBp: 700,
      },
    ]);
    await receive(
      [
        {
          productId: p.id,
          lotNumber: 'M2',
          expiryDate: addMonthsIso(today(), 13),
          qty: 4,
          unitPriceHt: 1000,
          tvaRateBp: 700,
        },
      ],
      prep,
    );
    const sheet = await t.get(`/stock/movements?productId=${p.id}&from=${today()}`, admin);
    if (sheet.status !== 200) throw new Error(JSON.stringify(sheet.body));
    expect(sheet.body.openingQty).toBe(0);
    expect(sheet.body.totalIn).toBe(14);
    expect(sheet.body.closingQty).toBe(14);
    expect(sheet.body.items.map((i: { balanceAfter: number }) => i.balanceAfter)).toEqual([10, 14]);
    expect(sheet.body.items[1].user.code).toBe(prep.code);
    expect(sheet.body.items[1].device).toBe('Poste de test');
    const tomorrow = await t
      .get(
        `/stock/movements?productId=${p.id}&from=${addDaysIso(today(), 1)}&to=${addDaysIso(today(), 1)}`,
        admin,
      )
      .expect(200);
    expect(tomorrow.body.openingQty).toBe(14);
    const asPrep = await t
      .get(`/stock/movements?productId=${p.id}&from=${today()}`, prep)
      .expect(200);
    expect(asPrep.body.items[0].unitCostHt).toBeNull();
  });

  it('bloque un lot (non vendable) et le débloque', async () => {
    const p = await createProduct();
    await receive([
      {
        productId: p.id,
        lotNumber: 'B1',
        expiryDate: addMonthsIso(today(), 12),
        qty: 3,
        unitPriceHt: 1000,
        tvaRateBp: 700,
      },
    ]);
    const lot = await t.prisma.lot.findFirstOrThrow({ where: { productId: p.id } });
    expect(
      (await t.post(`/stock/lots/${lot.id}/block`, prep, { reason: 'Doute qualité' })).status,
    ).toBe(403);
    await t.post(`/stock/lots/${lot.id}/block`, admin, { reason: 'Doute qualité' }).expect(200);
    let product = await t.get(`/products/${p.id}`, admin).expect(200);
    expect(product.body.stock).toMatchObject({ total: 3, sellable: 0, status: 'OUT' });
    await t
      .post(`/stock/lots/${lot.id}/unblock`, admin, { reason: 'Contrôle conforme' })
      .expect(200);
    product = await t.get(`/products/${p.id}`, admin).expect(200);
    expect(product.body.stock.sellable).toBe(3);
  });

  it('liste les péremptions, l’état du stock et le stock à date', async () => {
    const p = await createProduct({ minStock: 10 });
    await receive([
      {
        productId: p.id,
        lotNumber: 'E1',
        expiryDate: addDaysIso(today(), 20),
        qty: 2,
        unitPriceHt: 1000,
        tvaRateBp: 700,
      },
    ]);
    const expiries = await t.get('/stock/expiries?days=30&pageSize=200', admin).expect(200);
    const row = expiries.body.items.find((i: { product: { id: string } }) => i.product.id === p.id);
    expect(row).toMatchObject({ level: 'CRITICAL', remainingQty: 2, valueCost: 2000 });
    const state = await t
      .get(
        `/stock/state?q=${encodeURIComponent((await t.get(`/products/${p.id}`, admin)).body.internalCode)}`,
        admin,
      )
      .expect(200);
    expect(state.body.items[0]).toMatchObject({ id: p.id, sellable: 2, status: 'LOW' });
    const atDate = await t
      .get(`/stock/at-date?date=${addDaysIso(today(), -1)}&q=${p.internalCode}`, admin)
      .expect(200);
    expect(atDate.body.items).toHaveLength(0);
  });
});

describe('Import du catalogue', () => {
  it('simule puis importe un fichier Excel avec rapport ligne par ligne', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Catalogue');
    ws.addRow([
      'Code',
      'Nom commercial',
      'DCI',
      'Dosage',
      'Laboratoire',
      'Catégorie',
      'TVA (%)',
      'Prix vente TTC',
      'Prix achat HT',
      'Codes-barres (séparés par ;)',
    ]);
    const code = uniq('IMP');
    ws.addRow([
      code,
      'Amoxicilline Import',
      'Amoxicilline',
      '1 g',
      'Labo Import',
      'Antibiotiques import',
      7,
      '12,500',
      '8,2',
      '',
    ]);
    ws.addRow(['', 'Sans prix', 'X', '', '', '', 7, '', '', '']);
    ws.addRow(['', 'TVA inconnue', 'X', '', '', '', 11, '5', '', '']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const dry = await t.http
      .post('/api/v1/products/import?dryRun=1')
      .set(t.auth(admin))
      .attach('file', buffer, 'catalogue.xlsx')
      .expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, total: 3, created: 1, errors: 2 });
    expect(await t.prisma.product.count({ where: { internalCode: code.toUpperCase() } })).toBe(0);
    const real = await t.http
      .post('/api/v1/products/import?dryRun=0')
      .set(t.auth(admin))
      .attach('file', buffer, 'catalogue.xlsx')
      .expect(200);
    expect(real.body.created).toBe(1);
    const product = await t.prisma.product.findUniqueOrThrow({
      where: { internalCode: code.toUpperCase() },
      include: { laboratory: true },
    });
    expect(Number(product.salePriceTtc)).toBe(12500);
    expect(Number(product.refPurchasePriceHt)).toBe(8200);
    expect(product.laboratory?.name).toBe('Labo Import');
    expect(real.body.lines[1].errors[0]).toContain('Prix de vente');
  });
});

describe('Clients et fournisseurs', () => {
  it('le préparateur crée un client mais ne peut pas fixer le plafond de crédit', async () => {
    const res = await t
      .post('/clients', prep, {
        type: 'INDIVIDUAL',
        name: 'Mohamed Ali',
        phone: '98 123 456',
        creditLimit: 500000,
      })
      .expect(201);
    expect(res.body.creditLimit).toBe(0);
    expect(res.body.code).toMatch(/^C\d{6}$/);
    const update = await t.put(`/clients/${res.body.id}`, prep, {
      type: 'INDIVIDUAL',
      name: 'Mohamed Ali',
      phone: '98 123 456',
      creditLimit: 100000,
      version: res.body.version,
    });
    expect(update.body.code).toBe('FORBIDDEN');
    await t
      .put(`/clients/${res.body.id}`, admin, {
        type: 'INDIVIDUAL',
        name: 'Mohamed Ali',
        phone: '98 123 456',
        creditLimit: 100000,
        version: res.body.version,
      })
      .expect(200);
    const found = await t.get('/clients/search?q=98 123', prep).expect(200);
    expect(found.body.map((c: { id: string }) => c.id)).toContain(res.body.id);
  });

  it('enregistre la date et l’auteur du consentement e-mail', async () => {
    const res = await t
      .post('/clients/quick', prep, {
        name: 'Clinique Les Oliviers',
        phone: '71 000 000',
        type: 'CLINIC',
        email: 'Compta@Example.com',
        emailConsent: true,
      })
      .expect(201);
    const client = await t.prisma.client.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(client).toMatchObject({
      email: 'compta@example.com',
      emailConsent: true,
      emailConsentById: prep.userId,
    });
  });
});
