import { Injectable } from '@nestjs/common';
import {
  formatDateTime,
  formatMoney,
  formatStockQty,
  productLabel,
  type InventoryScope,
  type PaginationQuery,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import type { InventoryStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EventsService } from '../events/events.service.js';
import { ExcelService } from '../exports/excel.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockService } from '../stock/stock.service.js';

const productSelect = {
  id: true,
  internalCode: true,
  name: true,
  dosage: true,
  form: true,
  unitsPerPack: true,
  sellByUnit: true,
  location: true,
} satisfies Prisma.ProductSelect;

const lotSelect = {
  id: true,
  lotNumber: true,
  expiryDate: true,
  status: true,
  remainingQty: true,
} satisfies Prisma.LotSelect;

export type InventoryLineFilter = 'ALL' | 'UNCOUNTED' | 'COUNTED' | 'DIFFERENCES';

/** Produits couverts par un périmètre d'inventaire. */
function scopeWhere(scope: InventoryScope): Prisma.ProductWhereInput {
  switch (scope.kind) {
    case 'ALL':
      return {};
    case 'CATEGORY':
      return { categoryId: { in: scope.ids } };
    case 'LABORATORY':
      return { laboratoryId: { in: scope.ids } };
    case 'LOCATION':
      return { location: { in: scope.locations } };
    case 'PRODUCTS':
      return { id: { in: scope.ids } };
  }
}

/**
 * Inventaire (§6.12) : photographie du stock par lot à l'ouverture, comptage à l'aveugle sur
 * plusieurs postes, écart calculé sur le théorique au moment du comptage de la ligne, validation
 * administrateur qui corrige les lots par des mouvements INVENTORY_ADJUSTMENT relatifs (les
 * ventes faites pendant l'inventaire restent donc valides).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly events: EventsService,
    private readonly documents: DocumentsService,
    private readonly excel: ExcelService,
  ) {}

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  async list(q: PaginationQuery & { status?: InventoryStatus; from?: string; to?: string }) {
    const where: Prisma.InventoryWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            startedAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.inventory.count({ where }),
    ]);
    const users = await this.userMap(rows.flatMap((r) => [r.startedById, r.validatedById]));
    const stats = await this.prisma.inventoryLine.groupBy({
      by: ['inventoryId'],
      where: { inventoryId: { in: rows.map((r) => r.id) } },
      _count: { _all: true, countedQty: true },
    });
    const byId = new Map(stats.map((s) => [s.inventoryId, s._count]));
    return paginated(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        scopeLabel: r.scopeLabel,
        status: r.status,
        startedAt: r.startedAt,
        startedBy: users.get(r.startedById) ?? null,
        validatedAt: r.validatedAt,
        validatedBy: r.validatedById ? (users.get(r.validatedById) ?? null) : null,
        lineCount: byId.get(r.id)?._all ?? 0,
        countedCount: byId.get(r.id)?.countedQty ?? 0,
      })),
      total,
      q,
    );
  }

  private async userMap(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, code: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async get(id: string, actor: Actor) {
    const inv = await this.prisma.inventory.findUnique({ where: { id } });
    if (!inv) throw new AppError('NOT_FOUND');
    const manage = actor.permissions.has('inventory.manage');
    const costs = actor.permissions.has('catalog.view_costs');
    const users = await this.userMap([inv.startedById, inv.validatedById, inv.cancelledById]);
    const [total, counted, withDiff] = await Promise.all([
      this.prisma.inventoryLine.count({ where: { inventoryId: id } }),
      this.prisma.inventoryLine.count({ where: { inventoryId: id, countedQty: { not: null } } }),
      this.prisma.inventoryLine.count({
        where: { inventoryId: id, difference: { not: null, notIn: [0] } },
      }),
    ]);
    let valueDifference: number | null = null;
    let unitsPlus = 0;
    let unitsMinus = 0;
    if (manage) {
      const diffs = await this.prisma.inventoryLine.findMany({
        where: { inventoryId: id, difference: { not: null, notIn: [0] } },
        select: { difference: true, unitCostHt: true },
      });
      let value = 0;
      for (const d of diffs) {
        const diff = d.difference ?? 0;
        value += diff * num(d.unitCostHt);
        if (diff > 0) unitsPlus += diff;
        else unitsMinus += -diff;
      }
      valueDifference = costs ? value : null;
    }
    return {
      id: inv.id,
      number: inv.number,
      scope: inv.scope,
      scopeLabel: inv.scopeLabel,
      status: inv.status,
      notes: inv.notes,
      startedAt: inv.startedAt,
      startedBy: users.get(inv.startedById) ?? null,
      validatedAt: inv.validatedAt,
      validatedBy: inv.validatedById ? (users.get(inv.validatedById) ?? null) : null,
      cancelledAt: inv.cancelledAt,
      cancelledBy: inv.cancelledById ? (users.get(inv.cancelledById) ?? null) : null,
      stats: {
        lines: total,
        counted,
        uncounted: total - counted,
        // Les écarts ne sont visibles que de ceux qui valident (comptage à l'aveugle).
        differences: manage ? withDiff : null,
        unitsPlus: manage ? unitsPlus : null,
        unitsMinus: manage ? unitsMinus : null,
        valueDifference,
      },
    };
  }

  async lines(
    id: string,
    q: PaginationQuery & { filter: InventoryLineFilter; productId?: string },
    actor: Actor,
  ) {
    const manage = actor.permissions.has('inventory.manage');
    const costs = actor.permissions.has('catalog.view_costs');
    const inv = await this.prisma.inventory.findUnique({ where: { id }, select: { id: true } });
    if (!inv) throw new AppError('NOT_FOUND');
    const filter: Prisma.InventoryLineWhereInput =
      q.filter === 'UNCOUNTED'
        ? { countedQty: null }
        : q.filter === 'COUNTED'
          ? { countedQty: { not: null } }
          : q.filter === 'DIFFERENCES'
            ? { difference: { not: null, notIn: [0] } }
            : {};
    // Le filtre « écarts » révèle des informations de théorique : réservé à ceux qui valident.
    if (q.filter === 'DIFFERENCES' && !manage) throw new AppError('FORBIDDEN');
    const search = q.q?.trim();
    const where: Prisma.InventoryLineWhereInput = {
      inventoryId: id,
      ...filter,
      ...(q.productId ? { productId: q.productId } : {}),
    };
    if (search) {
      const products = await this.prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { internalCode: { contains: search, mode: 'insensitive' } },
            { barcodes: { some: { barcode: search } } },
          ],
        },
        select: { id: true },
        take: 500,
      });
      const lots = await this.prisma.lot.findMany({
        where: { lotNumber: { contains: search, mode: 'insensitive' } },
        select: { id: true },
        take: 500,
      });
      where.OR = [
        { productId: { in: products.map((p) => p.id) } },
        { lotId: { in: lots.map((l) => l.id) } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.inventoryLine.findMany({
        where,
        orderBy: [{ productId: 'asc' }, { lotId: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.inventoryLine.count({ where }),
    ]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      select: productSelect,
    });
    const lots = await this.prisma.lot.findMany({
      where: { id: { in: rows.map((r) => r.lotId) } },
      select: lotSelect,
    });
    const users = await this.userMap(rows.map((r) => r.countedById));
    const productById = new Map(products.map((p) => [p.id, p]));
    const lotById = new Map(lots.map((l) => [l.id, l]));
    return paginated(
      rows.map((r) => ({
        id: r.id,
        product: productById.get(r.productId) ?? null,
        lot: lotById.get(r.lotId)
          ? {
              id: r.lotId,
              lotNumber: lotById.get(r.lotId)!.lotNumber,
              expiryDate: lotById.get(r.lotId)!.expiryDate.toISOString().slice(0, 10),
              status: lotById.get(r.lotId)!.status,
            }
          : null,
        countedQty: r.countedQty,
        countedBy: r.countedById ? (users.get(r.countedById) ?? null) : null,
        countedAt: r.countedAt,
        countCount: r.countCount,
        snapshotQty: manage ? r.snapshotQty : null,
        theoreticalAtCount: manage ? r.theoreticalAtCount : null,
        difference: manage ? r.difference : null,
        unitCostHt: manage && costs ? num(r.unitCostHt) : null,
      })),
      total,
      q,
    );
  }

  // -------------------------------------------------------------------------
  // Ouverture
  // -------------------------------------------------------------------------

  private async scopeLabel(scope: InventoryScope): Promise<string> {
    switch (scope.kind) {
      case 'ALL':
        return 'Inventaire complet';
      case 'CATEGORY': {
        const rows = await this.prisma.category.findMany({
          where: { id: { in: scope.ids } },
          select: { name: true },
        });
        return `Catégorie(s) : ${rows.map((r) => r.name).join(', ')}`;
      }
      case 'LABORATORY': {
        const rows = await this.prisma.laboratory.findMany({
          where: { id: { in: scope.ids } },
          select: { name: true },
        });
        return `Laboratoire(s) : ${rows.map((r) => r.name).join(', ')}`;
      }
      case 'LOCATION':
        return `Emplacement(s) : ${scope.locations.join(', ')}`;
      case 'PRODUCTS':
        return `Sélection de ${scope.ids.length} produit(s)`;
    }
  }

  async open(
    input: { scope: InventoryScope; includeEmptyLots: boolean; notes?: string },
    actor: Actor,
  ) {
    const scopeLabel = await this.scopeLabel(input.scope);
    const id = await this.prisma.tx(async (tx) => {
      const at = now();
      const products = await tx.product.findMany({
        where: scopeWhere(input.scope),
        select: { id: true },
      });
      if (products.length === 0) throw new AppError('INVENTORY_EMPTY');
      const productIds = products.map((p) => p.id);
      // Verrou consultatif : deux ouvertures simultanées ne peuvent pas se chevaucher.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7142002)`;
      const lots = await tx.lot.findMany({
        where: {
          productId: { in: productIds },
          ...(input.includeEmptyLots ? {} : { remainingQty: { gt: 0 } }),
        },
        select: { id: true, productId: true, remainingQty: true, unitCostHt: true },
        orderBy: [{ productId: 'asc' }, { id: 'asc' }],
      });
      if (lots.length === 0) throw new AppError('INVENTORY_EMPTY');
      const conflicts = await tx.inventoryLine.findMany({
        where: {
          productId: { in: [...new Set(lots.map((l) => l.productId))] },
          inventory: { status: 'COUNTING' },
        },
        select: { inventory: { select: { number: true } } },
        distinct: ['inventoryId'],
      });
      if (conflicts.length > 0) {
        throw new AppError('INVENTORY_ALREADY_OPEN', {
          inventories: conflicts.map((c) => c.inventory.number),
        });
      }
      const number = await this.sequences.next(tx, 'INV', at);
      const inventory = await tx.inventory.create({
        data: {
          number,
          siteId: actor.siteId,
          scope: input.scope,
          scopeLabel,
          status: 'COUNTING',
          notes: input.notes ?? null,
          startedById: actor.userId,
          startedAt: at,
        },
      });
      await tx.inventoryLine.createMany({
        data: lots.map((l) => ({
          inventoryId: inventory.id,
          productId: l.productId,
          lotId: l.id,
          snapshotQty: l.remainingQty,
          unitCostHt: l.unitCostHt,
        })),
      });
      await this.audit.record(tx, {
        eventType: 'INVENTORY_STARTED',
        actor,
        entityType: 'inventory',
        entityId: inventory.id,
        entityRef: number,
        summary: `Inventaire ${number} ouvert : ${scopeLabel} — ${lots.length} lot(s) à compter`,
        after: { scope: input.scope, lots: lots.length },
        notify: false,
      });
      return inventory.id;
    });
    return this.get(id, actor);
  }

  // -------------------------------------------------------------------------
  // Comptage
  // -------------------------------------------------------------------------

  private async lockOpenInventory(tx: Tx, id: string, forUpdate: boolean) {
    const rows = forUpdate
      ? await tx.$queryRaw<{ id: string; status: InventoryStatus; number: string }[]>`
          SELECT id, status, number FROM inventories WHERE id = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{ id: string; status: InventoryStatus; number: string }[]>`
          SELECT id, status, number FROM inventories WHERE id = ${id}::uuid FOR SHARE`;
    const inv = rows[0];
    if (!inv) throw new AppError('NOT_FOUND');
    if (inv.status !== 'COUNTING') throw new AppError('INVENTORY_NOT_OPEN');
    return inv;
  }

  /**
   * Saisie de comptages (plusieurs lignes, plusieurs postes en parallèle). Le théorique est celui
   * du lot au moment du comptage : les ventes faites pendant l'inventaire sont prises en compte.
   */
  async count(id: string, counts: { lineId: string; countedQty: number }[], actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const inv = await this.lockOpenInventory(tx, id, false);
      const lines = await tx.inventoryLine.findMany({
        where: { inventoryId: id, id: { in: counts.map((c) => c.lineId) } },
      });
      const lineById = new Map(lines.map((l) => [l.id, l]));
      for (const c of counts) if (!lineById.has(c.lineId)) throw new AppError('NOT_FOUND');
      const lots = await this.stock.lockLots(
        tx,
        lines.map((l) => l.lotId),
      );
      const at = now();
      const changed: { line: string; lot: string; from: number; to: number }[] = [];
      for (const c of counts) {
        const line = lineById.get(c.lineId)!;
        const lot = lots.get(line.lotId);
        if (!lot) throw new AppError('NOT_FOUND');
        const theoretical = lot.remaining_qty;
        await tx.inventoryLine.update({
          where: { id: line.id },
          data: {
            theoreticalAtCount: theoretical,
            countedQty: c.countedQty,
            difference: c.countedQty - theoretical,
            countedById: actor.userId,
            countedAt: at,
            countCount: { increment: 1 },
          },
        });
        if (line.countedQty !== null && line.countedQty !== c.countedQty) {
          changed.push({
            line: line.id,
            lot: lot.lot_number,
            from: line.countedQty,
            to: c.countedQty,
          });
        }
      }
      if (changed.length > 0) {
        await this.audit.record(tx, {
          eventType: 'INVENTORY_COUNT_CHANGED',
          actor,
          entityType: 'inventory',
          entityId: id,
          entityRef: inv.number,
          summary: `${changed.length} comptage(s) modifié(s) dans l’inventaire ${inv.number}`,
          metadata: { changed },
          notify: false,
        });
      }
      return { counted: counts.length };
    });
  }

  /** Ajoute un lot absent de la photographie (lot créé après l'ouverture) et le compte. */
  async addLot(id: string, input: { lotId: string; countedQty: number }, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const inv = await this.lockOpenInventory(tx, id, false);
      const record = await tx.inventory.findUniqueOrThrow({ where: { id } });
      const lots = await this.stock.lockLots(tx, [input.lotId]);
      const lot = lots.get(input.lotId);
      if (!lot) throw new AppError('NOT_FOUND');
      const inScope = await tx.product.count({
        where: { AND: [{ id: lot.product_id }, scopeWhere(record.scope as InventoryScope)] },
      });
      if (inScope === 0)
        throw new AppError('VALIDATION_ERROR', undefined, {
          message: 'Ce produit ne fait pas partie du périmètre de l’inventaire.',
        });
      const existing = await tx.inventoryLine.findUnique({
        where: { inventoryId_lotId: { inventoryId: id, lotId: input.lotId } },
      });
      if (existing)
        throw new AppError('CONFLICT', undefined, {
          message: 'Ce lot figure déjà dans l’inventaire.',
        });
      const at = now();
      await tx.inventoryLine.create({
        data: {
          inventoryId: id,
          productId: lot.product_id,
          lotId: lot.id,
          snapshotQty: lot.remaining_qty,
          theoreticalAtCount: lot.remaining_qty,
          countedQty: input.countedQty,
          difference: input.countedQty - lot.remaining_qty,
          unitCostHt: lot.unit_cost_ht,
          countedById: actor.userId,
          countedAt: at,
          countCount: 1,
        },
      });
      await this.audit.record(tx, {
        eventType: 'INVENTORY_COUNT_CHANGED',
        actor,
        entityType: 'inventory',
        entityId: id,
        entityRef: inv.number,
        summary: `Lot ${lot.lot_number} ajouté à l’inventaire ${inv.number} et compté (${input.countedQty})`,
        notify: false,
      });
      return { added: true };
    });
  }

  /** Fin de comptage : prévient l'administrateur que l'inventaire est prêt à valider. */
  async finishCounting(id: string, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const inv = await this.lockOpenInventory(tx, id, false);
      const [total, counted] = await Promise.all([
        tx.inventoryLine.count({ where: { inventoryId: id } }),
        tx.inventoryLine.count({ where: { inventoryId: id, countedQty: { not: null } } }),
      ]);
      await this.events.emit(tx, {
        eventType: 'INVENTORY_READY',
        severity: 'INFO',
        actorId: actor.userId,
        title: `Inventaire ${inv.number} prêt à valider`,
        body: `${counted} ligne(s) comptée(s) sur ${total} — comptage terminé par ${actor.userCode}.`,
        entityType: 'inventory',
        entityId: id,
        link: `/stock/inventories/${id}`,
        data: {
          userCode: actor.userCode,
          userName: actor.userName,
          entityRef: inv.number,
          uncounted: total - counted,
        },
      });
      return { total, counted };
    });
  }

  // -------------------------------------------------------------------------
  // Validation / annulation
  // -------------------------------------------------------------------------

  async validate(id: string, options: { ignoreUncounted: boolean }, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const inv = await this.lockOpenInventory(tx, id, true);
      const lines = await tx.inventoryLine.findMany({ where: { inventoryId: id } });
      const uncounted = lines.filter((l) => l.countedQty === null);
      if (uncounted.length > 0 && !options.ignoreUncounted)
        throw new AppError('INVENTORY_UNCOUNTED', { uncounted: uncounted.length });
      const adjusting = lines.filter((l) => l.difference !== null && l.difference !== 0);
      await this.stock.lockProducts(
        tx,
        adjusting.map((l) => l.productId),
      );
      const lots = await this.stock.lockLots(
        tx,
        adjusting.map((l) => l.lotId),
      );
      const at = now();
      const products = await tx.product.findMany({
        where: { id: { in: adjusting.map((l) => l.productId) } },
        select: { id: true, name: true },
      });
      const productName = new Map(products.map((p) => [p.id, p.name]));
      let plus = 0;
      let minus = 0;
      let value = 0;
      // Ordre déterministe : produit puis lot.
      const ordered = [...adjusting].sort((a, b) =>
        a.productId === b.productId
          ? a.lotId.localeCompare(b.lotId)
          : a.productId.localeCompare(b.productId),
      );
      for (const line of ordered) {
        const lot = lots.get(line.lotId);
        if (!lot) throw new AppError('NOT_FOUND');
        const diff = line.difference!;
        if (lot.remaining_qty + diff < 0) {
          throw new AppError(
            'CONFLICT',
            { lotId: lot.id, lotNumber: lot.lot_number },
            {
              message: `Le lot ${lot.lot_number} de ${productName.get(line.productId) ?? 'ce produit'} a été vendu depuis son comptage : recomptez-le avant de valider.`,
            },
          );
        }
        await this.stock.move(tx, {
          lot: { id: lot.id, product_id: lot.product_id, site_id: lot.site_id },
          type: 'INVENTORY_ADJUSTMENT',
          qty: diff,
          unitCostHt: lot.unit_cost_ht,
          documentType: 'INVENTORY',
          documentId: id,
          documentNumber: inv.number,
          reason: `Inventaire ${inv.number}`,
          actor,
          at,
        });
        if (diff > 0) plus += diff;
        else minus += -diff;
        value += diff * num(lot.unit_cost_ht);
      }
      await tx.inventory.update({
        where: { id },
        data: { status: 'VALIDATED', validatedById: actor.userId, validatedAt: at },
      });
      await this.audit.record(tx, {
        eventType: 'INVENTORY_VALIDATED',
        actor,
        entityType: 'inventory',
        entityId: id,
        entityRef: inv.number,
        summary: `Inventaire ${inv.number} validé : ${adjusting.length} lot(s) corrigé(s) (+${plus} / −${minus} unités, écart valorisé ${value / 1000} DT au coût)`,
        after: {
          lines: lines.length,
          uncounted: uncounted.length,
          adjusted: adjusting.length,
          unitsPlus: plus,
          unitsMinus: minus,
          valueAtCost: value,
        },
        notify: { data: { amount: Math.abs(value) } },
      });
    });
    return this.get(id, actor);
  }

  async cancel(id: string, reason: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const inv = await this.lockOpenInventory(tx, id, true);
      const current = await tx.inventory.findUniqueOrThrow({ where: { id } });
      await tx.inventory.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledById: actor.userId,
          cancelledAt: now(),
          notes: [current.notes, `Annulé : ${reason}`].filter(Boolean).join(' — '),
        },
      });
      await this.audit.record(tx, {
        eventType: 'INVENTORY_CANCELLED',
        actor,
        entityType: 'inventory',
        entityId: id,
        entityRef: inv.number,
        summary: `Inventaire ${inv.number} annulé (aucun ajustement de stock)`,
        reason,
        notify: false,
      });
    });
    return this.get(id, actor);
  }

  // -------------------------------------------------------------------------
  // Rapport des écarts (quantité et valeur), Excel et PDF
  // -------------------------------------------------------------------------

  private async reportData(id: string, onlyDifferences: boolean, actor: Actor) {
    const inv = await this.prisma.inventory.findUnique({ where: { id } });
    if (!inv) throw new AppError('NOT_FOUND');
    const costs = actor.permissions.has('catalog.view_costs');
    const lines = await this.prisma.inventoryLine.findMany({
      where: {
        inventoryId: id,
        ...(onlyDifferences ? { difference: { not: null, notIn: [0] } } : {}),
      },
    });
    const [products, lots, users] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
        select: productSelect,
      }),
      this.prisma.lot.findMany({
        where: { id: { in: lines.map((l) => l.lotId) } },
        select: lotSelect,
      }),
      this.userMap(lines.map((l) => l.countedById)),
    ]);
    const pById = new Map(products.map((p) => [p.id, p]));
    const lById = new Map(lots.map((l) => [l.id, l]));
    const rows = lines
      .map((l) => {
        const p = pById.get(l.productId)!;
        const lot = lById.get(l.lotId)!;
        const diff = l.difference;
        return {
          code: p.internalCode,
          product: productLabel(p),
          lot: lot.lotNumber,
          expiry: lot.expiryDate.toISOString().slice(0, 10),
          theoretical: l.theoreticalAtCount ?? l.snapshotQty,
          theoreticalLabel: formatStockQty(
            l.theoreticalAtCount ?? l.snapshotQty,
            p.unitsPerPack,
            p.sellByUnit,
          ),
          counted: l.countedQty,
          countedLabel:
            l.countedQty === null
              ? 'Non compté'
              : formatStockQty(l.countedQty, p.unitsPerPack, p.sellByUnit),
          difference: diff,
          differenceLabel:
            diff === null
              ? ''
              : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${formatStockQty(Math.abs(diff), p.unitsPerPack, p.sellByUnit)}`,
          value: costs && diff !== null ? diff * num(l.unitCostHt) : null,
          countedBy: l.countedById ? (users.get(l.countedById)?.code ?? '') : '',
        };
      })
      .sort((a, b) => a.product.localeCompare(b.product, 'fr') || a.lot.localeCompare(b.lot));
    const totalValue = costs ? rows.reduce((acc, r) => acc + (r.value ?? 0), 0) : null;
    return { inv, rows, totalValue, costs };
  }

  async reportExcel(id: string, onlyDifferences: boolean, actor: Actor): Promise<Buffer> {
    const { inv, rows, totalValue, costs } = await this.reportData(id, onlyDifferences, actor);
    return this.excel.build(
      {
        title: `Inventaire ${inv.number} — ${onlyDifferences ? 'écarts' : 'détail complet'}`,
        subtitle: [inv.scopeLabel],
        columns: [
          { key: 'code', header: 'Code', width: 12 },
          { key: 'product', header: 'Produit', width: 40 },
          { key: 'lot', header: 'Lot', width: 14 },
          { key: 'expiry', header: 'Péremption', width: 12 },
          { key: 'theoretical', header: 'Théorique (unités)', type: 'qty', width: 16 },
          { key: 'counted', header: 'Compté (unités)', type: 'qty', width: 16 },
          { key: 'difference', header: 'Écart (unités)', type: 'qty', width: 14 },
          ...(costs
            ? [
                {
                  key: 'value',
                  header: 'Valeur de l’écart (coût)',
                  type: 'money' as const,
                  width: 18,
                },
              ]
            : []),
          { key: 'countedBy', header: 'Compté par', width: 12 },
        ],
        rows,
        totals: costs ? { product: 'Total', value: totalValue } : undefined,
      },
      actor,
    );
  }

  async reportPdf(id: string, onlyDifferences: boolean, actor: Actor): Promise<Buffer> {
    const { inv, rows, totalValue, costs } = await this.reportData(id, onlyDifferences, actor);
    const s = await this.settings.all();
    const money = (v: number) =>
      formatMoney(v, {
        currency: s['general.currency_code'],
        decimals: s['general.currency_decimals'],
      });
    const users = await this.userMap([inv.startedById, inv.validatedById]);
    return this.documents.formPdf(
      {
        title: 'Rapport d’inventaire',
        number: inv.number,
        meta: [
          `Ouvert le ${formatDateTime(inv.startedAt, s['general.timezone'])}`,
          inv.validatedAt
            ? `Validé le ${formatDateTime(inv.validatedAt, s['general.timezone'])}`
            : inv.status === 'CANCELLED'
              ? 'ANNULÉ'
              : 'En cours de comptage',
        ],
        info: [
          { label: 'Périmètre', value: inv.scopeLabel },
          { label: 'Ouvert par', value: users.get(inv.startedById)?.code ?? '' },
          ...(inv.validatedById
            ? [{ label: 'Validé par', value: users.get(inv.validatedById)?.code ?? '' }]
            : []),
        ],
        columns: [
          { key: 'product', header: 'Produit', width: '*' },
          { key: 'lot', header: 'Lot' },
          { key: 'expiry', header: 'Péremption' },
          { key: 'theoreticalLabel', header: 'Théorique', align: 'right' },
          { key: 'countedLabel', header: 'Compté', align: 'right' },
          { key: 'differenceLabel', header: 'Écart', align: 'right' },
          ...(costs ? [{ key: 'valueLabel', header: 'Valeur', align: 'right' as const }] : []),
        ],
        rows: rows.map((r) => ({ ...r, valueLabel: r.value === null ? '' : money(r.value) })),
        totals:
          costs && totalValue !== null
            ? [{ label: 'Écart total valorisé au coût', value: money(totalValue) }]
            : [],
        signatures: ['Responsable du comptage', 'Pharmacien / Administrateur'],
        landscape: true,
      },
      actor,
    );
  }
}
