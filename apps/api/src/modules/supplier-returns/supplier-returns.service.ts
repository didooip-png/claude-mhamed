import { Injectable } from '@nestjs/common';
import {
  formatDateTime,
  formatMoney,
  formatStockQty,
  productLabel,
  type PaginationQuery,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import type { Prisma, SupplierReturnStatus } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockService } from '../stock/stock.service.js';

export interface SupplierReturnInput {
  supplierId: string;
  reason: string;
  notes?: string;
  lines: { lotId: string; qty: number; reason: string }[];
}

/**
 * Retours fournisseurs (§6.13) : sortie de lots vers un fournisseur (périmés, défectueux, erreur
 * de livraison, rappel), numéro RF-…, mouvement SUPPLIER_RETURN_OUT, bon de retour imprimable,
 * suivi de l'avoir fournisseur (en attente / reçu).
 */
@Injectable()
export class SupplierReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly documents: DocumentsService,
  ) {}

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
      status?: SupplierReturnStatus;
      supplierId?: string;
      from?: string;
      to?: string;
    },
  ) {
    const where: Prisma.SupplierReturnWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
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
              { creditReference: { contains: q.q, mode: 'insensitive' } },
              { supplier: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total, pending] = await Promise.all([
      this.prisma.supplierReturn.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
        ...pageArgs(q),
      }),
      this.prisma.supplierReturn.count({ where }),
      this.prisma.supplierReturn.aggregate({
        where: { status: 'PENDING_CREDIT' },
        _sum: { totalHt: true },
        _count: true,
      }),
    ]);
    const users = await this.userMap(rows.map((r) => r.createdById));
    return {
      ...paginated(
        rows.map((r) => ({
          id: r.id,
          number: r.number,
          status: r.status,
          supplier: r.supplier,
          reason: r.reason,
          totalHt: num(r.totalHt),
          creditAmount: r.creditAmount === null ? null : num(r.creditAmount),
          creditReference: r.creditReference,
          lineCount: r._count.lines,
          createdAt: r.createdAt,
          createdBy: users.get(r.createdById) ?? null,
        })),
        total,
        q,
      ),
      pendingCredit: { count: pending._count, totalHt: num(pending._sum.totalHt ?? 0) },
    };
  }

  async get(id: string) {
    const ret = await this.prisma.supplierReturn.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, code: true, name: true, phone: true, email: true } },
        lines: true,
      },
    });
    if (!ret) throw new AppError('NOT_FOUND');
    const [products, lots, users] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: ret.lines.map((l) => l.productId) } },
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
        where: { id: { in: ret.lines.map((l) => l.lotId) } },
        select: { id: true, lotNumber: true, expiryDate: true },
      }),
      this.userMap([ret.createdById]),
    ]);
    const pById = new Map(products.map((p) => [p.id, p]));
    const lById = new Map(lots.map((l) => [l.id, l]));
    return {
      id: ret.id,
      number: ret.number,
      status: ret.status,
      supplier: ret.supplier,
      reason: ret.reason,
      notes: ret.notes,
      totalHt: num(ret.totalHt),
      creditAmount: ret.creditAmount === null ? null : num(ret.creditAmount),
      creditReceivedAt: ret.creditReceivedAt,
      creditReference: ret.creditReference,
      createdAt: ret.createdAt,
      createdBy: users.get(ret.createdById) ?? null,
      lines: ret.lines.map((l) => ({
        id: l.id,
        qty: l.qty,
        unitCostHt: num(l.unitCostHt),
        amountHt: l.qty * num(l.unitCostHt),
        reason: l.reason,
        product: pById.get(l.productId) ?? null,
        lot: lById.get(l.lotId)
          ? {
              id: l.lotId,
              lotNumber: lById.get(l.lotId)!.lotNumber,
              expiryDate: lById.get(l.lotId)!.expiryDate.toISOString().slice(0, 10),
            }
          : null,
      })),
    };
  }

  async create(input: SupplierReturnInput, actor: Actor) {
    const id = await this.prisma.tx(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new AppError('NOT_FOUND');
      const raw = await tx.lot.findMany({
        where: { id: { in: input.lines.map((l) => l.lotId) } },
        select: { id: true, productId: true, supplierId: true },
      });
      if (raw.length !== input.lines.length) throw new AppError('LOT_NOT_FOUND');
      await this.stock.lockProducts(
        tx,
        raw.map((l) => l.productId),
      );
      const lots = await this.stock.lockLots(
        tx,
        raw.map((l) => l.id),
      );
      const supplierOf = new Map(raw.map((l) => [l.id, l.supplierId]));
      const at = now();
      const number = await this.sequences.next(tx, 'RF', at);
      let totalHt = 0;
      const created = await tx.supplierReturn.create({
        data: {
          number,
          siteId: actor.siteId,
          supplierId: supplier.id,
          status: 'PENDING_CREDIT',
          reason: input.reason,
          totalHt: 0n,
          notes: input.notes ?? null,
          deviceId: actor.deviceId,
          createdById: actor.userId,
          createdAt: at,
        },
      });
      const ordered = [...input.lines].sort((a, b) => a.lotId.localeCompare(b.lotId));
      for (const line of ordered) {
        const lot = lots.get(line.lotId);
        if (!lot) throw new AppError('LOT_NOT_FOUND');
        const lotSupplier = supplierOf.get(lot.id);
        if (lotSupplier && lotSupplier !== supplier.id) {
          throw new AppError(
            'LOT_SUPPLIER_MISMATCH',
            { lotNumber: lot.lot_number },
            { message: `Le lot ${lot.lot_number} n’a pas été fourni par ${supplier.name}.` },
          );
        }
        if (line.qty > lot.remaining_qty) {
          throw new AppError(
            'STOCK_INSUFFICIENT',
            { lotId: lot.id, lotNumber: lot.lot_number, available: lot.remaining_qty },
            { message: `Le lot ${lot.lot_number} ne contient que ${lot.remaining_qty} unité(s).` },
          );
        }
        await tx.supplierReturnLine.create({
          data: {
            returnId: created.id,
            lotId: lot.id,
            productId: lot.product_id,
            qty: line.qty,
            unitCostHt: lot.unit_cost_ht,
            reason: line.reason,
          },
        });
        await this.stock.move(tx, {
          lot: { id: lot.id, product_id: lot.product_id, site_id: lot.site_id },
          type: 'SUPPLIER_RETURN_OUT',
          qty: -line.qty,
          unitCostHt: lot.unit_cost_ht,
          documentType: 'SUPPLIER_RETURN',
          documentId: created.id,
          documentNumber: number,
          counterpartType: 'SUPPLIER',
          counterpartId: supplier.id,
          counterpartName: supplier.name,
          reason: line.reason,
          actor,
          at,
        });
        totalHt += line.qty * num(lot.unit_cost_ht);
      }
      await tx.supplierReturn.update({
        where: { id: created.id },
        data: { totalHt: BigInt(totalHt) },
      });
      await this.audit.record(tx, {
        eventType: 'SUPPLIER_RETURN',
        actor,
        entityType: 'supplier_return',
        entityId: created.id,
        entityRef: number,
        summary: `Retour fournisseur ${number} à ${supplier.name} : ${input.lines.length} lot(s), ${totalHt / 1000} DT HT au coût — ${input.reason}`,
        reason: input.reason,
        after: { supplier: supplier.name, totalHt },
        notify: { link: `/stock/supplier-returns/${created.id}`, data: { amount: totalHt } },
      });
      return created.id;
    });
    return this.get(id);
  }

  private async lockReturn(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string; status: SupplierReturnStatus }[]>`
      SELECT id, status FROM supplier_returns WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new AppError('NOT_FOUND');
    if (rows[0]!.status !== 'PENDING_CREDIT') throw new AppError('SUPPLIER_RETURN_NOT_PENDING');
  }

  /** Enregistre l'avoir reçu du fournisseur. */
  async recordCredit(
    id: string,
    input: { amount: number; reference: string; receivedAt?: string },
    actor: Actor,
  ) {
    await this.prisma.tx(async (tx) => {
      await this.lockReturn(tx, id);
      const ret = await tx.supplierReturn.update({
        where: { id },
        data: {
          status: 'CREDIT_RECEIVED',
          creditAmount: BigInt(input.amount),
          creditReference: input.reference,
          creditReceivedAt: input.receivedAt ? new Date(`${input.receivedAt}T12:00:00Z`) : now(),
        },
      });
      await this.audit.record(tx, {
        eventType: 'SUPPLIER_CREDIT_RECEIVED',
        actor,
        entityType: 'supplier_return',
        entityId: id,
        entityRef: ret.number,
        summary: `Avoir fournisseur ${input.reference} reçu pour le retour ${ret.number} : ${input.amount / 1000} DT (retour : ${num(ret.totalHt) / 1000} DT HT)`,
        after: { amount: input.amount, reference: input.reference },
        notify: false,
      });
    });
    return this.get(id);
  }

  /** Annule un retour non encore crédité : les lots sont réintégrés (mouvement de correction). */
  async cancel(id: string, reason: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      await this.lockReturn(tx, id);
      const ret = await tx.supplierReturn.findUniqueOrThrow({
        where: { id },
        include: { lines: true, supplier: true },
      });
      await this.stock.lockProducts(
        tx,
        ret.lines.map((l) => l.productId),
      );
      const lots = await this.stock.lockLots(
        tx,
        ret.lines.map((l) => l.lotId),
      );
      const at = now();
      for (const line of [...ret.lines].sort((a, b) => a.lotId.localeCompare(b.lotId))) {
        const lot = lots.get(line.lotId);
        if (!lot) throw new AppError('LOT_NOT_FOUND');
        await this.stock.move(tx, {
          lot: { id: lot.id, product_id: lot.product_id, site_id: lot.site_id },
          type: 'CORRECTION',
          qty: line.qty,
          unitCostHt: line.unitCostHt,
          documentType: 'SUPPLIER_RETURN',
          documentId: ret.id,
          documentNumber: ret.number,
          counterpartType: 'SUPPLIER',
          counterpartId: ret.supplierId,
          counterpartName: ret.supplier.name,
          reason: `Annulation du retour ${ret.number} : ${reason}`,
          actor,
          at,
        });
      }
      await tx.supplierReturn.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        eventType: 'SUPPLIER_RETURN_CANCELLED',
        actor,
        entityType: 'supplier_return',
        entityId: id,
        entityRef: ret.number,
        summary: `Retour fournisseur ${ret.number} annulé : ${ret.lines.length} lot(s) réintégré(s) au stock`,
        reason,
        notify: false,
      });
    });
    return this.get(id);
  }

  async pdf(id: string, actor: Actor): Promise<Buffer> {
    const ret = await this.get(id);
    const s = await this.settings.all();
    const money = (v: number) =>
      formatMoney(v, {
        currency: s['general.currency_code'],
        decimals: s['general.currency_decimals'],
      });
    return this.documents.formPdf(
      {
        title: 'Bon de retour fournisseur',
        number: ret.number,
        meta: [
          `Le ${formatDateTime(ret.createdAt, s['general.timezone'])} par ${ret.createdBy?.code ?? ''}`,
          ...(ret.status === 'CANCELLED' ? ['ANNULÉ'] : []),
        ],
        info: [
          { label: 'Fournisseur', value: `${ret.supplier.name} (${ret.supplier.code})` },
          ...(ret.supplier.phone ? [{ label: 'Téléphone', value: ret.supplier.phone }] : []),
          { label: 'Motif', value: ret.reason },
          ...(ret.notes ? [{ label: 'Remarques', value: ret.notes }] : []),
        ],
        columns: [
          { key: 'product', header: 'Produit', width: '*' },
          { key: 'lot', header: 'Lot' },
          { key: 'expiry', header: 'Péremption' },
          { key: 'qty', header: 'Quantité', align: 'right' },
          { key: 'unit', header: 'Coût unit. HT', align: 'right' },
          { key: 'amount', header: 'Montant HT', align: 'right' },
          { key: 'reason', header: 'Motif' },
        ],
        rows: ret.lines.map((l) => ({
          product: l.product ? productLabel(l.product) : '',
          lot: l.lot?.lotNumber ?? '',
          expiry: l.lot?.expiryDate ?? '',
          qty: l.product
            ? formatStockQty(l.qty, l.product.unitsPerPack, l.product.sellByUnit)
            : String(l.qty),
          unit: money(l.unitCostHt),
          amount: money(l.amountHt),
          reason: l.reason,
        })),
        totals: [{ label: 'Total HT', value: money(ret.totalHt) }],
        notes: [
          'Avoir fournisseur attendu : à rapprocher du présent bon de retour à sa réception.',
        ],
        signatures: ['Pharmacie', 'Fournisseur / transporteur'],
        landscape: true,
      },
      actor,
    );
  }
}
