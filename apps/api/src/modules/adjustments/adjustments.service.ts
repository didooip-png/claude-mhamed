import { Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_TYPES,
  formatDateTime,
  formatMoney,
  formatStockQty,
  productLabel,
  todayIso,
  type AdjustmentType,
  type PaginationQuery,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import type { AdjustmentStatus, Prisma, StockMovementType } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockService } from '../stock/stock.service.js';

export interface AdjustmentInput {
  type: AdjustmentType;
  reason: string;
  lines: { lotId: string; qty: number }[];
  validateNow: boolean;
}

const MOVEMENT_TYPE: Record<AdjustmentType, StockMovementType> = {
  LOSS: 'LOSS',
  BREAKAGE: 'BREAKAGE',
  EXPIRED_DESTRUCTION: 'EXPIRED_DESTRUCTION',
  CORRECTION: 'CORRECTION',
};

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Ajustements de stock hors inventaire (§6.12) : perte, casse, destruction de périmés,
 * correction. Un préparateur déclare (PENDING) ; l'administrateur valide (numéro AJ-…, mouvements)
 * ou rejette. Motif obligatoire, procès-verbal imprimable.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly documents: DocumentsService,
  ) {}

  private canSeeAll(actor: Actor) {
    return actor.permissions.has('adjustments.validate');
  }

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  private async userMap(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, code: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async list(
    q: PaginationQuery & {
      status?: AdjustmentStatus;
      type?: AdjustmentType;
      from?: string;
      to?: string;
    },
    actor: Actor,
  ) {
    const where: Prisma.StockAdjustmentWhereInput = {
      ...(this.canSeeAll(actor) ? {} : { createdById: actor.userId }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { reason: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { lines: true } } },
        ...pageArgs(q),
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);
    const users = await this.userMap(rows.flatMap((r) => [r.createdById, r.validatedById]));
    return paginated(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        reason: r.reason,
        lineCount: r._count.lines,
        createdAt: r.createdAt,
        createdBy: users.get(r.createdById) ?? null,
        validatedAt: r.validatedAt,
        validatedBy: r.validatedById ? (users.get(r.validatedById) ?? null) : null,
      })),
      total,
      q,
    );
  }

  async get(id: string, actor: Actor) {
    const adj = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!adj || (!this.canSeeAll(actor) && adj.createdById !== actor.userId))
      throw new AppError('NOT_FOUND');
    const costs = actor.permissions.has('catalog.view_costs');
    const [products, lots, users] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: adj.lines.map((l) => l.productId) } },
        select: {
          id: true,
          internalCode: true,
          name: true,
          dosage: true,
          form: true,
          unitsPerPack: true,
          sellByUnit: true,
        },
      }),
      this.prisma.lot.findMany({
        where: { id: { in: adj.lines.map((l) => l.lotId) } },
        select: {
          id: true,
          lotNumber: true,
          expiryDate: true,
          remainingQty: true,
          status: true,
        },
      }),
      this.userMap([adj.createdById, adj.validatedById]),
    ]);
    const pById = new Map(products.map((p) => [p.id, p]));
    const lById = new Map(lots.map((l) => [l.id, l]));
    return {
      id: adj.id,
      number: adj.number,
      type: adj.type,
      status: adj.status,
      reason: adj.reason,
      rejectedReason: adj.rejectedReason,
      createdAt: adj.createdAt,
      createdBy: users.get(adj.createdById) ?? null,
      validatedAt: adj.validatedAt,
      validatedBy: adj.validatedById ? (users.get(adj.validatedById) ?? null) : null,
      lines: adj.lines.map((l) => {
        const lot = lById.get(l.lotId);
        return {
          id: l.id,
          qty: l.qty,
          product: pById.get(l.productId) ?? null,
          lot: lot
            ? {
                id: lot.id,
                lotNumber: lot.lotNumber,
                expiryDate: isoOf(lot.expiryDate),
                remainingQty: lot.remainingQty,
                status: lot.status,
              }
            : null,
          unitCostHt: costs ? num(l.unitCostHt) : null,
          valueAtCost: costs ? l.qty * num(l.unitCostHt) : null,
        };
      }),
      totalValueAtCost: costs
        ? adj.lines.reduce((acc, l) => acc + l.qty * num(l.unitCostHt), 0)
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Création
  // -------------------------------------------------------------------------

  async create(input: AdjustmentInput, actor: Actor) {
    if (input.validateNow && !actor.permissions.has('adjustments.validate')) {
      throw new AppError('FORBIDDEN', { permissions: ['adjustments.validate'] });
    }
    const id = await this.prisma.tx(async (tx) => {
      const lots = await this.stock.lockLots(
        tx,
        input.lines.map((l) => l.lotId),
      );
      const settings = await this.settings.all(tx);
      const today = todayIso(settings['general.timezone'], now());
      const negative = input.type !== 'CORRECTION';
      const lines: { lotId: string; productId: string; qty: number; unitCostHt: bigint }[] = [];
      for (const line of input.lines) {
        const lot = lots.get(line.lotId);
        if (!lot) throw new AppError('LOT_NOT_FOUND');
        const signed = negative ? -line.qty : line.qty;
        if (signed < 0 && lot.remaining_qty + signed < 0) {
          throw new AppError(
            'STOCK_INSUFFICIENT',
            { lotId: lot.id, lotNumber: lot.lot_number, available: lot.remaining_qty },
            {
              message: `Le lot ${lot.lot_number} ne contient que ${lot.remaining_qty} unité(s).`,
            },
          );
        }
        if (
          input.type === 'EXPIRED_DESTRUCTION' &&
          isoOf(lot.expiry_date) > today &&
          lot.status !== 'BLOCKED' &&
          lot.status !== 'QUARANTINE'
        ) {
          throw new AppError('LOT_NOT_EXPIRED', {
            lotId: lot.id,
            lotNumber: lot.lot_number,
            expiryDate: isoOf(lot.expiry_date),
          });
        }
        lines.push({
          lotId: lot.id,
          productId: lot.product_id,
          qty: signed,
          unitCostHt: lot.unit_cost_ht,
        });
      }
      const adjustment = await tx.stockAdjustment.create({
        data: {
          siteId: actor.siteId,
          type: input.type,
          status: 'PENDING',
          reason: input.reason,
          deviceId: actor.deviceId,
          createdById: actor.userId,
          createdAt: now(),
          lines: { create: lines },
        },
      });
      const units = lines.reduce((acc, l) => acc + Math.abs(l.qty), 0);
      await this.audit.record(tx, {
        eventType: 'ADJUSTMENT_DECLARED',
        actor,
        entityType: 'adjustment',
        entityId: adjustment.id,
        entityRef: ADJUSTMENT_TYPES[input.type],
        summary: `${ADJUSTMENT_TYPES[input.type]} déclarée : ${lines.length} lot(s), ${units} unité(s) — ${input.reason}`,
        reason: input.reason,
        after: { type: input.type, lines },
        notify: input.validateNow
          ? false
          : {
              link: `/stock/adjustments/${adjustment.id}`,
              data: {
                amount: lines.reduce((acc, l) => acc + Math.abs(l.qty) * num(l.unitCostHt), 0),
              },
            },
      });
      if (input.validateNow) await this.validateInTx(tx, adjustment.id, actor);
      return adjustment.id;
    });
    return this.get(id, actor);
  }

  // -------------------------------------------------------------------------
  // Validation / rejet
  // -------------------------------------------------------------------------

  private async validateInTx(tx: Tx, id: string, actor: Actor) {
    const locked = await tx.$queryRaw<{ id: string; status: AdjustmentStatus }[]>`
      SELECT id, status FROM stock_adjustments WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new AppError('NOT_FOUND');
    if (locked[0]!.status !== 'PENDING') throw new AppError('ADJUSTMENT_NOT_PENDING');
    const adj = await tx.stockAdjustment.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });
    const at = now();
    await this.stock.lockProducts(
      tx,
      adj.lines.map((l) => l.productId),
    );
    const lots = await this.stock.lockLots(
      tx,
      adj.lines.map((l) => l.lotId),
    );
    const number = await this.sequences.next(tx, 'AJ', at);
    const ordered = [...adj.lines].sort((a, b) =>
      a.productId === b.productId
        ? a.lotId.localeCompare(b.lotId)
        : a.productId.localeCompare(b.productId),
    );
    let value = 0;
    let units = 0;
    for (const line of ordered) {
      const lot = lots.get(line.lotId);
      if (!lot) throw new AppError('LOT_NOT_FOUND');
      if (lot.remaining_qty + line.qty < 0) {
        throw new AppError(
          'STOCK_INSUFFICIENT',
          { lotId: lot.id, lotNumber: lot.lot_number, available: lot.remaining_qty },
          {
            message: `Le lot ${lot.lot_number} ne contient plus que ${lot.remaining_qty} unité(s) : ajustement impossible.`,
          },
        );
      }
      await this.stock.move(tx, {
        lot: { id: lot.id, product_id: lot.product_id, site_id: lot.site_id },
        type: MOVEMENT_TYPE[adj.type],
        qty: line.qty,
        unitCostHt: line.unitCostHt,
        documentType: 'ADJUSTMENT',
        documentId: adj.id,
        documentNumber: number,
        reason: adj.reason,
        actor,
        at,
      });
      value += line.qty * num(line.unitCostHt);
      units += Math.abs(line.qty);
    }
    await tx.stockAdjustment.update({
      where: { id },
      data: { status: 'VALIDATED', number, validatedById: actor.userId, validatedAt: at },
    });
    const destruction = adj.type === 'EXPIRED_DESTRUCTION';
    await this.audit.record(tx, {
      eventType: destruction ? 'DESTRUCTION' : 'STOCK_ADJUSTMENT',
      actor,
      entityType: 'adjustment',
      entityId: id,
      entityRef: number,
      summary: `${ADJUSTMENT_TYPES[adj.type]} ${number} validée : ${adj.lines.length} lot(s), ${units} unité(s), valeur ${Math.abs(value) / 1000} DT au coût — ${adj.reason}`,
      reason: adj.reason,
      after: { type: adj.type, units, valueAtCost: value },
      notify: { link: `/stock/adjustments/${id}`, data: { amount: Math.abs(value) } },
    });
    return number;
  }

  async validate(id: string, actor: Actor) {
    await this.prisma.tx((tx) => this.validateInTx(tx, id, actor));
    return this.get(id, actor);
  }

  async reject(id: string, reason: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: AdjustmentStatus }[]>`
        SELECT id, status FROM stock_adjustments WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new AppError('NOT_FOUND');
      if (locked[0]!.status !== 'PENDING') throw new AppError('ADJUSTMENT_NOT_PENDING');
      const adj = await tx.stockAdjustment.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedReason: reason,
          validatedById: actor.userId,
          validatedAt: now(),
        },
      });
      await this.audit.record(tx, {
        eventType: 'ADJUSTMENT_REJECTED',
        actor,
        entityType: 'adjustment',
        entityId: id,
        entityRef: ADJUSTMENT_TYPES[adj.type],
        summary: `${ADJUSTMENT_TYPES[adj.type]} rejetée : ${adj.reason}`,
        reason,
        notify: false,
      });
    });
    return this.get(id, actor);
  }

  // -------------------------------------------------------------------------
  // Document imprimable (procès-verbal de destruction / bon d'ajustement)
  // -------------------------------------------------------------------------

  async pdf(id: string, actor: Actor): Promise<Buffer> {
    const adj = await this.get(id, actor);
    const s = await this.settings.all();
    const money = (v: number) =>
      formatMoney(v, {
        currency: s['general.currency_code'],
        decimals: s['general.currency_decimals'],
      });
    const destruction = adj.type === 'EXPIRED_DESTRUCTION';
    const costs = adj.totalValueAtCost !== null;
    return this.documents.formPdf(
      {
        title: destruction ? 'Procès-verbal de destruction' : 'Bon d’ajustement de stock',
        number: adj.number ?? 'EN ATTENTE DE VALIDATION',
        meta: [
          `Déclaré le ${formatDateTime(adj.createdAt, s['general.timezone'])} par ${adj.createdBy?.code ?? ''}`,
          adj.validatedAt
            ? `${adj.status === 'REJECTED' ? 'Rejeté' : 'Validé'} le ${formatDateTime(adj.validatedAt, s['general.timezone'])} par ${adj.validatedBy?.code ?? ''}`
            : 'Non validé',
        ],
        info: [
          { label: 'Nature', value: ADJUSTMENT_TYPES[adj.type] },
          { label: 'Motif', value: adj.reason },
          ...(adj.rejectedReason ? [{ label: 'Motif du rejet', value: adj.rejectedReason }] : []),
        ],
        columns: [
          { key: 'product', header: 'Produit', width: '*' },
          { key: 'lot', header: 'Lot' },
          { key: 'expiry', header: 'Péremption' },
          { key: 'qty', header: 'Quantité', align: 'right' },
          ...(costs ? [{ key: 'value', header: 'Valeur (coût)', align: 'right' as const }] : []),
        ],
        rows: adj.lines.map((l) => ({
          product: l.product ? productLabel(l.product) : '',
          lot: l.lot?.lotNumber ?? '',
          expiry: l.lot?.expiryDate ?? '',
          qty: l.product
            ? `${l.qty > 0 ? '+' : '−'}${formatStockQty(Math.abs(l.qty), l.product.unitsPerPack, l.product.sellByUnit)}`
            : String(l.qty),
          value: l.valueAtCost === null ? '' : money(l.valueAtCost),
        })),
        totals: costs
          ? [{ label: 'Valeur totale au coût', value: money(adj.totalValueAtCost!) }]
          : [],
        notes: destruction
          ? [
              'Les produits ci-dessus, périmés ou impropres à la vente, ont été retirés du stock et détruits conformément à la réglementation en vigueur.',
            ]
          : [],
        signatures: destruction
          ? ['Le pharmacien', 'Témoin', 'Autorité (le cas échéant)']
          : ['Déclarant', 'Validation'],
      },
      actor,
    );
  }
}
