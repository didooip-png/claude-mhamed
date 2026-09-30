import {
  addDaysIso,
  addMonthsIso,
  localParts,
  todayIso,
  zonedDateTimeToUtc,
} from '@pharmastock/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { now } from '../src/common/clock.js';
import { JobsService } from '../src/modules/jobs/jobs.service.js';
import { DigestService } from '../src/modules/notifications/digest.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { EmailOutboxService } from '../src/modules/email/outbox.service.js';
import { FakeSmtp } from './fake-smtp.js';
import { TestContext, uniq, type Session } from './helpers.js';

const t = new TestContext();
const smtp = new FakeSmtp();
let admin: Session & { code: string };
let prep: Session & { code: string };
let refs: { categoryId: string; tva7: string; labId: string; supplierId: string };
let notifications: NotificationsService;
let outbox: EmailOutboxService;
let digests: DigestService;
let jobs: JobsService;
const TZ = 'Africa/Tunis';
const today = () => todayIso(TZ);
const PIN = '1234';
const ADMIN_EMAIL = 'admin.notifications@example.com';

beforeAll(async () => {
  await t.start();
  await smtp.start();
  notifications = t.app.get(NotificationsService);
  outbox = t.app.get(EmailOutboxService);
  digests = t.app.get(DigestService);
  jobs = t.app.get(JobsService);
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
      hourlyLimit: 1000,
    })
    .expect(200);
  await t.post('/email/smtp/test-connection', admin).expect(200);
  // Adresse de réception des notifications de l'administrateur.
  await t.put('/notifications/preferences', admin, {
    notificationEmail: ADMIN_EMAIL,
    subscriptions: [],
  });
  await notifications.processPending();
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
  await t.put('/settings', admin, {
    values: {
      'email.auto_send': {
        INVOICE: 'AUTO',
        INVOICE_CANCELLED: 'AUTO',
        CREDIT_NOTE: 'AUTO',
        PAYMENT_RECEIPT: 'AUTO',
        STATEMENT: 'MANUAL',
        DUNNING: 'DISABLED',
        PURCHASE_ORDER: 'MANUAL',
      },
    },
  });
  await smtp.stop();
  await t.stop();
});

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await t.post('/products', admin, {
    name: `Amoxicilline ${uniq()}`,
    dci: 'Amoxicilline',
    dosage: '500 mg',
    form: 'Gélule',
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

async function receive(productId: string, qty: number, expiryDate = addMonthsIso(today(), 12)) {
  const draft = await t
    .post('/receipts', admin, {
      sourceType: 'SUPPLIER',
      supplierId: refs.supplierId,
      receivedAt: today(),
      supplierInvoiceRef: uniq('FACT'),
      lines: [
        {
          productId,
          lotNumber: uniq('L'),
          expiryDate,
          qty,
          freeQty: 0,
          discountBp: 0,
          tvaRateBp: 700,
          unitPriceHt: 1500,
        },
      ],
    })
    .expect(201);
  const res = await t.post(`/receipts/${draft.body.id}/validate`, admin, {
    acknowledgeWarnings: true,
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return t.prisma.lot.findFirstOrThrow({ where: { productId }, orderBy: { createdAt: 'desc' } });
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

async function pollEvents(type: string, entityId?: string) {
  return t.prisma.notificationEvent.findMany({
    where: { eventType: type, ...(entityId ? { entityId } : {}) },
  });
}

describe('Mes notifications', () => {
  it('réservé aux destinataires ; catalogue, modes autorisés, enregistrement et réinitialisation', async () => {
    await t.get('/notifications/preferences', prep).expect(403);
    const prefs = (await t.get('/notifications/preferences', admin).expect(200)).body;
    expect(prefs.notificationEmail).toBe(ADMIN_EMAIL);
    expect(prefs.smtpOperational).toBe(true);
    const cancelled = prefs.events.find(
      (e: { eventType: string }) => e.eventType === 'SALE_CANCELLED',
    );
    expect(cancelled).toMatchObject({
      mode: 'EMAIL_IMMEDIATE',
      isCustom: false,
      employee: true,
      threshold: 'amount',
    });
    const report = prefs.events.find(
      (e: { eventType: string }) => e.eventType === 'ACTIVITY_REPORT',
    );
    expect(report.allowedModes).toEqual(['OFF', 'IN_APP', 'EMAIL_DAILY']);

    // Un rapport n'a pas d'envoi immédiat ; un événement inconnu est refusé.
    const bad = await t.put('/notifications/preferences', admin, {
      notificationEmail: ADMIN_EMAIL,
      subscriptions: [{ eventType: 'ACTIVITY_REPORT', mode: 'EMAIL_IMMEDIATE' }],
    });
    expect(bad.status).toBe(400);
    const unknown = await t.put('/notifications/preferences', admin, {
      notificationEmail: ADMIN_EMAIL,
      subscriptions: [{ eventType: 'N_IMPORTE_QUOI', mode: 'OFF' }],
    });
    expect(unknown.status).toBe(400);

    const saved = await t
      .put('/notifications/preferences', admin, {
        notificationEmail: ADMIN_EMAIL,
        subscriptions: [
          {
            eventType: 'SALE_CANCELLED',
            mode: 'EMAIL_IMMEDIATE',
            watchedUserIds: [prep.userId],
            thresholds: { minAmount: 50_000 },
          },
          {
            eventType: 'CART_LINE_REMOVED',
            mode: 'EMAIL_DAILY',
            schedule: { hour: 21, minute: 30 },
          },
        ],
      })
      .expect(200);
    const after = saved.body.events.find(
      (e: { eventType: string }) => e.eventType === 'SALE_CANCELLED',
    );
    expect(after).toMatchObject({
      isCustom: true,
      watchedUserIds: [prep.userId],
      thresholds: { minAmount: 50_000 },
    });
    const removal = saved.body.events.find(
      (e: { eventType: string }) => e.eventType === 'CART_LINE_REMOVED',
    );
    expect(removal.schedule).toMatchObject({ hour: 21, minute: 30 });
    // Le filtre « employés suivis » n'existe que pour les événements d'employés.
    const stock = await t
      .put('/notifications/preferences', admin, {
        notificationEmail: ADMIN_EMAIL,
        subscriptions: [{ eventType: 'LOTS_EXPIRING', mode: 'OFF', watchedUserIds: [prep.userId] }],
      })
      .expect(200);
    expect(
      stock.body.events.find((e: { eventType: string }) => e.eventType === 'LOTS_EXPIRING')
        .watchedUserIds,
    ).toEqual([]);

    const reset = await t.post('/notifications/preferences/reset', admin).expect(200);
    expect(reset.body.notificationEmail).toBeNull();
    expect(reset.body.events.every((e: { isCustom: boolean }) => !e.isCustom)).toBe(true);
    await t.put('/notifications/preferences', admin, {
      notificationEmail: ADMIN_EMAIL,
      subscriptions: [],
    });
  });

  it('au moins un administrateur reste abonné par e-mail aux alertes critiques', async () => {
    // Tous les autres destinataires ont désactivé l'alerte : le dernier ne peut pas la couper.
    const others = await t.prisma.user.findMany({
      where: { id: { not: admin.userId }, isActive: true, role: { systemKey: 'ADMIN' } },
      select: { id: true },
    });
    for (const u of others) {
      await t.prisma.notificationSubscription.upsert({
        where: { userId_eventType: { userId: u.id, eventType: 'BACKUP_FAILED' } },
        create: { userId: u.id, eventType: 'BACKUP_FAILED', mode: 'OFF' },
        update: { mode: 'OFF' },
      });
    }
    try {
      const refused = await t.put('/notifications/preferences', admin, {
        notificationEmail: ADMIN_EMAIL,
        subscriptions: [{ eventType: 'BACKUP_FAILED', mode: 'OFF' }],
      });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('CRITICAL_ALERTS_REQUIRED');
      expect(refused.body.details.events).toContain('Sauvegarde échouée');
      // Un autre mode e-mail (résumé) reste accepté.
      await t
        .put('/notifications/preferences', admin, {
          notificationEmail: ADMIN_EMAIL,
          subscriptions: [{ eventType: 'BACKUP_FAILED', mode: 'EMAIL_DAILY' }],
        })
        .expect(200);
    } finally {
      await t.prisma.notificationSubscription.deleteMany({
        where: { eventType: 'BACKUP_FAILED' },
      });
      await t.post('/notifications/preferences/reset', admin);
      await t.put('/notifications/preferences', admin, {
        notificationEmail: ADMIN_EMAIL,
        subscriptions: [],
      });
    }
  });
});

describe('Scénario 7 : remise hors plafond, e-mails et rapport d’activité', () => {
  it('le client reçoit sa facture PDF, l’administrateur la notification, le rapport est exact', async () => {
    // L'administrateur suit PRE01 : e-mail immédiat pour les remises hors plafond.
    await t
      .put('/notifications/preferences', admin, {
        notificationEmail: ADMIN_EMAIL,
        subscriptions: [
          {
            eventType: 'DISCOUNT_OVER_LIMIT',
            mode: 'EMAIL_IMMEDIATE',
            watchedUserIds: [prep.userId],
          },
        ],
      })
      .expect(200);
    await notifications.processPending();

    const p = await createProduct();
    await receive(p.id, 10);
    const client = await createClient({
      email: 'cliente.consentante@example.com',
      emailConsent: true,
    });
    const draft = await t.post('/sales', prep, { clientId: client.id }).expect(201);
    const view = (
      await t.post(`/sales/${draft.body.id}/lines`, prep, { productId: p.id, qty: 2 }).expect(201)
    ).body;
    const lineId = view.lines[0].id as string;
    const refused = await t.http
      .patch(`/api/v1/sales/${draft.body.id}/lines/${lineId}`)
      .set(t.auth(prep))
      .send({ discountBp: 2000 });
    expect(refused.body.code).toBe('OVERRIDE_REQUIRED');
    await t.http
      .patch(`/api/v1/sales/${draft.body.id}/lines/${lineId}`)
      .set(t.auth(prep))
      .send({
        discountBp: 2000,
        override: { userCode: admin.code, pin: PIN, reason: 'Geste commercial' },
      })
      .expect(200);
    const detail = (await t.get(`/sales/${draft.body.id}`, prep).expect(200)).body;
    const total = detail.totals.totalTtc as number;
    const validated = await t
      .post(`/sales/${draft.body.id}/validate`, prep, {
        document: 'NONE',
        payments: [{ method: 'CARD', amount: total }],
        sendEmail: true,
      })
      .expect(200);

    const before = smtp.messages.length;
    await notifications.processPending();
    await outbox.processBatch();
    const mails = smtp.messages.slice(before);
    const toClient = mails.find((m) => JSON.stringify(m.to).includes('cliente.consentante'));
    expect(toClient?.attachments[0]?.contentType).toBe('application/pdf');
    expect(toClient?.subject).toContain(validated.body.sale.number);
    const toAdmin = mails.find((m) => JSON.stringify(m.to).includes(ADMIN_EMAIL));
    expect(toAdmin?.subject).toContain('Remise au-delà du plafond');
    expect(toAdmin?.text ?? '').toContain(prep.code);

    // Rapport d'activité de PRE01 pour la journée.
    const report = (
      await t.get(`/notifications/activity-report?date=${today()}`, admin).expect(200)
    ).body;
    const row = report.rows.find((r: { userId: string }) => r.userId === prep.userId);
    expect(row).toBeDefined();
    expect(row.salesCount).toBeGreaterThanOrEqual(1);
    expect(row.discountOverLimit).toBeGreaterThanOrEqual(1);
    expect(row.adminCodesUsed).toBeGreaterThanOrEqual(1);
    expect(row.discountTotal).toBeGreaterThan(0);
    expect(row.firstAt).not.toBeNull();
    await t.get('/notifications/activity-report', prep).expect(403);

    // Envoi du rapport quotidien à l'heure choisie (20 h par défaut) : un seul, jamais deux.
    const at = zonedDateTimeToUtc(today(), '20:30', TZ);
    const beforeDigest = smtp.messages.length;
    await digests.runDue(at);
    await outbox.processBatch();
    const digest = smtp.messages
      .slice(beforeDigest)
      .find((m) => (m.subject ?? '').includes('Rapport d’activité du'));
    expect(digest).toBeDefined();
    expect(JSON.stringify(digest!.to)).toContain(ADMIN_EMAIL);
    expect(digest!.html || '').toContain(prep.code);
    const beforeAgain = smtp.messages.length;
    await digests.runDue(at);
    await outbox.processBatch();
    expect(
      smtp.messages
        .slice(beforeAgain)
        .filter((m) => (m.subject ?? '').includes('Rapport d’activité')),
    ).toHaveLength(0);
  });
});

describe('Résumé quotidien', () => {
  it('regroupe les notifications de la période à l’heure choisie, sans doublon', async () => {
    const local = localParts(new Date(now().getTime() + 3_600_000), TZ);
    await t
      .put('/notifications/preferences', admin, {
        notificationEmail: ADMIN_EMAIL,
        subscriptions: [
          {
            eventType: 'CART_LINE_REMOVED',
            mode: 'EMAIL_DAILY',
            schedule: { hour: local.hour, minute: 0 },
          },
        ],
      })
      .expect(200);
    const p = await createProduct();
    await receive(p.id, 5);
    const client = await createClient();
    const draft = await t.post('/sales', prep, { clientId: client.id }).expect(201);
    const view = (
      await t.post(`/sales/${draft.body.id}/lines`, prep, { productId: p.id, qty: 1 }).expect(201)
    ).body;
    await t.delete(`/sales/${draft.body.id}/lines/${view.lines[0].id}`, prep).expect(200);
    await notifications.processPending();
    expect(
      await t.prisma.notification.count({
        where: { userId: admin.userId, type: 'CART_LINE_REMOVED' },
      }),
    ).toBeGreaterThanOrEqual(1);

    const at = new Date(now().getTime() + 2 * 3_600_000);
    const before = smtp.messages.length;
    await digests.runDue(at);
    await outbox.processBatch();
    const mail = smtp.messages
      .slice(before)
      .find((m) => (m.subject ?? '').includes('Résumé quotidien'));
    expect(mail).toBeDefined();
    expect(mail!.html || '').toContain('Ligne retirée du panier');
    expect(mail!.text || '').toContain(p.name);
    const again = smtp.messages.length;
    await digests.runDue(at);
    await outbox.processBatch();
    expect(
      smtp.messages.slice(again).filter((m) => (m.subject ?? '').includes('Résumé quotidien')),
    ).toHaveLength(0);
    await t.post('/notifications/preferences/reset', admin);
    await t.put('/notifications/preferences', admin, {
      notificationEmail: ADMIN_EMAIL,
      subscriptions: [],
    });
  });
});

describe('Alertes de stock et réapprovisionnement', () => {
  it('rupture et passage sous le seuil signalés une fois par franchissement', async () => {
    const p = await createProduct({ minStock: 3 });
    await receive(p.id, 5);
    const client = await createClient();
    const sell = async (qty: number) => {
      const draft = await t.post('/sales', prep, { clientId: client.id }).expect(201);
      const view = (
        await t.post(`/sales/${draft.body.id}/lines`, prep, { productId: p.id, qty }).expect(201)
      ).body;
      await t
        .post(`/sales/${draft.body.id}/validate`, prep, {
          document: 'NONE',
          payments: [{ method: 'CARD', amount: view.totals.totalTtc }],
        })
        .expect(200);
    };
    await sell(1); // 5 → 4 : au-dessus du seuil
    expect(await pollEvents('STOCK_LOW', p.id)).toHaveLength(0);
    await sell(2); // 4 → 2 : franchit le seuil (3)
    expect(await pollEvents('STOCK_LOW', p.id)).toHaveLength(1);
    await sell(1); // 2 → 1 : déjà sous le seuil, pas de nouvelle alerte
    expect(await pollEvents('STOCK_LOW', p.id)).toHaveLength(1);
    expect(await pollEvents('STOCK_OUT', p.id)).toHaveLength(0);
    await sell(1); // 1 → 0 : rupture
    const out = await pollEvents('STOCK_OUT', p.id);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain(p.name);
  });

  it('suggestions : point de commande, stock maximum, fournisseur habituel', async () => {
    const low = await createProduct({ minStock: 5, maxStock: 20 });
    await receive(low.id, 2);
    const ok = await createProduct({ minStock: 2, maxStock: 10 });
    await receive(ok.id, 8);
    // Un préparateur (qui saisit les réceptions) voit les suggestions, sans les coûts.
    const asPrep = (await t.get('/reorder-suggestions', prep).expect(200)).body;
    expect(
      asPrep.items.find((i: { productId: string }) => i.productId === low.id).estimatedCostHt,
    ).toBeNull();
    const res = (await t.get('/reorder-suggestions', admin).expect(200)).body;
    const s = res.items.find((i: { productId: string }) => i.productId === low.id);
    expect(s).toMatchObject({ sellable: 2, minStock: 5, maxStock: 20, suggestedQty: 18 });
    expect(s.supplier.id).toBe(refs.supplierId);
    expect(s.estimatedCostHt).toBe(18 * 1500);
    expect(res.items.some((i: { productId: string }) => i.productId === ok.id)).toBe(false);
    const filtered = (
      await t.get(`/reorder-suggestions?supplierId=${refs.supplierId}`, admin).expect(200)
    ).body;
    expect(filtered.items.some((i: { productId: string }) => i.productId === low.id)).toBe(true);
    const none = (
      await t
        .get(`/reorder-suggestions?supplierId=00000000-0000-4000-8000-000000000000`, admin)
        .expect(200)
    ).body;
    expect(none.total).toBe(0);
  });
});

describe('Tâches planifiées', () => {
  it('cohérence du stock (RG-22) : divergence détectée sans correction automatique', async () => {
    const p = await createProduct();
    const lot = await receive(p.id, 4);
    const clean = await jobs.stockConsistency();
    expect(
      (clean.sample as { lotId: string }[] | undefined)?.some((x) => x.lotId === lot.id),
    ).toBeFalsy();
    await t.prisma.lot.update({ where: { id: lot.id }, data: { remainingQty: 5 } });
    try {
      const result = await jobs.stockConsistency();
      expect(result.inconsistent as number).toBeGreaterThanOrEqual(1);
      expect((result.sample as { lotId: string }[]).some((x) => x.lotId === lot.id)).toBe(true);
      const audit = await t.prisma.auditLog.findFirst({
        where: { eventType: 'STOCK_INCONSISTENCY' },
        orderBy: { id: 'desc' },
      });
      expect(audit?.severity).toBe('CRITICAL');
      // Aucune correction automatique.
      expect((await t.prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).remainingQty).toBe(
        5,
      );
      expect((await pollEvents('STOCK_INCONSISTENCY')).length).toBeGreaterThanOrEqual(1);
    } finally {
      await t.prisma.lot.update({ where: { id: lot.id }, data: { remainingQty: 4 } });
    }
  });

  it('intégrité du journal (RG-20) et péremptions', async () => {
    const integrity = await jobs.auditIntegrity();
    expect(integrity.ok).toBe(true);
    const p = await createProduct();
    await receive(p.id, 3, addDaysIso(today(), 20));
    const expired = await receive(p.id, 2, addDaysIso(today(), 200));
    await t.prisma.lot.update({
      where: { id: expired.id },
      data: { expiryDate: new Date(`${addDaysIso(today(), -3)}T00:00:00Z`) },
    });
    const before = (await pollEvents('LOTS_EXPIRED')).length;
    const result = await jobs.expiryAlerts(today());
    expect(result.expired as number).toBeGreaterThanOrEqual(1);
    expect(result.expiring as number).toBeGreaterThanOrEqual(1);
    expect((await pollEvents('LOTS_EXPIRED')).length).toBe(before + 1);
    expect((await pollEvents('LOTS_EXPIRING')).length).toBeGreaterThanOrEqual(1);
  });

  it('factures échues : alerte et relances progressives, une seule fois par niveau', async () => {
    await t
      .put('/settings', admin, {
        values: {
          'email.auto_send': {
            INVOICE: 'AUTO',
            INVOICE_CANCELLED: 'AUTO',
            CREDIT_NOTE: 'AUTO',
            PAYMENT_RECEIPT: 'AUTO',
            STATEMENT: 'MANUAL',
            DUNNING: 'AUTO',
            PURCHASE_ORDER: 'MANUAL',
          },
        },
      })
      .expect(200);
    const p = await createProduct();
    await receive(p.id, 5);
    const client = await createClient({ email: 'debitrice@example.com', emailConsent: true });
    const draft = await t.post('/sales', prep, { clientId: client.id }).expect(201);
    await t.post(`/sales/${draft.body.id}/lines`, prep, { productId: p.id, qty: 1 }).expect(201);
    const sale = (
      await t
        .post(`/sales/${draft.body.id}/validate`, prep, {
          document: 'NONE',
          payments: [],
          override: { userCode: admin.code, pin: PIN, reason: 'Vente à crédit autorisée' },
        })
        .expect(200)
    ).body.sale as { id: string; number: string };

    const setDue = (daysAgo: number) =>
      t.prisma.sale.update({
        where: { id: sale.id },
        data: { dueDate: new Date(`${addDaysIso(today(), -daysAgo)}T00:00:00Z`) },
      });
    const dunning = (level: number) =>
      t.prisma.emailOutbox.count({
        where: { kind: `DUNNING_${level}`, relatedEntityId: sale.id },
      });

    await setDue(3); // pas encore au premier palier (7 jours)
    const result = await jobs.overdueInvoices(today());
    expect(result.overdue as number).toBeGreaterThanOrEqual(1);
    expect(await dunning(1)).toBe(0);

    await setDue(8);
    await jobs.overdueInvoices(today());
    expect(await dunning(1)).toBe(1);
    await jobs.overdueInvoices(today());
    expect(await dunning(1)).toBe(1); // pas de doublon

    await setDue(20); // palier 15 jours
    await jobs.overdueInvoices(today());
    expect(await dunning(2)).toBe(1);
    expect(await dunning(1)).toBe(1);

    const before = smtp.messages.length;
    await outbox.processBatch();
    const second = smtp.messages
      .slice(before)
      .find((m) => (m.subject ?? '').includes('Deuxième rappel'));
    expect(second).toBeDefined();
    expect(second!.attachments[0]?.contentType).toBe('application/pdf');
    expect(second!.html || '').toContain(sale.number);

    // Réglée : plus de relance.
    await t.prisma.sale.update({ where: { id: sale.id }, data: { amountDue: 0 } });
    await jobs.overdueInvoices(today());
    expect(await dunning(3)).toBe(0);
  });

  it('exécution planifiée : une fois par période, état visible et lancement manuel réservé', async () => {
    const at = new Date(now().getTime());
    const first = await jobs.runDue(at);
    expect(first.length).toBeGreaterThan(0);
    expect(await jobs.runDue(at)).toEqual([]); // déjà faites pour cette période
    const status = (await t.get('/admin/jobs', admin).expect(200)).body as {
      name: string;
      lastRun: { status: string } | null;
    }[];
    expect(status.map((s) => s.name)).toEqual(
      expect.arrayContaining(['stock-consistency', 'audit-integrity', 'expiry-alerts']),
    );
    expect(status.find((s) => s.name === 'stock-consistency')?.lastRun?.status).toBe('OK');
    await t.get('/admin/jobs', prep).expect(403);
    await t.post('/admin/jobs/stock-consistency/run', prep).expect(403);
    await t.post('/admin/jobs/inconnue/run', admin).expect(404);
    const manual = await t.post('/admin/jobs/stock-consistency/run', admin).expect(200);
    expect(
      manual.body.find((j: { name: string }) => j.name === 'stock-consistency').lastRun.trigger,
    ).toBe('MANUAL');
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'JOB_RUN_MANUALLY' },
      orderBy: { id: 'desc' },
    });
    expect(audit?.userCode).toBe(admin.code);
  });
});
