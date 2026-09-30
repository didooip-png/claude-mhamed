import { Injectable } from '@nestjs/common';
import type { Paginated, ProductData, ProductQuery } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { normalizeSearch } from '../../common/search.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { StockService } from '../stock/stock.service.js';

export interface StockSummary {
  total: number;
  sellable: number;
  unavailable: number;
  lotCount: number;
  nextExpiry: string | null;
  valueCost: number;
  status: 'OK' | 'LOW' | 'OUT';
}

interface StockRow {
  product_id: string;
  total: bigint;
  sellable: bigint;
  lot_count: bigint;
  next_expiry: Date | null;
  value_cost: bigint;
}

const productInclude = {
  barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  laboratory: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, kind: true } },
  therapeuticClass: { select: { id: true, name: true } },
  tvaRate: { select: { id: true, label: true, rateBp: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRefs = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const PRICE_FIELDS = ['refPurchasePriceHt', 'salePriceTtc', 'unitSalePriceTtc'] as const;
const PRICE_LABELS: Record<(typeof PRICE_FIELDS)[number], string> = {
  refPurchasePriceHt: 'prix d’achat HT',
  salePriceTtc: 'prix de vente TTC',
  unitSalePriceTtc: 'prix unitaire TTC',
};

export function stockStatus(sellable: number, minStock: number): StockSummary['status'] {
  if (sellable <= 0) return 'OUT';
  if (minStock > 0 && sellable <= minStock) return 'LOW';
  return 'OK';
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly stock: StockService,
  ) {}

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  /** Résumé du stock par produit (vendable = lot actif, non périmé, RG-04). */
  async stockSummaries(
    productIds: string[],
    client: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, StockRow>> {
    if (productIds.length === 0) return new Map();
    const sellableFrom = await this.stock.sellableFrom();
    const rows = await client.$queryRaw<StockRow[]>`
      SELECT l.product_id,
        COALESCE(SUM(l.remaining_qty), 0)::bigint AS total,
        COALESCE(SUM(l.remaining_qty) FILTER (WHERE l.status = 'ACTIVE' AND l.expiry_date > ${sellableFrom}::date), 0)::bigint AS sellable,
        COUNT(*) FILTER (WHERE l.remaining_qty > 0)::bigint AS lot_count,
        MIN(l.expiry_date) FILTER (WHERE l.remaining_qty > 0 AND l.status = 'ACTIVE' AND l.expiry_date > ${sellableFrom}::date) AS next_expiry,
        COALESCE(SUM(l.remaining_qty::bigint * l.unit_cost_ht), 0)::bigint AS value_cost
      FROM lots l WHERE l.product_id = ANY(${productIds}::uuid[])
      GROUP BY l.product_id`;
    return new Map(rows.map((r) => [r.product_id, r]));
  }

  private summarize(row: StockRow | undefined, minStock: number): StockSummary {
    const total = num(row?.total);
    const sellable = num(row?.sellable);
    return {
      total,
      sellable,
      unavailable: total - sellable,
      lotCount: num(row?.lot_count),
      nextExpiry: row?.next_expiry ? row.next_expiry.toISOString().slice(0, 10) : null,
      valueCost: num(row?.value_cost),
      status: stockStatus(sellable, minStock),
    };
  }

  /** Retire les coûts et marges pour les utilisateurs sans `catalog.view_costs`. */
  private present<T extends { refPurchasePriceHt?: bigint | number }>(p: T, actor: Actor): T {
    if (actor.permissions.has('catalog.view_costs')) return p;
    const { refPurchasePriceHt: _hidden, ...rest } = p;
    return rest as T;
  }

  async list(q: ProductQuery, actor: Actor): Promise<Paginated<unknown>> {
    const sellableFrom = await this.stock.sellableFrom();
    const conditions: Prisma.Sql[] = [];
    if (q.status === 'active') conditions.push(Prisma.sql`p.is_active`);
    if (q.status === 'archived') conditions.push(Prisma.sql`NOT p.is_active`);
    if (q.categoryId) conditions.push(Prisma.sql`p.category_id = ${q.categoryId}::uuid`);
    if (q.laboratoryId) conditions.push(Prisma.sql`p.laboratory_id = ${q.laboratoryId}::uuid`);
    if (q.location) conditions.push(Prisma.sql`p.location ILIKE ${`%${q.location}%`}`);
    const term = q.q ? normalizeSearch(q.q) : '';
    if (q.q) {
      const words = term.split(' ').filter(Boolean);
      const likes =
        words.length > 0
          ? Prisma.join(
              words.map((w) => Prisma.sql`p.search_text LIKE ${`%${w}%`}`),
              ' AND ',
            )
          : Prisma.sql`FALSE`;
      const likes2 =
        words.length > 0
          ? Prisma.join(
              words.map((w) => Prisma.sql`p2.search_text LIKE ${`%${w}%`}`),
              ' AND ',
            )
          : Prisma.sql`FALSE`;
      conditions.push(Prisma.sql`(
        (${likes})
        OR (${term} <% p.search_text AND NOT EXISTS (SELECT 1 FROM products p2 WHERE ${likes2}))
        OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = ${q.q.trim()})
        OR p.internal_code = ${q.q.trim().toUpperCase()})`);
    }
    if (q.stock === 'OUT') conditions.push(Prisma.sql`COALESCE(s.sellable, 0) <= 0`);
    if (q.stock === 'LOW')
      conditions.push(
        Prisma.sql`COALESCE(s.sellable, 0) > 0 AND p.min_stock > 0 AND COALESCE(s.sellable, 0) <= p.min_stock`,
      );
    if (q.stock === 'OK')
      conditions.push(
        Prisma.sql`COALESCE(s.sellable, 0) > 0 AND (p.min_stock = 0 OR COALESCE(s.sellable, 0) > p.min_stock)`,
      );
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const sortMap: Record<string, Prisma.Sql> = {
      name: Prisma.sql`p.name`,
      internalCode: Prisma.sql`p.internal_code`,
      salePriceTtc: Prisma.sql`p.sale_price_ttc`,
      sellable: Prisma.sql`COALESCE(s.sellable, 0)`,
      nextExpiry: Prisma.sql`s.next_expiry`,
      updatedAt: Prisma.sql`p.updated_at`,
    };
    const [field, dir] = (q.sort ?? '').split(':');
    const order =
      sortMap[field ?? ''] ??
      (term ? Prisma.sql`word_similarity(${term}, p.search_text)` : Prisma.sql`p.name`);
    const direction =
      dir === 'desc' || (!sortMap[field ?? ''] && term) ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const { skip, take } = pageArgs(q);

    const stockCte = Prisma.sql`
      WITH s AS (
        SELECT product_id,
          SUM(remaining_qty) FILTER (WHERE status = 'ACTIVE' AND expiry_date > ${sellableFrom}::date) AS sellable,
          MIN(expiry_date) FILTER (WHERE remaining_qty > 0 AND status = 'ACTIVE' AND expiry_date > ${sellableFrom}::date) AS next_expiry
        FROM lots GROUP BY product_id)`;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      ${stockCte}
      SELECT p.id FROM products p LEFT JOIN s ON s.product_id = p.id
      ${where}
      ORDER BY ${order} ${direction} NULLS LAST, p.name ASC, p.id ASC
      LIMIT ${take} OFFSET ${skip}`;
    const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      ${stockCte}
      SELECT COUNT(*)::bigint AS count FROM products p LEFT JOIN s ON s.product_id = p.id ${where}`;

    const productIds = ids.map((r) => r.id);
    const [products, summaries] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds } }, include: productInclude }),
      this.stockSummaries(productIds),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = productIds
      .map((id) => byId.get(id))
      .filter((p): p is ProductWithRefs => !!p)
      .map((p) => {
        const { searchText: _s, ...rest } = p;
        return this.present(
          { ...rest, stock: this.summarize(summaries.get(p.id), p.minStock) },
          actor,
        );
      });
    return { items, total: num(countRows[0]?.count), page: q.page, pageSize: q.pageSize };
  }

  /** Recherche instantanée (caisse, réception) : code-barres exact, code, puis texte tolérant. */
  async search(
    raw: string,
    actor: Actor,
    options: { includeInactive?: boolean; limit?: number } = {},
  ) {
    const query = raw.trim();
    if (!query) return [];
    const term = normalizeSearch(query);
    const words = term.split(' ').filter(Boolean);
    const likes =
      words.length > 0
        ? Prisma.join(
            words.map((w) => Prisma.sql`p.search_text LIKE ${`%${w}%`}`),
            ' AND ',
          )
        : Prisma.sql`FALSE`;
    const likes2 =
      words.length > 0
        ? Prisma.join(
            words.map((w) => Prisma.sql`p2.search_text LIKE ${`%${w}%`}`),
            ' AND ',
          )
        : Prisma.sql`FALSE`;
    const active = options.includeInactive ? Prisma.empty : Prisma.sql`AND p.is_active`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM products p
      WHERE (
        EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = ${query})
        OR p.internal_code = ${query.toUpperCase()}
        OR (${likes})
        OR (${term} <% p.search_text AND NOT EXISTS (SELECT 1 FROM products p2 WHERE ${likes2}))
      ) ${active}
      ORDER BY
        EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = ${query}) DESC,
        (p.internal_code = ${query.toUpperCase()}) DESC,
        (${likes}) DESC,
        word_similarity(${term}, p.search_text) DESC,
        p.name ASC
      LIMIT ${options.limit ?? 20}`;
    const ids = rows.map((r) => r.id);
    const [products, summaries] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } }, include: productInclude }),
      this.stockSummaries(ids),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is ProductWithRefs => !!p)
      .map((p) => {
        const { searchText: _s, ...rest } = p;
        return this.present(
          { ...rest, stock: this.summarize(summaries.get(p.id), p.minStock) },
          actor,
        );
      });
  }

  async get(id: string, actor: Actor) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw new AppError('NOT_FOUND');
    const summaries = await this.stockSummaries([id]);
    const hasHistory = (await this.prisma.lot.count({ where: { productId: id } })) > 0;
    const { searchText: _s, ...rest } = product;
    return this.present(
      { ...rest, stock: this.summarize(summaries.get(id), product.minStock), hasHistory },
      actor,
    );
  }

  priceHistory(id: string, actor: Actor) {
    return this.prisma.productPriceHistory.findMany({
      where: {
        productId: id,
        ...(actor.permissions.has('catalog.view_costs')
          ? {}
          : { field: { not: 'refPurchasePriceHt' } }),
      },
      orderBy: { changedAt: 'desc' },
      take: 200,
    });
  }

  /** Produits de même DCI + dosage + forme disponibles (proposés en cas de rupture, §6.2). */
  async equivalents(id: string, actor: Actor) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new AppError('NOT_FOUND');
    if (!product.dci) return [];
    const candidates = await this.prisma.product.findMany({
      where: {
        id: { not: id },
        isActive: true,
        dci: { equals: product.dci, mode: 'insensitive' },
        ...(product.dosage ? { dosage: { equals: product.dosage, mode: 'insensitive' } } : {}),
        ...(product.form ? { form: { equals: product.form, mode: 'insensitive' } } : {}),
      },
      include: productInclude,
      take: 50,
    });
    const summaries = await this.stockSummaries(candidates.map((c) => c.id));
    return candidates
      .map((c) => {
        const { searchText: _s, ...rest } = c;
        return this.present(
          { ...rest, stock: this.summarize(summaries.get(c.id), c.minStock) },
          actor,
        );
      })
      .filter((c) => c.stock.sellable > 0)
      .sort((a, b) => b.stock.sellable - a.stock.sellable);
  }

  // -------------------------------------------------------------------------
  // Écriture
  // -------------------------------------------------------------------------

  private async buildSearchText(tx: Tx, data: ProductData, internalCode: string): Promise<string> {
    const lab = data.laboratoryId
      ? await tx.laboratory.findUnique({ where: { id: data.laboratoryId } })
      : null;
    return normalizeSearch(
      data.name,
      data.dci,
      data.dosage,
      data.form,
      data.presentation,
      internalCode,
      lab?.name,
      ...data.barcodes,
    );
  }

  private async assertReferences(tx: Tx, data: ProductData): Promise<void> {
    // Requêtes séquentielles : une transaction n'utilise qu'une seule connexion.
    const category = await tx.category.findUnique({ where: { id: data.categoryId } });
    const tva = await tx.tvaRate.findUnique({ where: { id: data.tvaRateId } });
    const errors: Record<string, string> = {};
    if (!category) errors.categoryId = 'Catégorie inconnue';
    if (!tva) errors.tvaRateId = 'Taux de TVA inconnu';
    if (
      data.laboratoryId &&
      !(await tx.laboratory.findUnique({ where: { id: data.laboratoryId } }))
    )
      errors.laboratoryId = 'Laboratoire inconnu';
    if (Object.keys(errors).length > 0)
      throw new AppError('VALIDATION_ERROR', { fieldErrors: errors });
  }

  private async assertBarcodesFree(
    tx: Tx,
    barcodes: string[],
    productId: string | null,
  ): Promise<void> {
    if (barcodes.length === 0) return;
    const taken = await tx.productBarcode.findMany({
      where: { barcode: { in: barcodes }, ...(productId ? { NOT: { productId } } : {}) },
      include: { product: { select: { name: true, internalCode: true } } },
    });
    if (taken.length > 0) {
      const first = taken[0]!;
      throw new AppError('DUPLICATE_BARCODE', {
        fieldErrors: {
          barcodes: `Code-barres ${first.barcode} déjà attribué à ${first.product.internalCode} — ${first.product.name}`,
        },
      });
    }
  }

  private columns(data: ProductData) {
    return {
      name: data.name,
      dci: data.dci,
      dosage: data.dosage,
      form: data.form,
      presentation: data.presentation,
      laboratoryId: data.laboratoryId ?? null,
      categoryId: data.categoryId,
      therapeuticClassId: data.therapeuticClassId ?? null,
      tvaRateId: data.tvaRateId,
      refPurchasePriceHt: BigInt(data.refPurchasePriceHt),
      salePriceTtc: BigInt(data.salePriceTtc),
      unitsPerPack: data.unitsPerPack,
      sellByUnit: data.sellByUnit,
      unitSalePriceTtc:
        data.sellByUnit && data.unitSalePriceTtc !== null && data.unitSalePriceTtc !== undefined
          ? BigInt(data.unitSalePriceTtc)
          : null,
      requiresPrescription: data.requiresPrescription,
      controlledClass: data.controlledClass,
      coldChain: data.coldChain,
      returnable: data.returnable,
      location: data.location,
      minStock: data.minStock,
      maxStock: data.maxStock ?? null,
      reorderPoint: data.reorderPoint ?? null,
      isActive: data.isActive,
    };
  }

  async create(data: ProductData, actor: Actor, tx?: Tx) {
    const run = async (t: Tx) => {
      await this.assertReferences(t, data);
      await this.assertBarcodesFree(t, data.barcodes, null);
      let internalCode = data.internalCode;
      if (internalCode) {
        if (await t.product.findUnique({ where: { internalCode } }))
          throw new AppError('DUPLICATE_CODE', {
            fieldErrors: { internalCode: 'Code déjà utilisé' },
          });
      } else {
        do internalCode = await this.sequences.nextCode(t, 'PRD');
        while (await t.product.findUnique({ where: { internalCode } }));
      }
      const product = await t.product.create({
        data: {
          ...this.columns(data),
          internalCode,
          searchText: await this.buildSearchText(t, data, internalCode),
          createdById: actor.userId,
          updatedById: actor.userId,
          barcodes: {
            create: data.barcodes.map((barcode, i) => ({ barcode, isPrimary: i === 0 })),
          },
        },
        include: productInclude,
      });
      await this.audit.record(t, {
        eventType: 'PRODUCT_CREATED',
        actor,
        entityType: 'product',
        entityId: product.id,
        entityRef: `${product.internalCode} — ${product.name}`,
        summary: `Produit ${product.internalCode} — ${product.name} créé`,
        after: {
          salePriceTtc: product.salePriceTtc,
          refPurchasePriceHt: product.refPurchasePriceHt,
        },
        notify: false,
      });
      return product;
    };
    return tx ? run(tx) : this.prisma.tx(run);
  }

  async update(id: string, data: ProductData, actor: Actor, tx?: Tx) {
    const run = async (t: Tx) => {
      const before = await t.product.findUnique({ where: { id }, include: { barcodes: true } });
      if (!before) throw new AppError('NOT_FOUND');
      if (data.version !== undefined && before.version !== data.version)
        throw new AppError('VERSION_CONFLICT');
      await this.assertReferences(t, data);
      await this.assertBarcodesFree(t, data.barcodes, id);
      const hasLots = (await t.lot.count({ where: { productId: id } })) > 0;
      if (
        hasLots &&
        (before.unitsPerPack !== data.unitsPerPack || before.sellByUnit !== data.sellByUnit)
      ) {
        throw new AppError('CONFLICT', {
          fieldErrors: {
            unitsPerPack:
              'Unités par boîte et vente à l’unité ne sont plus modifiables : ce produit a déjà du stock.',
          },
        });
      }
      const internalCode = data.internalCode ?? before.internalCode;
      if (
        internalCode !== before.internalCode &&
        (await t.product.findUnique({ where: { internalCode } }))
      ) {
        throw new AppError('DUPLICATE_CODE', {
          fieldErrors: { internalCode: 'Code déjà utilisé' },
        });
      }
      const columns = this.columns(data);
      await t.productBarcode.deleteMany({
        where: { productId: id, barcode: { notIn: data.barcodes } },
      });
      for (const [i, barcode] of data.barcodes.entries()) {
        await t.productBarcode.upsert({
          where: { barcode },
          create: { productId: id, barcode, isPrimary: i === 0 },
          update: { isPrimary: i === 0 },
        });
      }
      const product = await t.product.update({
        where: { id },
        data: {
          ...columns,
          internalCode,
          searchText: await this.buildSearchText(t, data, internalCode),
          updatedById: actor.userId,
          version: { increment: 1 },
        },
        include: productInclude,
      });
      // Historique des prix (qui, quand, ancien → nouveau) — §6.2.
      const changes: string[] = [];
      for (const field of PRICE_FIELDS) {
        const oldValue = before[field];
        const newValue = product[field];
        if ((oldValue ?? null) !== (newValue ?? null)) {
          await t.productPriceHistory.create({
            data: {
              productId: id,
              field,
              oldValue,
              newValue,
              changedById: actor.userId,
              changedAt: now(),
            },
          });
          changes.push(PRICE_LABELS[field]);
        }
      }
      if (changes.length > 0) {
        await this.audit.record(t, {
          eventType: 'PRODUCT_PRICE_CHANGED',
          actor,
          entityType: 'product',
          entityId: id,
          entityRef: `${product.internalCode} — ${product.name}`,
          summary: `Prix modifié(s) pour ${product.internalCode} — ${product.name} : ${changes.join(', ')}`,
          before: {
            refPurchasePriceHt: before.refPurchasePriceHt,
            salePriceTtc: before.salePriceTtc,
            unitSalePriceTtc: before.unitSalePriceTtc,
          },
          after: {
            refPurchasePriceHt: product.refPurchasePriceHt,
            salePriceTtc: product.salePriceTtc,
            unitSalePriceTtc: product.unitSalePriceTtc,
          },
        });
      }
      const changedFields = Object.keys(columns).filter(
        (k) =>
          !(PRICE_FIELDS as readonly string[]).includes(k) &&
          JSON.stringify((before as Record<string, unknown>)[k] ?? null, (_k, v: unknown) =>
            typeof v === 'bigint' ? Number(v) : v,
          ) !==
            JSON.stringify((product as Record<string, unknown>)[k] ?? null, (_k, v: unknown) =>
              typeof v === 'bigint' ? Number(v) : v,
            ),
      );
      if (changedFields.length > 0 || before.internalCode !== internalCode) {
        await this.audit.record(t, {
          eventType: 'PRODUCT_UPDATED',
          actor,
          entityType: 'product',
          entityId: id,
          entityRef: `${product.internalCode} — ${product.name}`,
          summary: `Produit ${product.internalCode} — ${product.name} modifié (${changedFields.join(', ') || 'code'})`,
          before: Object.fromEntries(
            changedFields.map((k) => [k, (before as Record<string, unknown>)[k]]),
          ),
          after: Object.fromEntries(
            changedFields.map((k) => [k, (product as Record<string, unknown>)[k]]),
          ),
          notify: false,
        });
      }
      return product;
    };
    return tx ? run(tx) : this.prisma.tx(run);
  }

  /** Supprime un produit SANS historique ; sinon, il doit être archivé (§6.2). */
  async remove(id: string, actor: Actor): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const product = await tx.product.findUnique({ where: { id } });
      if (!product) throw new AppError('NOT_FOUND');
      const lots = await tx.lot.count({ where: { productId: id } });
      const receiptLines = await tx.purchaseReceiptLine.count({ where: { productId: id } });
      const saleLines = await tx.saleLine.count({ where: { productId: id } });
      if (lots + receiptLines + saleLines > 0) {
        throw new AppError('CONFLICT', undefined, {
          message: 'Ce produit a un historique : il ne peut pas être supprimé, seulement archivé.',
        });
      }
      await tx.productBarcode.deleteMany({ where: { productId: id } });
      await tx.productPriceHistory.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
      await this.audit.record(tx, {
        eventType: 'PRODUCT_DELETED',
        actor,
        entityType: 'product',
        entityId: id,
        entityRef: `${product.internalCode} — ${product.name}`,
        summary: `Produit ${product.internalCode} — ${product.name} supprimé (aucun historique)`,
        before: { name: product.name, internalCode: product.internalCode },
        notify: false,
      });
    });
  }
}
