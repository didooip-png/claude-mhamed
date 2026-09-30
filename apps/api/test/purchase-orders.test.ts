import { addMonthsIso, todayIso } from '@pharmastock/shared';
import type { Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailOutboxService } from '../src/modules/email/outbox.service.js';
import { FakeSmtp } from './fake-smtp.js';
import { TestContext, uniq, type Session } from './helpers.js';

const t = new TestContext();
const smtp = new FakeSmtp();
let admin: Session & { code: string };
let prep: Session & { code: string };
let refs: { categoryId: string; tva7: string; labId: string };
let supplier: { id: string; name: string };
let outbox: EmailOutboxService;
const today = () => todayIso('Africa/Tunis');

beforeAll(async () => {
  await t.start();
  await smtp.start();
  outbox = t.app.get(EmailOutboxService);
  admin = await t.as('ADMIN');
  prep = await t.as('PREPARER');
  const category = await t
    .post('/catalog/categories', admin, { name: `Médicaments ${uniq()}`, kind: 'MEDICINE' })
    .expect(201);
  const lab = await t.post('/catalog/laboratories', admin, { name: `Labo ${uniq()}` }).expect(201);
  const tva = await t
    .post('/catalog/tva-rates', admin, { label: `TVA 7 % ${uniq()}`, rateBp: 700 })
    .expect(201);
  refs = { categoryId: category.body.id, tva7: tva.body.id, labId: lab.body.id };
  const sup = await t
    .post('/suppliers', admin, {
      name: `Grossiste ${uniq()}`,
      email: 'commandes@example.com',
      paymentTermsDays: 30,
    })
    .expect(201);
  supplier = { id: sup.body.id, name: sup.body.name };
  await t
    .put('/email/smtp', admin, {
      enabled: true,
      host: '127.0.0.1',
      port: smtp.port,
      security: 'NONE',
      username: '',
      fromName: 'Pharmacie Test',
      fromEmail: 'commandes@pharmacie.example.com',
      replyTo: '',
      bccArchive: '',
      hourlyLimit: 1000,
    })
    .expect(200);
  await t.post('/email/smtp/test-connection', admin).expect(200);
});

afterAll(async () => {
  // Les fichiers de test partagent la base : SMTP inactif pour les suivants.
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
  await t.stop();
});

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/products', admin, {
    name: `Produit ${uniq()}`,
    dci: 'Test',
    dosage: '10 mg',
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

function receiptBody(
  lines: { productId: string; qty: number }[],
  extra: Record<string, unknown> = {},
) {
  return {
    sourceType: 'SUPPLIER',
    supplierId: supplier.id,
    receivedAt: today(),
    supplierInvoiceRef: uniq('FACT'),
    lines: lines.map((l) => ({
      lotNumber: uniq('L'),
      expiryDate: addMonthsIso(today(), 12),
      freeQty: 0,
      discountBp: 0,
      tvaRateBp: 700,
      unitPriceHt: 1500,
      ...l,
    })),
    ...extra,
  };
}

async function receive(
  lines: { productId: string; qty: number }[],
  extra: Record<string, unknown> = {},
) {
  const draft = await t.post('/receipts', admin, receiptBody(lines, extra)).expect(201);
  const res = await t.post(`/receipts/${draft.body.id}/validate`, admin, {
    acknowledgeWarnings: true,
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return draft.body.id as string;
}

async function order(id: string) {
  return (await t.get(`/purchase-orders/${id}`, admin).expect(200)).body;
}

function binary(req: Test) {
  return req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('Commandes fournisseurs', () => {
  it('brouillon : droits, totaux, doublons refusés, modification avec contrôle de version', async () => {
    const p1 = await createProduct();
    const p2 = await createProduct();
    const body = {
      supplierId: supplier.id,
      expectedDate: addMonthsIso(today(), 1),
      notes: 'Livraison le matin',
      lines: [
        { productId: p1.id, qty: 10 },
        { productId: p2.id, qty: 4, unitPriceHt: 2000 },
      ],
    };
    await t.post('/purchase-orders', prep, body).expect(403);
    await t.get('/purchase-orders', prep).expect(200); // la consultation reste ouverte à la réception
    const dup = await t.post('/purchase-orders', admin, {
      ...body,
      lines: [body.lines[0], body.lines[0]],
    });
    expect(dup.status).toBe(400);

    const created = await t.post('/purchase-orders', admin, body).expect(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.number).toBeNull();
    // Prix par défaut = prix de référence du produit ; total = 10 × 1 500 + 4 × 2 000.
    expect(created.body.lines.map((l: { unitPriceHt: number }) => l.unitPriceHt)).toEqual([
      1500, 2000,
    ]);
    expect(created.body.totalHt).toBe(23_000);

    const updated = await t
      .put(`/purchase-orders/${created.body.id}`, admin, {
        ...body,
        lines: [{ productId: p1.id, qty: 12 }],
        version: created.body.version,
      })
      .expect(200);
    expect(updated.body.totalHt).toBe(18_000);
    const stale = await t.put(`/purchase-orders/${created.body.id}`, admin, {
      ...body,
      version: created.body.version,
    });
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('suggestions de réapprovisionnement → brouillon prérempli', async () => {
    const low = await createProduct({ minStock: 5, maxStock: 20 });
    const fine = await createProduct({ minStock: 2, maxStock: 10 });
    await receive([
      { productId: low.id, qty: 2 },
      { productId: fine.id, qty: 8 },
    ]);
    const draft = await t
      .post('/purchase-orders/from-suggestions', admin, {
        supplierId: supplier.id,
        productIds: [low.id, fine.id],
      })
      .expect(201);
    expect(draft.body.lines).toHaveLength(1);
    expect(draft.body.lines[0]).toMatchObject({ qty: 18, unitPriceHt: 1500 });
    expect(draft.body.lines[0].product.id).toBe(low.id);
    const none = await t.post('/purchase-orders/from-suggestions', admin, {
      supplierId: supplier.id,
      productIds: [fine.id],
    });
    expect(none.status).toBe(409);
  });

  it('envoi : numéro BC, e-mail avec PDF, puis réceptions rattachées avec contrôle des quantités', async () => {
    const p1 = await createProduct();
    const p2 = await createProduct();
    const outsider = await createProduct();
    const created = await t
      .post('/purchase-orders', admin, {
        supplierId: supplier.id,
        lines: [
          { productId: p1.id, qty: 10 },
          { productId: p2.id, qty: 5 },
        ],
      })
      .expect(201);
    const id = created.body.id as string;

    // Une réception ne peut pas se rattacher à un brouillon.
    const early = await t.post(
      '/receipts',
      admin,
      receiptBody([{ productId: p1.id, qty: 1 }], { purchaseOrderId: id }),
    );
    expect(early.body.code).toBe('ORDER_NOT_RECEIVABLE');

    const before = smtp.messages.length;
    const sent = await t
      .post(`/purchase-orders/${id}/send`, admin, {
        to: ['commandes@example.com'],
        message: 'Merci de livrer vendredi.',
      })
      .expect(200);
    expect(sent.body.status).toBe('SENT');
    expect(sent.body.number).toMatch(/^BC-\d{4}-\d{6}$/);
    await t.post(`/purchase-orders/${id}/send`, admin, { to: [] }).expect(422); // plus un brouillon
    await outbox.processBatch();
    const mail = smtp.messages
      .slice(before)
      .find((m) => (m.subject ?? '').includes(sent.body.number));
    expect(mail).toBeDefined();
    expect(mail!.attachments[0]?.contentType).toBe('application/pdf');
    expect(mail!.attachments[0]?.filename).toBe(`${sent.body.number}.pdf`);
    expect(mail!.text ?? '').toContain('Merci de livrer vendredi.');
    const pdf = await binary(t.get(`/purchase-orders/${id}/print`, prep)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // Première réception : 6 sur 10 du produit 1 → partiellement reçue.
    const otherSupplier = await t
      .post('/suppliers', admin, { name: `Autre ${uniq()}`, paymentTermsDays: 0 })
      .expect(201);
    const wrong = await t.post(
      '/receipts',
      admin,
      receiptBody([{ productId: p1.id, qty: 1 }], {
        purchaseOrderId: id,
        supplierId: otherSupplier.body.id,
      }),
    );
    expect(wrong.status).toBe(400);

    const r1 = await receive([{ productId: p1.id, qty: 6 }], { purchaseOrderId: id });
    let o = await order(id);
    expect(o.status).toBe('PARTIALLY_RECEIVED');
    expect(o.lines.find((l: { product: { id: string } }) => l.product.id === p1.id)).toMatchObject({
      receivedQty: 6,
      remainingQty: 4,
    });
    expect(o.receipts).toHaveLength(1);

    // Réception excédentaire et produit non commandé : avertissements à confirmer.
    const draft = await t
      .post(
        '/receipts',
        admin,
        receiptBody(
          [
            { productId: p1.id, qty: 7 },
            { productId: outsider.id, qty: 1 },
          ],
          { purchaseOrderId: id },
        ),
      )
      .expect(201);
    const detail = await t.get(`/receipts/${draft.body.id}`, admin).expect(200);
    expect(detail.body.warnings.map((w: { kind: string }) => w.kind).sort()).toEqual([
      'NOT_ORDERED',
      'ORDER_OVERRUN',
    ]);
    const refused = await t.post(`/receipts/${draft.body.id}/validate`, admin, {
      acknowledgeWarnings: false,
    });
    expect(refused.body.code).toBe('CONFLICT');
    expect(refused.body.details.warnings).toHaveLength(2);
    await t.delete(`/receipts/${draft.body.id}`, admin).expect(204);

    // Reliquat exact du produit 1 puis du produit 2 : commande reçue.
    await receive([{ productId: p1.id, qty: 4 }], { purchaseOrderId: id });
    o = await order(id);
    expect(o.status).toBe('PARTIALLY_RECEIVED');
    const r3 = await receive([{ productId: p2.id, qty: 5 }], { purchaseOrderId: id });
    o = await order(id);
    expect(o.status).toBe('RECEIVED');
    expect(o.receipts).toHaveLength(3);

    // Annuler la dernière réception rouvre la commande.
    await t.post(`/receipts/${r3}/cancel`, admin, { reason: 'Colis refusé' }).expect(200);
    o = await order(id);
    expect(o.status).toBe('PARTIALLY_RECEIVED');
    expect(
      o.lines.find((l: { product: { id: string } }) => l.product.id === p2.id).receivedQty,
    ).toBe(0);
    void r1;

    // Clôture : le reliquat ne sera pas livré ; plus de réception possible.
    const closed = await t.post(`/purchase-orders/${id}/close`, admin).expect(200);
    expect(closed.body.status).toBe('RECEIVED');
    const late = await t.post(
      '/receipts',
      admin,
      receiptBody([{ productId: p2.id, qty: 1 }], { purchaseOrderId: id }),
    );
    expect(late.body.code).toBe('ORDER_NOT_RECEIVABLE');
    // Une commande avec réceptions ne s'annule pas.
    const audit = await t.prisma.auditLog.findFirst({
      where: { entityId: id, eventType: 'PURCHASE_ORDER_CLOSED' },
    });
    expect(audit?.summary).toContain('non livrée');
  });

  it('annulation, renvoi par e-mail et clôture réservés aux commandes valides', async () => {
    const p = await createProduct();
    const created = await t
      .post('/purchase-orders', admin, {
        supplierId: supplier.id,
        lines: [{ productId: p.id, qty: 3 }],
      })
      .expect(201);
    const id = created.body.id as string;
    // Brouillon : annulation possible (traçable), jamais supprimé.
    await t.post(`/purchase-orders/${id}/cancel`, prep, { reason: 'Test' }).expect(403);
    const cancelled = await t
      .post(`/purchase-orders/${id}/cancel`, admin, { reason: 'Commande en double' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancelReason).toBe('Commande en double');
    await t.post(`/purchase-orders/${id}/send`, admin, { to: [] }).expect(422);
    await t.post(`/purchase-orders/${id}/close`, admin).expect(422);

    // Envoyée sans e-mail (commande téléphonée), puis renvoyée par e-mail.
    const second = await t
      .post('/purchase-orders', admin, {
        supplierId: supplier.id,
        lines: [{ productId: p.id, qty: 2 }],
      })
      .expect(201);
    const sent = await t
      .post(`/purchase-orders/${second.body.id}/send`, admin, { to: [] })
      .expect(200);
    expect(sent.body.status).toBe('SENT');
    const before = smtp.messages.length;
    await t
      .post(`/purchase-orders/${second.body.id}/email`, admin, { to: ['commandes@example.com'] })
      .expect(200);
    await outbox.processBatch();
    expect(smtp.messages.length).toBeGreaterThan(before);
    const list = await t
      .get(`/purchase-orders?open=1&supplierId=${supplier.id}`, admin)
      .expect(200);
    expect(list.body.items.some((o: { id: string }) => o.id === second.body.id)).toBe(true);
    expect(
      list.body.items.every((o: { status: string }) =>
        ['SENT', 'PARTIALLY_RECEIVED'].includes(o.status),
      ),
    ).toBe(true);

    // Avec une réception validée, l'annulation est refusée.
    await receive([{ productId: p.id, qty: 1 }], { purchaseOrderId: second.body.id });
    const refused = await t.post(`/purchase-orders/${second.body.id}/cancel`, admin, {
      reason: 'Trop tard',
    });
    expect(refused.status).toBe(409);
  });
});
