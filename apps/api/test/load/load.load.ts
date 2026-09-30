import { mkdirSync, writeFileSync } from 'node:fs';
import { addMonthsIso, todayIso } from '@pharmastock/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../../src/modules/jobs/jobs.service.js';
import { TestContext, uniq, type Session, type TestDevice } from '../helpers.js';

/**
 * Tenue en charge (cahier des charges §« Performances ») : 50 000 produits, ~1 million de
 * mouvements, 10 postes simultanés. Les mesures incluent la pile HTTP complète (garde,
 * validation, sérialisation) mais pas le réseau. Volumes réglables :
 *   LOAD_PRODUCTS (50000)  LOAD_MOVEMENTS (1000000)
 */
const PRODUCTS = Number(process.env.LOAD_PRODUCTS ?? 50_000);
const MOVEMENTS = Number(process.env.LOAD_MOVEMENTS ?? 1_000_000);
const CLIENTS = 10;

const t = new TestContext();
let admin: Session & { code: string };
let hot: { id: string; name: string }[] = [];
const report: string[] = [];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

/** Exécute `fn` n fois, retourne les percentiles en ms et journalise la mesure. */
async function measure(label: string, n: number, fn: (i: number) => Promise<void>) {
  const times: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const start = performance.now();
    await fn(i);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const stat = { p50: percentile(times, 50), p95: percentile(times, 95), max: times.at(-1)! };
  report.push(
    `${label.padEnd(58)} p50 ${stat.p50.toFixed(0).padStart(5)} ms   p95 ${stat.p95.toFixed(0).padStart(5)} ms   max ${stat.max.toFixed(0).padStart(5)} ms   (n=${n})`,
  );
  return stat;
}

beforeAll(async () => {
  await t.start();
  t.app.getHttpServer().setMaxListeners(0);
  admin = await t.as('ADMIN');
  const category = await t
    .post('/catalog/categories', admin, { name: `Médicaments ${uniq()}`, kind: 'MEDICINE' })
    .expect(201);
  const tva = await t
    .post('/catalog/tva-rates', admin, { label: `TVA 7 % ${uniq()}`, rateBp: 700 })
    .expect(201);
  const site = await t.prisma.site.findFirstOrThrow();
  const started = performance.now();
  const existing =
    process.env.LOAD_REUSE === '1'
      ? Number(
          (await t.prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) c FROM products`))[0]!
            .c,
        )
      : 0;

  // Génération en SQL (générateurs de séries) : plusieurs millions de lignes en quelques dizaines de secondes.
  if (existing < PRODUCTS) {
    await t.prisma.$executeRawUnsafe(`
      CREATE TABLE load_names AS
      SELECT * FROM unnest(
        ARRAY['Amoxicilline','Paracetamol','Ibuprofene','Omeprazole','Metformine','Atorvastatine','Amlodipine','Ramipril',
              'Levothyroxine','Salbutamol','Cetirizine','Diclofenac','Azithromycine','Ciprofloxacine','Pantoprazole','Losartan',
              'Bisoprolol','Furosemide','Clopidogrel','Insuline','Loratadine','Ranitidine','Doliprane','Efferalgan','Augmentin'],
        ARRAY['Amoxicilline','Paracetamol','Ibuprofene','Omeprazole','Metformine','Atorvastatine','Amlodipine','Ramipril',
              'Levothyroxine','Salbutamol','Cetirizine','Diclofenac','Azithromycine','Ciprofloxacine','Pantoprazole','Losartan',
              'Bisoprolol','Furosemide','Clopidogrel','Insuline','Loratadine','Ranitidine','Paracetamol','Paracetamol','Amoxicilline']
      ) AS n(name, dci)`);
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO products (id, internal_code, name, dci, dosage, form, category_id, tva_rate_id,
                            ref_purchase_price_ht, sale_price_ttc, min_stock, search_text, created_at, updated_at)
      SELECT gen_random_uuid(), 'PRD' || lpad(g::text, 6, '0'),
             n.name || ' ' || d.dosage || ' ' || f.form || ' ' || 'Lab' || (g % 300),
             n.dci, d.dosage, f.form, '${category.body.id}', '${tva.body.id}',
             1000 + (g % 90) * 100, 2000 + (g % 90) * 130, (g % 20),
             lower(n.name || ' ' || n.dci || ' ' || d.dosage || ' ' || f.form || ' lab' || (g % 300) || ' prd' || lpad(g::text, 6, '0')),
             now(), now()
      FROM generate_series(1, ${PRODUCTS}) g
      JOIN LATERAL (SELECT * FROM load_names OFFSET (g % 25) LIMIT 1) n ON true
      JOIN LATERAL (SELECT (ARRAY['500 mg','1 g','250 mg','10 mg','20 mg','5 mg','100 mg','40 mg'])[1 + g % 8] AS dosage) d ON true
      JOIN LATERAL (SELECT (ARRAY['comprime','gelule','sirop','sachet','injectable','creme'])[1 + g % 6] AS form) f ON true`);
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO product_barcodes (id, product_id, barcode, is_primary)
      SELECT gen_random_uuid(), p.id, '619' || lpad(row_number() OVER (ORDER BY p.internal_code)::text, 10, '0'), true
      FROM products p`);
    // Un lot par produit, un second pour un produit sur deux.
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO lots (id, site_id, product_id, lot_number, expiry_date, received_at, initial_qty, remaining_qty,
                        unit_cost_ht, source_type, status, created_at, updated_at)
      SELECT gen_random_uuid(), '${site.id}', p.id, 'L' || k || '-' || right(p.internal_code, 6),
             current_date + (30 + (abs(hashtext(p.id::text || k)) % 700)) * interval '1 day',
             now() - interval '90 days', 300, 100 + abs(hashtext(p.id::text || k)) % 200, 1500, 'SUPPLIER', 'ACTIVE', now(), now()
      FROM products p CROSS JOIN generate_series(1, 2) k
      WHERE k = 1 OR (abs(hashtext(p.id::text)) % 2 = 0)`);
    await t.prisma.$executeRawUnsafe(`
      CREATE TABLE load_lots AS
      SELECT row_number() OVER (ORDER BY id) AS rn, id, product_id FROM lots`);
    await t.prisma.$executeRawUnsafe(`CREATE INDEX ON load_lots (rn)`);
    const lotCount = Number(
      (await t.prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM load_lots`))[0]!
        .c,
    );
    // 1 mouvement sur 20 concerne l'un des 5 produits « très actifs » (fiche de mouvement volumineuse).
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO stock_movements (site_id, product_id, lot_id, type, qty, unit_cost_ht, unit_price_ttc,
                                   product_balance_after, lot_balance_after, document_type, document_id,
                                   document_number, counterpart_type, user_id, created_at)
      SELECT '${site.id}', l.product_id, l.id,
             (ARRAY['PURCHASE_IN','SALE_OUT','SALE_OUT','SALE_OUT','CUSTOMER_RETURN_IN','INVENTORY_ADJUSTMENT'])[1 + g % 6]::"StockMovementType",
             CASE WHEN g % 6 IN (1,2,3) THEN -(1 + g % 4) ELSE 1 + g % 30 END,
             1500, 2350, 100 + g % 500, 50 + g % 200,
             CASE WHEN g % 6 IN (1,2,3) THEN 'sale' ELSE 'receipt' END,
             gen_random_uuid()::text, 'FAC-2025-' || lpad((g % 999999)::text, 6, '0'),
             'NONE', '${admin.userId}',
             now() - ((g % 720) || ' days')::interval - ((g % 86400) || ' seconds')::interval
      FROM generate_series(1, ${MOVEMENTS}) g
      JOIN load_lots l ON l.rn = 1 + CASE WHEN g % 20 = 0 THEN (g / 20) % 5 ELSE (g::bigint * 7919) % ${lotCount} END`);
  }
  await t.prisma.$executeRawUnsafe('ANALYZE');
  const hotRows = await t.prisma.$queryRawUnsafe<{ id: string; name: string }[]>(`
    SELECT p.id, p.name FROM products p JOIN load_lots l ON l.product_id = p.id
    WHERE l.rn <= 5 ORDER BY l.rn`);
  hot = hotRows;
  const counts = await t.prisma.$queryRawUnsafe<{ p: bigint; m: bigint; l: bigint }[]>(`
    SELECT (SELECT count(*) FROM products) p, (SELECT count(*) FROM stock_movements) m, (SELECT count(*) FROM lots) l`);
  report.push(
    `Jeu de données : ${counts[0]!.p} produits, ${counts[0]!.l} lots, ${counts[0]!.m} mouvements (générés en ${((performance.now() - started) / 1000).toFixed(0)} s)`,
  );
}, 900_000);

afterAll(async () => {
  const text = `\n=== Résultats de charge ===\n${report.join('\n')}\n`;
  process.stderr.write(text);
  mkdirSync('storage-test', { recursive: true });
  writeFileSync('storage-test/load-report.txt', text);
  await t.stop();
});

describe('recherche au comptoir', () => {
  const queries = [
    'amox',
    'paracetamol 500',
    'ibuprofene 1 g',
    'omeprazole',
    'atorva 40',
    'PRD004217',
    'losartan lab12',
  ];

  it('recherche instantanée < 200 ms (p95)', async () => {
    const stat = await measure('Recherche produit (nom, DCI, dosage, code)', 70, async (i) => {
      const res = await t
        .get(`/products/search?q=${encodeURIComponent(queries[i % queries.length]!)}`, admin)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
    });
    expect(stat.p95).toBeLessThan(200);
  });

  it('recherche par code-barres < 200 ms', async () => {
    const stat = await measure('Recherche par code-barres exact', 30, async (i) => {
      const code = `619${String(1 + i * 1657).padStart(10, '0')}`;
      const res = await t.get(`/products/search?q=${code}`, admin).expect(200);
      expect(res.body).toHaveLength(1);
    });
    expect(stat.p95).toBeLessThan(200);
  });

  it('recherche tolérante aux fautes de frappe < 200 ms', async () => {
    const stat = await measure('Recherche avec faute de frappe (trigrammes)', 20, async (i) => {
      const typo = ['amoxiciline', 'paracetmol', 'omeprazol', 'metformne'][i % 4]!;
      await t.get(`/products/search?q=${typo}`, admin).expect(200);
    });
    expect(stat.p95).toBeLessThan(200);
  });
});

describe('consultations volumineuses', () => {
  it('fiche de mouvement sur 12 mois < 2 s', async () => {
    const from = addMonthsIso(todayIso('Africa/Tunis'), -12);
    const stat = await measure('Fiche de mouvement produit très actif (12 mois)', 10, async (i) => {
      const res = await t
        .get(
          `/stock/movements?productId=${hot[i % hot.length]!.id}&from=${from}&pageSize=200`,
          admin,
        )
        .expect(200);
      expect(res.body.total ?? res.body.rows?.length ?? 0).toBeGreaterThan(0);
    });
    expect(stat.p95).toBeLessThan(2000);
  });

  it('listes paginées < 1 s', async () => {
    const lists: [string, string][] = [
      ['Catalogue (page 1, 50 lignes)', '/products?page=1&pageSize=50'],
      ['Catalogue (page profonde 500)', '/products?page=500&pageSize=50'],
      ['Catalogue filtré par recherche', '/products?q=amox&pageSize=50'],
      ['État du stock', '/stock/state?pageSize=50'],
      ['Lots', '/stock/lots?pageSize=50'],
      ['Péremptions à 90 jours', '/stock/expiries?days=90&pageSize=50'],
      [
        'Stock à une date passée',
        `/stock/at-date?date=${addMonthsIso(todayIso('Africa/Tunis'), -6)}&pageSize=50`,
      ],
    ];
    for (const [label, path] of lists) {
      const stat = await measure(label, 3, async () => {
        await t.get(path, admin).expect(200);
      });
      expect(stat.p95, label).toBeLessThan(1000);
    }
  });

  it('tableau de bord et rapports lourds < 3 s', async () => {
    const from = addMonthsIso(todayIso('Africa/Tunis'), -12);
    const to = todayIso('Africa/Tunis');
    const range = `from=${from}&to=${to}`;
    const reports: [string, string][] = [
      ['Tableau de bord administrateur', '/dashboard'],
      ['Rapport : valorisation du stock', `/reports/stock-valuation?${range}`],
      ['Rapport : rotation des stocks', `/reports/stock-rotation?${range}`],
      ['Rapport : stock dormant', `/reports/stock-dormant?${range}`],
      ['Rapport : valeur des péremptions', `/reports/expiry-value?${range}`],
      ['Rapport : achats par produit', `/reports/purchases-by-product?${range}`],
      ['Rapport : pertes de stock', `/reports/stock-losses?${range}`],
      ['Rapport : marges par produit', `/reports/margins-by-product?${range}`],
      ['Rapport : meilleures ventes', `/reports/top-products?${range}`],
      ['Suggestions de réapprovisionnement', '/reorder-suggestions?pageSize=50'],
    ];
    for (const [label, path] of reports) {
      const stat = await measure(label, 3, async () => {
        await t.get(path, admin).expect(200);
      });
      expect(stat.p95, label).toBeLessThan(3000);
    }
  });
});

describe('tâches de fond', () => {
  it('contrôle nocturne de cohérence du stock (75 000 lots, 1 M de mouvements) < 5 s', async () => {
    const jobs = t.app.get(JobsService);
    const stat = await measure('Tâche : cohérence du stock (RG-22)', 2, async () => {
      // Les soldes synthétiques ne correspondent pas aux mouvements : seule la durée compte ici.
      await jobs.stockConsistency();
    });
    expect(stat.p95).toBeLessThan(5000);
  });
});

describe('ventes au comptoir', () => {
  const devices: { device: TestDevice; session: Session }[] = [];
  let walkIn = '';

  beforeAll(async () => {
    const client = await t
      .post('/clients', admin, {
        type: 'INDIVIDUAL',
        name: `Client charge ${uniq()}`,
        phone: '71 000 000',
      })
      .expect(201);
    walkIn = client.body.id;
    for (let i = 0; i < CLIENTS; i += 1) {
      const device = await t.registerDevice(`Caisse charge ${i} ${uniq()}`, true);
      const user = await t.createUser({ role: 'PREPARER' });
      const session = await t.login(user.username, 'Motdepasse1', device);
      await t.post('/cash/open', session, { openingFloat: 100_000 }).expect(201);
      devices.push({ device, session });
    }
  }, 120_000);

  async function sell(session: Session, productIds: string[]) {
    const clientId = walkIn;
    const draft = await t.post('/sales', session, { clientId }).expect(201);
    let view = draft.body;
    for (const productId of productIds)
      view = (
        await t.post(`/sales/${draft.body.id}/lines`, session, { productId, qty: 1 }).expect(201)
      ).body;
    const start = performance.now();
    const res = await t
      .post(`/sales/${draft.body.id}/validate`, session, {
        document: 'NONE',
        payments: [{ method: 'CARD', amount: view.totals.totalTtc }],
      })
      .set('Idempotency-Key', `load-${uniq()}`);
    const elapsed = performance.now() - start;
    if (res.status !== 200)
      throw new Error(`Validation ${res.status} : ${JSON.stringify(res.body)}`);
    return elapsed;
  }

  it('validation d’une vente de 3 lignes < 500 ms (un poste)', async () => {
    const session = devices[0]!.session;
    const products = await t.prisma.product.findMany({
      take: 300,
      skip: 1000,
      select: { id: true },
    });
    const times: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      times.push(
        await sell(
          session,
          products.slice(i * 3, i * 3 + 3).map((p) => p.id),
        ),
      );
    }
    times.sort((a, b) => a - b);
    report.push(
      `${'Validation de vente, 3 lignes (un poste)'.padEnd(58)} p50 ${percentile(times, 50).toFixed(0).padStart(5)} ms   p95 ${percentile(times, 95).toFixed(0).padStart(5)} ms   max ${times.at(-1)!.toFixed(0).padStart(5)} ms   (n=30)`,
    );
    expect(percentile(times, 95)).toBeLessThan(500);
  });

  it('10 postes simultanés : aucune erreur, validation < 1,5 s, stock cohérent', async () => {
    const products = await t.prisma.product.findMany({
      take: 400,
      skip: 5000,
      select: { id: true },
    });
    const contended = products[0]!.id; // même produit vendu par tous les postes en même temps
    const before = await t.prisma.lot.aggregate({
      where: { productId: contended },
      _sum: { remainingQty: true },
    });
    const perClient = 12;
    const times: number[] = [];
    const wall = performance.now();
    await Promise.all(
      devices.map(async ({ session }, c) => {
        for (let i = 0; i < perClient; i += 1) {
          const own = products[1 + c * perClient + i]!.id;
          times.push(await sell(session, i % 3 === 0 ? [contended, own] : [own]));
        }
      }),
    );
    const seconds = (performance.now() - wall) / 1000;
    times.sort((a, b) => a - b);
    report.push(
      `${'Validation de vente, 10 postes simultanés'.padEnd(58)} p50 ${percentile(times, 50).toFixed(0).padStart(5)} ms   p95 ${percentile(times, 95).toFixed(0).padStart(5)} ms   max ${times.at(-1)!.toFixed(0).padStart(5)} ms   (n=${times.length}, ${(times.length / seconds).toFixed(1)} ventes/s)`,
    );
    expect(percentile(times, 95)).toBeLessThan(1500);
    // Cohérence : le produit disputé a perdu exactement une unité par vente qui l'incluait.
    const soldContended = CLIENTS * Math.ceil(perClient / 3);
    const after = await t.prisma.lot.aggregate({
      where: { productId: contended },
      _sum: { remainingQty: true },
    });
    expect((before._sum.remainingQty ?? 0) - (after._sum.remainingQty ?? 0)).toBe(soldContended);
    // Aucun lot négatif, et les lots touchés correspondent à la somme de leurs mouvements (RG-22).
    const negative = await t.prisma.lot.count({ where: { remainingQty: { lt: 0 } } });
    expect(negative).toBe(0);
  });
});
