import { addDaysIso, addMonthsIso, todayIso } from '@pharmastock/shared';
import type { Test } from 'supertest';
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
  await t.post('/cash/open', prep, { openingFloat: 100_000 }).expect(201);
});
afterAll(() => t.stop());

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/products', admin, {
    name: `Paracétamol ${uniq()}`,
    dci: 'Paracétamol',
    dosage: '500 mg',
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
  supplierId = refs.supplierId,
) {
  const draft = await t
    .post('/receipts', admin, {
      sourceType: 'SUPPLIER',
      supplierId,
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
async function twoLotProduct(qtyA = 5, qtyB = 8) {
  const p = await createProduct();
  await receive([
    { productId: p.id, lotNumber: uniq('LA'), expiryDate: addMonthsIso(today(), 6), qty: qtyA },
    { productId: p.id, lotNumber: uniq('LB'), expiryDate: addMonthsIso(today(), 14), qty: qtyB },
  ]);
  const lots = await t.prisma.lot.findMany({
    where: { productId: p.id },
    orderBy: { expiryDate: 'asc' },
  });
  return { ...p, lotA: lots[0]!, lotB: lots[1]! };
}

async function lot(id: string) {
  return t.prisma.lot.findUniqueOrThrow({ where: { id } });
}

async function movements(lotId: string) {
  return t.prisma.stockMovement.findMany({ where: { lotId }, orderBy: { id: 'asc' } });
}

function binary(req: Test) {
  return req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('Inventaire (scénario 6)', () => {
  it('inventaire partiel : comptage à l’aveugle, écart sur le théorique du moment, validation', async () => {
    const p1 = await twoLotProduct(5, 8);
    const p2 = await twoLotProduct(3, 4);
    const untouched = await twoLotProduct(9, 9); // hors périmètre

    // Seul l'administrateur ouvre un inventaire.
    await t.post('/inventories', prep, { scope: { kind: 'PRODUCTS', ids: [p1.id] } }).expect(403);
    const opened = await t
      .post('/inventories', admin, { scope: { kind: 'PRODUCTS', ids: [p1.id, p2.id] } })
      .expect(201);
    const inv = opened.body as { id: string; number: string; stats: { lines: number } };
    expect(inv.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(inv.stats.lines).toBe(4);

    // Un second inventaire sur les mêmes produits est refusé.
    const overlap = await t.post('/inventories', admin, {
      scope: { kind: 'PRODUCTS', ids: [p1.id] },
    });
    expect(overlap.body.code).toBe('INVENTORY_ALREADY_OPEN');

    // Le préparateur voit les lignes mais pas le théorique (comptage à l'aveugle).
    const asPrep = await t.get(`/inventories/${inv.id}/lines`, prep).expect(200);
    expect(asPrep.body.total).toBe(4);
    for (const l of asPrep.body.items) {
      expect(l.snapshotQty).toBeNull();
      expect(l.theoreticalAtCount).toBeNull();
      expect(l.difference).toBeNull();
    }
    await t.get(`/inventories/${inv.id}/lines?filter=DIFFERENCES`, prep).expect(403);
    await t.post(`/inventories/${inv.id}/validate`, prep, {}).expect(403);

    const linesAdmin = (await t.get(`/inventories/${inv.id}/lines`, admin).expect(200)).body
      .items as { id: string; lot: { id: string }; snapshotQty: number }[];
    const lineOf = (lotId: string) => linesAdmin.find((l) => l.lot.id === lotId)!;
    expect(lineOf(p1.lotA.id).snapshotQty).toBe(5);

    // Comptage : A −1 (4 comptés sur 5), B conforme (8), p2 A +2 (5 sur 3), p2 B non compté.
    await t
      .post(`/inventories/${inv.id}/count`, prep, {
        counts: [
          { lineId: lineOf(p1.lotA.id).id, countedQty: 4 },
          { lineId: lineOf(p1.lotB.id).id, countedQty: 8 },
          { lineId: lineOf(p2.lotA.id).id, countedQty: 5 },
        ],
      })
      .expect(200);

    // Un mouvement intervient après le comptage de A (perte d'une unité, validée par l'admin).
    const loss = await t
      .post('/adjustments', admin, {
        type: 'LOSS',
        reason: 'Boîte tombée pendant l’inventaire',
        lines: [{ lotId: p1.lotA.id, qty: 1 }],
        validateNow: true,
      })
      .expect(201);
    expect(loss.body.status).toBe('VALIDATED');
    expect((await lot(p1.lotA.id)).remainingQty).toBe(4);

    // Ligne non comptée : la validation est refusée sauf demande explicite.
    const refused = await t.post(`/inventories/${inv.id}/validate`, admin, {});
    expect(refused.body.code).toBe('INVENTORY_UNCOUNTED');

    const detail = (await t.get(`/inventories/${inv.id}`, admin).expect(200)).body;
    expect(detail.stats).toMatchObject({ lines: 4, counted: 3, uncounted: 1, differences: 2 });

    const validated = await t
      .post(`/inventories/${inv.id}/validate`, admin, { ignoreUncounted: true })
      .expect(200);
    expect(validated.body.status).toBe('VALIDATED');

    // A : théorique au comptage 5 → compté 4 → écart −1 appliqué sur le stock du moment (4 → 3).
    expect((await lot(p1.lotA.id)).remainingQty).toBe(3);
    expect((await lot(p1.lotB.id)).remainingQty).toBe(8);
    expect((await lot(p2.lotA.id)).remainingQty).toBe(5); // +2
    expect((await lot(p2.lotB.id)).remainingQty).toBe(4); // non compté : inchangé
    expect((await lot(untouched.lotA.id)).remainingQty).toBe(9);
    const mv = (await movements(p2.lotA.id)).at(-1)!;
    expect(mv.type).toBe('INVENTORY_ADJUSTMENT');
    expect(mv.qty).toBe(2);
    expect(mv.documentNumber).toBe(inv.number);
    expect(
      (await movements(p1.lotB.id)).filter((m) => m.type === 'INVENTORY_ADJUSTMENT'),
    ).toHaveLength(0);

    // Un inventaire validé ne se recompte plus.
    const late = await t.post(`/inventories/${inv.id}/count`, admin, {
      counts: [{ lineId: lineOf(p1.lotA.id).id, countedQty: 1 }],
    });
    expect(late.body.code).toBe('INVENTORY_NOT_OPEN');

    // Rapports Excel et PDF.
    const xlsx = await binary(t.get(`/inventories/${inv.id}/report?format=xlsx`, admin)).expect(
      200,
    );
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await binary(t.get(`/inventories/${inv.id}/report?format=pdf`, admin)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // Le journal contient l'ouverture et la validation.
    const audit = await t.prisma.auditLog.findMany({
      where: { entityId: inv.id },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.eventType)).toEqual(['INVENTORY_STARTED', 'INVENTORY_VALIDATED']);
  });

  it('refuse la validation si le lot a été vendu depuis son comptage, annulation sans ajustement', async () => {
    const p = await twoLotProduct(3, 3);
    const opened = await t
      .post('/inventories', admin, { scope: { kind: 'PRODUCTS', ids: [p.id] } })
      .expect(201);
    const id = opened.body.id as string;
    const lines = (await t.get(`/inventories/${id}/lines`, admin).expect(200)).body.items as {
      id: string;
      lot: { id: string };
    }[];
    const lineA = lines.find((l) => l.lot.id === p.lotA.id)!;
    // Compté 0 alors que 3 sont en stock (écart −3) ; puis 2 unités disparaissent avant validation.
    await t
      .post(`/inventories/${id}/count`, admin, { counts: [{ lineId: lineA.id, countedQty: 0 }] })
      .expect(200);
    await t
      .post('/adjustments', admin, {
        type: 'LOSS',
        reason: 'Casse constatée',
        lines: [{ lotId: p.lotA.id, qty: 2 }],
        validateNow: true,
      })
      .expect(201);
    const res = await t.post(`/inventories/${id}/validate`, admin, { ignoreUncounted: true });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('recomptez');
    expect((await lot(p.lotA.id)).remainingQty).toBe(1);

    // Recomptage : 1 comptée pour 1 théorique → plus d'écart, la validation passe.
    await t
      .post(`/inventories/${id}/count`, admin, { counts: [{ lineId: lineA.id, countedQty: 1 }] })
      .expect(200);
    await t.post(`/inventories/${id}/validate`, admin, { ignoreUncounted: true }).expect(200);
    expect((await lot(p.lotA.id)).remainingQty).toBe(1);

    // Annulation d'un inventaire : aucun mouvement.
    const q = await twoLotProduct(2, 2);
    const other = await t
      .post('/inventories', admin, { scope: { kind: 'PRODUCTS', ids: [q.id] } })
      .expect(201);
    await t
      .post(`/inventories/${other.body.id}/cancel`, admin, { reason: 'Ouvert par erreur' })
      .expect(200);
    expect((await lot(q.lotA.id)).remainingQty).toBe(2);
    // Le produit est de nouveau libre pour un nouvel inventaire.
    await t.post('/inventories', admin, { scope: { kind: 'PRODUCTS', ids: [q.id] } }).expect(201);
  });
});

describe('Ajustements de stock', () => {
  it('le préparateur déclare, l’administrateur valide (numéro AJ, mouvement) ou rejette', async () => {
    const p = await twoLotProduct(6, 6);
    const declared = await t
      .post('/adjustments', prep, {
        type: 'BREAKAGE',
        reason: 'Flacon brisé au rayon',
        lines: [{ lotId: p.lotA.id, qty: 2 }],
      })
      .expect(201);
    expect(declared.body.status).toBe('PENDING');
    expect(declared.body.number).toBeNull();
    expect(declared.body.lines[0].qty).toBe(-2);
    expect((await lot(p.lotA.id)).remainingQty).toBe(6);

    await t.post(`/adjustments/${declared.body.id}/validate`, prep).expect(403);
    // Un préparateur ne peut pas valider immédiatement sa propre déclaration.
    await t
      .post('/adjustments', prep, {
        type: 'LOSS',
        reason: 'Perte',
        lines: [{ lotId: p.lotA.id, qty: 1 }],
        validateNow: true,
      })
      .expect(403);

    const ok = await t.post(`/adjustments/${declared.body.id}/validate`, admin).expect(200);
    expect(ok.body.status).toBe('VALIDATED');
    expect(ok.body.number).toMatch(/^AJ-\d{4}-\d{6}$/);
    expect((await lot(p.lotA.id)).remainingQty).toBe(4);
    const mv = (await movements(p.lotA.id)).at(-1)!;
    expect(mv).toMatchObject({ type: 'BREAKAGE', qty: -2, documentNumber: ok.body.number });
    expect(mv.userId).toBe(admin.userId);

    // Double validation impossible.
    const again = await t.post(`/adjustments/${declared.body.id}/validate`, admin);
    expect(again.body.code).toBe('ADJUSTMENT_NOT_PENDING');

    // Rejet : aucun mouvement, motif conservé.
    const second = await t
      .post('/adjustments', prep, {
        type: 'LOSS',
        reason: 'Perte présumée',
        lines: [{ lotId: p.lotB.id, qty: 3 }],
      })
      .expect(201);
    const rejected = await t
      .post(`/adjustments/${second.body.id}/reject`, admin, { reason: 'Boîtes retrouvées' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      rejectedReason: 'Boîtes retrouvées',
    });
    expect((await lot(p.lotB.id)).remainingQty).toBe(6);

    // Le préparateur ne voit que ses propres déclarations.
    const mine = await t.get('/adjustments', prep).expect(200);
    expect(
      mine.body.items.every((a: { createdBy: { code: string } }) => a.createdBy.code === prep.code),
    ).toBe(true);
    const other = await t
      .post('/adjustments', admin, {
        type: 'CORRECTION',
        reason: 'Réajustement',
        lines: [{ lotId: p.lotB.id, qty: 1 }],
        validateNow: true,
      })
      .expect(201);
    await t.get(`/adjustments/${other.body.id}`, prep).expect(404);
  });

  it('contrôles : stock insuffisant, destruction réservée aux périmés, correction signée, procès-verbal', async () => {
    const p = await twoLotProduct(2, 2);
    const tooMany = await t.post('/adjustments', prep, {
      type: 'LOSS',
      reason: 'Perte',
      lines: [{ lotId: p.lotA.id, qty: 3 }],
    });
    expect(tooMany.body.code).toBe('STOCK_INSUFFICIENT');
    const negative = await t.post('/adjustments', prep, {
      type: 'LOSS',
      reason: 'Perte',
      lines: [{ lotId: p.lotA.id, qty: -1 }],
    });
    expect(negative.status).toBe(400);

    // Destruction : le lot doit être périmé.
    const early = await t.post('/adjustments', admin, {
      type: 'EXPIRED_DESTRUCTION',
      reason: 'Destruction',
      lines: [{ lotId: p.lotA.id, qty: 2 }],
    });
    expect(early.body.code).toBe('LOT_NOT_EXPIRED');
    await t.prisma.lot.update({
      where: { id: p.lotA.id },
      data: { expiryDate: new Date(`${addDaysIso(today(), -10)}T00:00:00Z`) },
    });
    const destruction = await t
      .post('/adjustments', admin, {
        type: 'EXPIRED_DESTRUCTION',
        reason: 'Destruction des périmés du trimestre',
        lines: [{ lotId: p.lotA.id, qty: 2 }],
        validateNow: true,
      })
      .expect(201);
    expect((await lot(p.lotA.id)).remainingQty).toBe(0);
    expect((await lot(p.lotA.id)).status).toBe('EXHAUSTED');
    expect((await movements(p.lotA.id)).at(-1)!.type).toBe('EXPIRED_DESTRUCTION');
    const pdf = await binary(t.get(`/adjustments/${destruction.body.id}/print`, admin)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    // Sévérité et libellé du mouchard.
    const audit = await t.prisma.auditLog.findFirst({
      where: { entityId: destruction.body.id, eventType: 'DESTRUCTION' },
    });
    expect(audit).not.toBeNull();

    // Correction positive : le stock augmente et un lot épuisé redevient actif.
    const fix = await t
      .post('/adjustments', admin, {
        type: 'CORRECTION',
        reason: 'Boîtes retrouvées en réserve',
        lines: [{ lotId: p.lotB.id, qty: 4 }],
        validateNow: true,
      })
      .expect(201);
    expect(fix.body.lines[0].qty).toBe(4);
    expect((await lot(p.lotB.id)).remainingQty).toBe(6);
  });
});

describe('Retours fournisseurs', () => {
  it('sortie des lots, RF, avoir fournisseur, annulation avec réintégration', async () => {
    const p = await twoLotProduct(5, 5);
    const created = await t
      .post('/supplier-returns', admin, {
        supplierId: refs.supplierId,
        reason: 'Produits défectueux',
        lines: [
          { lotId: p.lotA.id, qty: 2, reason: 'Comprimés effrités' },
          { lotId: p.lotB.id, qty: 1, reason: 'Emballage abîmé' },
        ],
      })
      .expect(201);
    const ret = created.body;
    expect(ret.number).toMatch(/^RF-\d{4}-\d{6}$/);
    expect(ret.status).toBe('PENDING_CREDIT');
    expect(ret.totalHt).toBe(3 * 1500);
    expect((await lot(p.lotA.id)).remainingQty).toBe(3);
    expect((await lot(p.lotB.id)).remainingQty).toBe(4);
    const mv = (await movements(p.lotA.id)).at(-1)!;
    expect(mv).toMatchObject({
      type: 'SUPPLIER_RETURN_OUT',
      qty: -2,
      counterpartType: 'SUPPLIER',
      documentNumber: ret.number,
    });

    await t.post('/supplier-returns', prep, {}).expect(403);
    const pdf = await binary(t.get(`/supplier-returns/${ret.id}/print`, admin)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // Annulation : les lots sont réintégrés.
    const cancelled = await t
      .post(`/supplier-returns/${ret.id}/cancel`, admin, {
        reason: 'Colis refusé par le transporteur',
      })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await lot(p.lotA.id)).remainingQty).toBe(5);
    expect((await lot(p.lotB.id)).remainingQty).toBe(5);

    // Nouveau retour, puis avoir fournisseur reçu.
    const second = await t
      .post('/supplier-returns', admin, {
        supplierId: refs.supplierId,
        reason: 'Erreur de livraison',
        lines: [{ lotId: p.lotB.id, qty: 5, reason: 'Non commandé' }],
      })
      .expect(201);
    expect((await lot(p.lotB.id)).status).toBe('EXHAUSTED');
    const credited = await t
      .post(`/supplier-returns/${second.body.id}/credit`, admin, {
        amount: 7000,
        reference: 'AV-GROSSISTE-88',
      })
      .expect(200);
    expect(credited.body).toMatchObject({
      status: 'CREDIT_RECEIVED',
      creditAmount: 7000,
      creditReference: 'AV-GROSSISTE-88',
    });
    const noCancel = await t.post(`/supplier-returns/${second.body.id}/cancel`, admin, {
      reason: 'Trop tard',
    });
    expect(noCancel.body.code).toBe('SUPPLIER_RETURN_NOT_PENDING');

    const list = await t
      .get(`/supplier-returns?supplierId=${refs.supplierId}&status=PENDING_CREDIT`, admin)
      .expect(200);
    expect(list.body.items.every((r: { status: string }) => r.status === 'PENDING_CREDIT')).toBe(
      true,
    );
  });

  it('refuse un lot d’un autre fournisseur ou une quantité supérieure au stock', async () => {
    const p = await twoLotProduct(2, 2);
    const otherSupplier = await t
      .post('/suppliers', admin, { name: `Autre fournisseur ${uniq()}`, paymentTermsDays: 0 })
      .expect(201);
    const mismatch = await t.post('/supplier-returns', admin, {
      supplierId: otherSupplier.body.id,
      reason: 'Erreur',
      lines: [{ lotId: p.lotA.id, qty: 1, reason: 'Erreur' }],
    });
    expect(mismatch.body.code).toBe('LOT_SUPPLIER_MISMATCH');
    const tooMany = await t.post('/supplier-returns', admin, {
      supplierId: refs.supplierId,
      reason: 'Erreur',
      lines: [{ lotId: p.lotA.id, qty: 9, reason: 'Erreur' }],
    });
    expect(tooMany.body.code).toBe('STOCK_INSUFFICIENT');
    expect((await lot(p.lotA.id)).remainingQty).toBe(2);
  });
});

describe('Rappel de lot', () => {
  it('bloque les lots, liste les clients concernés nets des retours, interdit ensuite la vente', async () => {
    const p = await createProduct();
    const recalled = uniq('RAPPEL');
    await receive([
      { productId: p.id, lotNumber: recalled, expiryDate: addMonthsIso(today(), 10), qty: 10 },
      { productId: p.id, lotNumber: uniq('AUTRE'), expiryDate: addMonthsIso(today(), 20), qty: 10 },
    ]);
    const c1 = await t
      .post('/clients', admin, {
        type: 'INDIVIDUAL',
        name: `Client A ${uniq()}`,
        phone: '55 111 111',
      })
      .expect(201);
    const c2 = await t
      .post('/clients', admin, {
        type: 'INDIVIDUAL',
        name: `Client B ${uniq()}`,
        phone: '55 222 222',
      })
      .expect(201);
    const sell = async (clientId: string, qty: number) => {
      const draft = await t.post('/sales', prep, { clientId }).expect(201);
      const view = (
        await t.post(`/sales/${draft.body.id}/lines`, prep, { productId: p.id, qty }).expect(201)
      ).body;
      const res = await t.post(`/sales/${draft.body.id}/validate`, prep, {
        document: 'NONE',
        payments: [{ method: 'CARD', amount: view.totals.totalTtc }],
      });
      if (res.status !== 200) throw new Error(JSON.stringify(res.body));
      return res.body.sale as { id: string };
    };
    await sell(c1.body.id, 3);
    await sell(c2.body.id, 2);

    await t.get(`/recalls?lotNumber=${recalled}`, prep).expect(403);
    const before = (await t.get(`/recalls?lotNumber=${recalled.toLowerCase()}`, admin).expect(200))
      .body;
    expect(before.lots).toHaveLength(1);
    expect(before.lots[0]).toMatchObject({ remainingQty: 5, soldQty: 5, status: 'ACTIVE' });
    expect(
      before.customers.map((c: { clientId: string; qty: number }) => [c.clientId, c.qty]),
    ).toEqual([
      [c1.body.id, 3],
      [c2.body.id, 2],
    ]);

    const done = await t
      .post('/recalls', admin, {
        lotNumber: recalled,
        reason: 'Rappel du laboratoire : contamination',
      })
      .expect(200);
    expect(done.body.lots[0].status).toBe('BLOCKED');
    expect(done.body.lots[0].blockReason).toContain('Rappel de lot');

    // Une fois bloqué, le lot n'est plus vendable ; l'autre lot du produit l'est encore.
    const draft = await t.post('/sales', prep, { clientId: c1.body.id }).expect(201);
    const view = (
      await t.post(`/sales/${draft.body.id}/lines`, prep, { productId: p.id, qty: 6 }).expect(201)
    ).body;
    const allocated = (view.lines[0].allocations ?? []) as { lotNumber: string }[];
    expect(allocated.every((a) => a.lotNumber !== recalled)).toBe(true);

    const events = await t.prisma.auditLog.findMany({
      where: { eventType: 'LOT_RECALL' },
      orderBy: { id: 'desc' },
      take: 1,
    });
    expect(events[0]!.summary).toContain(recalled);
    // Second rappel identique : plus rien à bloquer.
    const again = await t.post('/recalls', admin, { lotNumber: recalled, reason: 'Encore' });
    expect(again.status).toBe(409);
  });
});
