import type { INestApplicationContext } from '@nestjs/common';
import {
  addDaysIso,
  addMonthsIso,
  ALL_PERMISSIONS,
  PREPARER_DEFAULT_PERMISSIONS,
  todayIso,
  zonedDateTimeToUtc,
} from '@pharmastock/shared';
import { setSeedClock } from '../../src/common/clock.js';
import { randomToken, sha256Hex } from '../../src/common/crypto.js';
import type { Actor } from '../../src/common/request-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { ProductsService } from '../../src/modules/catalog/products.service.js';
import { ReferencesService } from '../../src/modules/catalog/references.service.js';
import { ClientsService } from '../../src/modules/clients/clients.service.js';
import { SitesService } from '../../src/modules/devices/sites.service.js';
import { ReceiptsService } from '../../src/modules/receipts/receipts.service.js';
import { SetupService } from '../../src/modules/setup/setup.service.js';
import { SuppliersService } from '../../src/modules/suppliers/suppliers.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  CATEGORIES,
  LABS,
  PRODUCTS,
  rng,
  seedClients,
  SUPPLIERS,
  THERAPEUTIC_CLASSES,
} from './data.js';
import { runDailyActivity, type SeedContext } from './history.js';

export const DEMO_USERS = [
  {
    code: 'ADM01',
    username: 'admin',
    fullName: 'Amel Ben Salah',
    password: 'Admin2026',
    pin: '1234',
    role: 'ADMIN' as const,
  },
  {
    code: 'PRE01',
    username: 'pre01',
    fullName: 'Karim Trabelsi',
    password: 'Prep2026',
    pin: '1111',
    role: 'PREPARER' as const,
  },
  {
    code: 'PRE02',
    username: 'pre02',
    fullName: 'Sonia Gharbi',
    password: 'Prep2026',
    pin: '2222',
    role: 'PREPARER' as const,
  },
];

/** Nombre de jours d'historique simulé (§16 : 3 mois). */
export const HISTORY_DAYS = 92;
const TZ = 'Africa/Tunis';

export async function seedDemo(app: INestApplicationContext): Promise<void> {
  const prisma = app.get(PrismaService);
  const setup = app.get(SetupService);
  if (await setup.hasAdmin()) {
    console.log('Données déjà présentes : seed ignoré (réinitialisez la base pour recommencer).');
    return;
  }
  const random = rng();
  const today = todayIso(TZ);
  const start = addDaysIso(today, -HISTORY_DAYS);
  const at = (day: string, hour: number, minute = 0) =>
    zonedDateTimeToUtc(
      day,
      `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
      TZ,
    );
  setSeedClock(at(start, 7, 30));

  // --- Utilisateurs et postes -------------------------------------------------
  const [admin, ...others] = DEMO_USERS;
  await setup.createFirstAdmin({
    ...admin!,
    establishmentName: 'Pharmacie Ennasr (démonstration)',
    mustChangePassword: false,
  });
  const passwords = app.get(PasswordService);
  const preparerRole = await prisma.role.findUniqueOrThrow({ where: { systemKey: 'PREPARER' } });
  for (const u of others) {
    await prisma.user.create({
      data: {
        code: u.code,
        username: u.username,
        fullName: u.fullName,
        roleId: preparerRole.id,
        passwordHash: await passwords.hash(u.password),
        pinHash: await passwords.hash(u.pin),
        mustChangePassword: false,
        email: `${u.username}@example.com`,
      },
    });
  }
  await prisma.user.update({
    where: { code: 'ADM01' },
    data: { email: 'admin@example.com', notificationEmail: 'admin@example.com' },
  });
  const site = await app.get(SitesService).defaultSite();
  const devices: Record<string, { id: string; name: string }> = {};
  for (const name of ['Comptoir 1', 'Comptoir 2', 'Réserve']) {
    devices[name] = await prisma.device.create({
      data: {
        name,
        tokenHash: sha256Hex(randomToken()),
        status: 'APPROVED',
        siteId: site.id,
        approvedAt: at(start, 7, 30),
      },
    });
  }
  const users = await prisma.user.findMany();
  const actorOf = (code: string, deviceName: string): Actor => {
    const u = users.find((x) => x.code === code)!;
    return {
      userId: u.id,
      userCode: u.code,
      userName: u.fullName,
      permissions: new Set(code.startsWith('ADM') ? ALL_PERMISSIONS : PREPARER_DEFAULT_PERMISSIONS),
      isAdmin: code.startsWith('ADM'),
      deviceId: devices[deviceName]!.id,
      deviceName,
      siteId: site.id,
      ip: '192.168.1.10',
    };
  };
  const actors = {
    admin: actorOf('ADM01', 'Comptoir 1'),
    admin2: actorOf('ADM01', 'Comptoir 2'),
    adminReserve: actorOf('ADM01', 'Réserve'),
    pre1: actorOf('PRE01', 'Comptoir 1'),
    pre2: actorOf('PRE02', 'Comptoir 2'),
    pre1Reserve: actorOf('PRE01', 'Réserve'),
  };

  // --- Référentiels et catalogue -----------------------------------------------
  const refs = app.get(ReferencesService);
  const categoryIds: string[] = [];
  for (const c of CATEGORIES)
    categoryIds.push((await refs.saveCategory(null, { ...c, isActive: true }, actors.admin)).id);
  const labIds: string[] = [];
  for (const name of LABS)
    labIds.push(
      (await refs.saveLaboratory(null, { name, country: 'Tunisie', isActive: true }, actors.admin))
        .id,
    );
  const classIds: string[] = [];
  for (const name of THERAPEUTIC_CLASSES)
    classIds.push((await refs.saveTherapeuticClass(null, { name }, actors.admin)).id);
  const tvaRates = await prisma.tvaRate.findMany();
  const tvaId = (bp: number) => tvaRates.find((t) => t.rateBp === bp)!.id;

  const productsService = app.get(ProductsService);
  const products: SeedContext['products'] = [];
  for (const [i, p] of PRODUCTS.entries()) {
    const purchaseHt =
      Math.round(((p.price / (1 + p.tva / 10_000)) * (0.68 + random.next() * 0.1)) / 10) * 10;
    const created = await productsService.create(
      {
        internalCode: undefined,
        name: p.name,
        dci: p.dci,
        dosage: p.dosage === '—' ? null : p.dosage,
        form: p.form,
        presentation: p.presentation,
        laboratoryId: labIds[i % labIds.length]!,
        categoryId: categoryIds[p.category]!,
        therapeuticClassId: p.therapeuticClass !== undefined ? classIds[p.therapeuticClass]! : null,
        tvaRateId: tvaId(p.tva),
        refPurchasePriceHt: purchaseHt,
        salePriceTtc: p.price,
        unitsPerPack: p.unitsPerPack ?? 1,
        sellByUnit: p.sellByUnit ?? false,
        unitSalePriceTtc: p.sellByUnit
          ? Math.round(p.price / (p.unitsPerPack ?? 1) / 10) * 10 + 20
          : null,
        requiresPrescription: p.prescription ?? false,
        controlledClass: p.controlled ?? 'NONE',
        coldChain: p.coldChain ?? false,
        returnable: p.returnable ?? true,
        location: `${String.fromCharCode(65 + (p.category % 6))}${1 + (i % 5)}-${1 + (i % 4)}`,
        minStock: p.minStock * (p.sellByUnit ? (p.unitsPerPack ?? 1) : 1),
        maxStock: p.minStock * 6 * (p.sellByUnit ? (p.unitsPerPack ?? 1) : 1),
        reorderPoint: p.minStock * 2 * (p.sellByUnit ? (p.unitsPerPack ?? 1) : 1),
        barcodes: [`619${String(1_000_000_000 + i * 7_919).slice(0, 9)}${i % 10}`],
        isActive: true,
      },
      actors.admin,
    );
    products.push({
      id: created.id,
      seed: p,
      purchaseHt,
      tvaBp: p.tva,
      unitsPerPack: p.unitsPerPack ?? 1,
      sellByUnit: p.sellByUnit ?? false,
      salePrice: p.price,
    });
  }

  // --- Fournisseurs et clients ------------------------------------------------------
  const suppliersService = app.get(SuppliersService);
  const supplierIds: string[] = [];
  for (const s of SUPPLIERS) {
    supplierIds.push(
      (
        await suppliersService.create(
          {
            ...s,
            code: undefined,
            isActive: true,
            contactName: 'Service commercial',
            address: 'Zone industrielle, Tunis',
            notes: null,
            taxId: s.taxId,
          },
          actors.admin,
        )
      ).id,
    );
  }
  const clientsService = app.get(ClientsService);
  const clientIds: string[] = [];
  const clientsData = seedClients();
  for (const c of clientsData) {
    const created = await clientsService.create(
      {
        type: c.type,
        name: c.name,
        phone: c.phone,
        phone2: null,
        email: c.email,
        address: c.type === 'INDIVIDUAL' ? 'Ennasr, Ariana' : 'Tunis',
        creditLimit: c.creditLimit,
        defaultDiscountBp: c.discountBp,
        paymentTermsDays: c.paymentTermsDays,
        isActive: true,
        notes: null,
        emailConsent: c.consent,
        emailCc: [],
        nationalIdOrTaxId: c.nationalIdOrTaxId,
      },
      actors.admin,
    );
    clientIds.push(created.id);
  }

  const ctx: SeedContext = {
    app,
    prisma,
    random,
    at,
    start,
    today,
    actors,
    products,
    supplierIds,
    clientIds,
    clientsData,
    receipts: app.get(ReceiptsService),
  };

  // --- Stock initial : un bon de réception par fournisseur -----------------------
  await initialStock(ctx);

  // --- Historique jour par jour (réceptions, et opérations des phases suivantes) --
  for (let d = 1; d <= HISTORY_DAYS; d += 1) {
    await runDailyActivity(ctx, addDaysIso(start, d), d === HISTORY_DAYS);
  }
  setSeedClock(null);
  // L'historique ancien ne doit pas générer de notifications : seules celles du dernier jour restent à traiter.
  await prisma.$executeRaw`UPDATE notification_events SET processed_at = created_at WHERE created_at < now() - interval '1 day' AND processed_at IS NULL`;
  console.log(`Historique de ventes : ${ctx.sales?.summary ?? 'aucune vente'}.`);
  console.log(
    `Démonstration prête : ${products.length} produits, ${supplierIds.length} fournisseurs, ${clientIds.length} clients, ${HISTORY_DAYS} jours d’historique.`,
  );
  console.log(
    'Comptes : ADM01 (admin / Admin2026, PIN 1234) · PRE01 (pre01 / Prep2026, PIN 1111) · PRE02 (pre02 / Prep2026, PIN 2222)',
  );
}

/** Choisit le fournisseur habituel d'un produit selon sa catégorie. */
export function supplierFor(ctx: SeedContext, product: SeedContext['products'][number]): string {
  const cat = CATEGORIES[product.seed.category]!;
  if (cat.kind === 'PARAPHARMACY') return ctx.supplierIds[3]!;
  if (cat.kind === 'MEDICAL_DEVICE') return ctx.supplierIds[4]!;
  return ctx.supplierIds[product.seed.popularity % 3]!;
}

/** Péremption variée : quelques lots déjà périmés aujourd'hui, d'autres à moins de 30 / 60 / 90 jours. */
function initialExpiry(ctx: SeedContext): string {
  const r = ctx.random.next();
  if (r < 0.06) return addDaysIso(ctx.today, -ctx.random.int(3, 40));
  if (r < 0.14) return addDaysIso(ctx.today, ctx.random.int(5, 29));
  if (r < 0.22) return addDaysIso(ctx.today, ctx.random.int(31, 59));
  if (r < 0.3) return addDaysIso(ctx.today, ctx.random.int(61, 89));
  return addMonthsIso(ctx.today, ctx.random.int(6, 30));
}

async function initialStock(ctx: SeedContext): Promise<void> {
  const bySupplier = new Map<
    string,
    {
      productId: string;
      lotNumber: string;
      expiryDate: string;
      qty: number;
      freeQty: number;
      unitPriceHt: number;
      discountBp: number;
      tvaRateBp: number;
    }[]
  >();
  for (const p of ctx.products) {
    const lots = p.seed.popularity >= 6 ? 2 : 1;
    for (let i = 0; i < lots; i += 1) {
      const qty = Math.max(
        3,
        Math.round(p.seed.popularity * ctx.random.int(4, 9) * (i === 0 ? 1 : 0.6)),
      );
      const supplierId = supplierFor(ctx, p);
      const list = bySupplier.get(supplierId) ?? [];
      list.push({
        productId: p.id,
        lotNumber: `${p.seed.dci.slice(0, 3).toUpperCase()}${ctx.random.int(10000, 99999)}`,
        expiryDate: initialExpiry(ctx),
        qty,
        freeQty: qty >= 40 && ctx.random.chance(0.3) ? Math.round(qty / 10) : 0,
        unitPriceHt: p.purchaseHt,
        discountBp: ctx.random.chance(0.2) ? 300 : 0,
        tvaRateBp: p.tvaBp,
      });
      bySupplier.set(supplierId, list);
    }
  }
  let hour = 8;
  for (const [supplierId, lines] of bySupplier) {
    // La validation refuse une péremption déjà passée : le stock initial est reçu au début de l'historique.
    setSeedClock(ctx.at(ctx.start, hour, 15));
    const draft = await ctx.receipts.createDraft(
      {
        sourceType: 'SUPPLIER',
        supplierId,
        supplierInvoiceRef: `FV-${ctx.random.int(10000, 99999)}`,
        supplierInvoiceDate: ctx.start,
        receivedAt: ctx.start,
        notes: 'Stock initial',
        lines,
        sourceReason: null,
        attachmentId: null,
      },
      ctx.actors.adminReserve,
    );
    setSeedClock(ctx.at(ctx.start, hour, 45));
    await ctx.receipts.validate(
      draft.id,
      { acknowledgeWarnings: true, updateReferencePrices: false },
      ctx.actors.adminReserve,
    );
    hour += 1;
  }
}
