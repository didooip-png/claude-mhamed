import { Injectable } from '@nestjs/common';
import {
  addMonthsIso,
  formatIsoDate,
  mulDivRound,
  priceReceiptLine,
  receiptSchema,
  sum,
  todayIso,
  type PaginationQuery,
} from '@pharmastock/shared';
import type { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import type { Prisma, ReceiptStatus } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockService } from '../stock/stock.service.js';

type ReceiptData = z.output<typeof receiptSchema>;

export interface ReceiptWarning {
  line: number;
  productName: string;
  kind: 'EXPIRY_SOON' | 'PRICE_VARIANCE' | 'ORDER_OVERRUN' | 'NOT_ORDERED';
  message: string;
}

const detailInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  attachment: { select: { id: true, filename: true, mime: true, size: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          internalCode: true,
          name: true,
          dosage: true,
          form: true,
          unitsPerPack: true,
          sellByUnit: true,
          refPurchasePriceHt: true,
        },
      },
      lot: { select: { id: true, remainingQty: true, initialQty: true, status: true } },
    },
  },
} satisfies Prisma.PurchaseReceiptInclude;

const toDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const isoOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Bons de réception (entrées en stock, §6.3) : brouillon modifiable → validation (lots +
 * mouvements PURCHASE_IN + numéro REC-AAAA-NNNNNN) → annulation administrateur (RG-15).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  async list(
    q: PaginationQuery & { status?: string; supplierId?: string; from?: string; to?: string },
  ) {
    const where: Prisma.PurchaseReceiptWhereInput = {
      ...(q.status ? { status: q.status as ReceiptStatus } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.from || q.to
        ? {
            receivedAt: {
              ...(q.from ? { gte: toDate(q.from)! } : {}),
              ...(q.to ? { lte: toDate(q.to)! } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { supplierInvoiceRef: { contains: q.q, mode: 'insensitive' } },
              { supplier: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.purchaseReceipt.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        ...pageArgs(q),
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.purchaseReceipt.count({ where }),
    ]);
    const userIds = [
      ...new Set(
        items.flatMap((r) => [r.createdById, r.validatedById].filter((x): x is string => !!x)),
      ),
    ];
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, code: true },
        })
      ).map((u) => [u.id, u.code]),
    );
    return paginated(
      items.map((r) => ({
        ...r,
        createdByCode: users.get(r.createdById) ?? null,
        validatedByCode: r.validatedById ? (users.get(r.validatedById) ?? null) : null,
      })),
      total,
      q,
    );
  }

  async get(id: string) {
    const receipt = await this.prisma.purchaseReceipt.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!receipt) throw new AppError('NOT_FOUND');
    const userIds = [receipt.createdById, receipt.validatedById, receipt.cancelledById].filter(
      (x): x is string => !!x,
    );
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, code: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      ...receipt,
      createdBy: byId.get(receipt.createdById) ?? null,
      validatedBy: receipt.validatedById ? (byId.get(receipt.validatedById) ?? null) : null,
      cancelledBy: receipt.cancelledById ? (byId.get(receipt.cancelledById) ?? null) : null,
      warnings:
        receipt.status === 'DRAFT'
          ? [
              ...(await this.warnings(
                receipt.lines.map((l) => ({ ...l, expiryDate: isoOf(l.expiryDate)! })),
              )),
              ...(receipt.purchaseOrderId
                ? await this.orders.warnings(
                    this.prisma,
                    receipt.purchaseOrderId,
                    receipt.lines.map((l) => ({
                      productId: l.productId,
                      qty: l.qty,
                      productName: l.product.name,
                    })),
                  )
                : []),
            ]
          : [],
    };
  }

  /** Contrôles bloquants (péremption passée) et avertissements (péremption proche, écart de prix). */
  private async warnings(
    lines: {
      productId: string;
      expiryDate: string;
      unitPriceHt: bigint | number;
      discountBp: number;
      product?: { name: string; refPurchasePriceHt: bigint };
    }[],
    tx?: Tx,
  ): Promise<ReceiptWarning[]> {
    const settings = await this.settings.all(tx);
    const today = todayIso(settings['general.timezone'], now());
    const soonLimit = addMonthsIso(today, settings['stock.receipt_expiry_warning_months']);
    const variancePct = settings['stock.receipt_price_variance_pct'];
    const client = tx ?? this.prisma;
    const out: ReceiptWarning[] = [];
    for (const [i, line] of lines.entries()) {
      const product =
        line.product ??
        (await client.product.findUnique({
          where: { id: line.productId },
          select: { name: true, refPurchasePriceHt: true },
        }));
      if (!product) continue;
      if (line.expiryDate > today && line.expiryDate < soonLimit) {
        out.push({
          line: i + 1,
          productName: product.name,
          kind: 'EXPIRY_SOON',
          message: `Péremption proche (${formatIsoDate(line.expiryDate)}) : moins de ${settings['stock.receipt_expiry_warning_months']} mois`,
        });
      }
      // Référence : dernier coût d'achat réel, à défaut le prix d'achat de référence du produit.
      const lastLot = await client.purchaseReceiptLine.findFirst({
        where: { productId: line.productId, receipt: { status: 'VALIDATED' } },
        orderBy: { receipt: { validatedAt: 'desc' } },
        select: { unitPriceHt: true, discountBp: true },
      });
      const net = (price: bigint | number, bp: number) => (Number(price) * (10_000 - bp)) / 10_000;
      const reference = lastLot
        ? net(lastLot.unitPriceHt, lastLot.discountBp)
        : Number(product.refPurchasePriceHt);
      const current = net(line.unitPriceHt, line.discountBp);
      if (reference > 0 && Math.abs(current - reference) / reference > variancePct / 100) {
        const pct = Math.round(((current - reference) / reference) * 100);
        out.push({
          line: i + 1,
          productName: product.name,
          kind: 'PRICE_VARIANCE',
          message: `Prix d’achat ${pct > 0 ? '+' : ''}${pct} % par rapport au dernier prix (${(reference / 1000).toFixed(3).replace('.', ',')} DT)`,
        });
      }
    }
    return out;
  }

  private async assertSource(tx: Tx, data: ReceiptData): Promise<void> {
    if (data.supplierId) {
      const supplier = await tx.supplier.findUnique({ where: { id: data.supplierId } });
      if (!supplier)
        throw new AppError('VALIDATION_ERROR', {
          fieldErrors: { supplierId: 'Fournisseur inconnu' },
        });
    }
    if (data.sourceType === 'SUPPLIER' && !data.supplierId) throw new AppError('SUPPLIER_REQUIRED');
    if (data.purchaseOrderId)
      await this.orders.assertReceivable(tx, data.purchaseOrderId, data.supplierId);
    const productIds = [...new Set(data.lines.map((l) => l.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, isActive: true, name: true },
    });
    const missing = productIds.filter((id) => !products.some((p) => p.id === id));
    if (missing.length > 0)
      throw new AppError('VALIDATION_ERROR', { fieldErrors: { lines: 'Produit inconnu' } });
  }

  private lineRows(data: ReceiptData) {
    return data.lines.map((l, i) => {
      const priced = priceReceiptLine({
        qty: l.qty,
        freeQty: l.freeQty,
        unitPriceHt: l.unitPriceHt,
        discountBp: l.discountBp,
        tvaBp: l.tvaRateBp,
      });
      return {
        lineNo: i + 1,
        productId: l.productId,
        lotNumber: l.lotNumber.trim(),
        expiryDate: toDate(l.expiryDate)!,
        qty: l.qty,
        freeQty: l.freeQty,
        unitPriceHt: BigInt(l.unitPriceHt),
        discountBp: l.discountBp,
        tvaRateBp: l.tvaRateBp,
        lineTotalHt: BigInt(priced.lineTotalHt),
        _tva: priced.lineTva,
      };
    });
  }

  private totals(rows: ReturnType<ReceiptsService['lineRows']>) {
    const totalHt = sum(rows.map((r) => Number(r.lineTotalHt)));
    const totalTva = sum(rows.map((r) => r._tva));
    return {
      totalHt: BigInt(totalHt),
      totalTva: BigInt(totalTva),
      totalTtc: BigInt(totalHt + totalTva),
    };
  }

  private headerColumns(data: ReceiptData) {
    return {
      sourceType: data.sourceType,
      sourceReason: data.sourceReason,
      supplierId:
        data.sourceType === 'SUPPLIER' || data.supplierId ? (data.supplierId ?? null) : null,
      supplierInvoiceRef: data.supplierInvoiceRef,
      supplierInvoiceDate: toDate(data.supplierInvoiceDate),
      receivedAt: toDate(data.receivedAt)!,
      notes: data.notes,
      attachmentId: data.attachmentId ?? null,
      purchaseOrderId: data.purchaseOrderId ?? null,
    };
  }

  async createDraft(data: ReceiptData, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      await this.assertSource(tx, data);
      const rows = this.lineRows(data);
      const receipt = await tx.purchaseReceipt.create({
        data: {
          ...this.headerColumns(data),
          ...this.totals(rows),
          siteId: actor.siteId,
          deviceId: actor.deviceId,
          createdById: actor.userId,
          createdAt: now(),
          lines: { create: rows.map(({ _tva, ...r }) => r) },
        },
      });
      return receipt;
    });
  }

  async updateDraft(id: string, data: ReceiptData) {
    return this.prisma.tx(async (tx) => {
      const current = await tx.purchaseReceipt.findUnique({ where: { id } });
      if (!current) throw new AppError('NOT_FOUND');
      if (current.status !== 'DRAFT') throw new AppError('RECEIPT_NOT_DRAFT');
      if (data.version !== undefined && data.version !== current.version)
        throw new AppError('VERSION_CONFLICT');
      await this.assertSource(tx, data);
      const rows = this.lineRows(data);
      await tx.purchaseReceiptLine.deleteMany({ where: { receiptId: id } });
      return tx.purchaseReceipt.update({
        where: { id },
        data: {
          ...this.headerColumns(data),
          ...this.totals(rows),
          version: { increment: 1 },
          lines: { create: rows.map(({ _tva, ...r }) => r) },
        },
      });
    });
  }

  /** Abandon d'un brouillon (aucun numéro attribué, aucun stock) — tracé (RG-01). */
  async discardDraft(id: string, actor: Actor): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const receipt = await tx.purchaseReceipt.findUnique({
        where: { id },
        include: { _count: { select: { lines: true } } },
      });
      if (!receipt) throw new AppError('NOT_FOUND');
      if (receipt.status !== 'DRAFT') throw new AppError('RECEIPT_NOT_DRAFT');
      await tx.purchaseReceiptLine.deleteMany({ where: { receiptId: id } });
      await tx.purchaseReceipt.delete({ where: { id } });
      await this.audit.record(tx, {
        eventType: 'RECEIPT_DRAFT_DISCARDED',
        actor,
        entityType: 'receipt',
        entityId: id,
        summary: `Brouillon de réception abandonné (${receipt._count.lines} ligne(s), ${num(receipt.totalTtc) / 1000} DT TTC)`,
        before: { lines: receipt._count.lines, totalTtc: receipt.totalTtc },
        notify: false,
      });
    });
  }

  /**
   * Validation (RG-08) : péremption obligatoire et future ; un lot par ligne ; mouvement
   * PURCHASE_IN de (quantité + UG) ; coût unitaire = (qté × prix net HT) / (qté + UG).
   */
  async validate(
    id: string,
    options: { acknowledgeWarnings: boolean; updateReferencePrices: boolean },
    actor: Actor,
  ) {
    return this.prisma.tx(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; status: ReceiptStatus }[]
      >`SELECT id, status FROM purchase_receipts WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new AppError('NOT_FOUND');
      if (locked[0]!.status !== 'DRAFT') throw new AppError('RECEIPT_NOT_DRAFT');
      const receipt = await tx.purchaseReceipt.findUniqueOrThrow({
        where: { id },
        include: {
          supplier: true,
          lines: { orderBy: { lineNo: 'asc' }, include: { product: true } },
        },
      });
      if (receipt.lines.length === 0) throw new AppError('RECEIPT_EMPTY');
      if (receipt.sourceType === 'SUPPLIER' && !receipt.supplierId)
        throw new AppError('SUPPLIER_REQUIRED');

      const settings = await this.settings.all(tx);
      const today = todayIso(settings['general.timezone'], now());
      const blocking = receipt.lines.filter((l) => isoOf(l.expiryDate)! <= today);
      if (blocking.length > 0) {
        throw new AppError('EXPIRY_IN_PAST', {
          lines: blocking.map((l) => ({
            line: l.lineNo,
            product: l.product.name,
            expiryDate: isoOf(l.expiryDate),
          })),
        });
      }
      const inactive = receipt.lines.filter((l) => !l.product.isActive);
      if (inactive.length > 0)
        throw new AppError('PRODUCT_INACTIVE', { products: inactive.map((l) => l.product.name) });
      if (receipt.purchaseOrderId)
        await this.orders.assertReceivable(tx, receipt.purchaseOrderId, receipt.supplierId);
      const warnings = [
        ...(await this.warnings(
          receipt.lines.map((l) => ({
            ...l,
            expiryDate: isoOf(l.expiryDate)!,
            product: l.product,
          })),
          tx,
        )),
        ...(receipt.purchaseOrderId
          ? await this.orders.warnings(
              tx,
              receipt.purchaseOrderId,
              receipt.lines.map((l) => ({
                productId: l.productId,
                qty: l.qty,
                productName: l.product.name,
              })),
            )
          : []),
      ];
      if (warnings.length > 0 && !options.acknowledgeWarnings) {
        throw new AppError(
          'CONFLICT',
          { warnings, requiresAcknowledgement: true },
          { message: 'Des avertissements doivent être confirmés avant la validation.' },
        );
      }

      const at = now();
      const number = await this.sequences.next(tx, 'REC', at);
      await this.stock.lockProducts(
        tx,
        receipt.lines.map((l) => l.productId),
      );
      const counterpartName = receipt.supplier?.name ?? null;

      for (const line of receipt.lines) {
        const factor = line.product.sellByUnit ? line.product.unitsPerPack : 1;
        const qtyBase = (line.qty + line.freeQty) * factor;
        const unitCostHt = BigInt(mulDivRound(Number(line.lineTotalHt), 1, qtyBase));
        const lot = await tx.lot.create({
          data: {
            siteId: receipt.siteId,
            productId: line.productId,
            lotNumber: line.lotNumber,
            expiryDate: line.expiryDate,
            receivedAt: at,
            initialQty: qtyBase,
            remainingQty: 0,
            unitCostHt,
            supplierId: receipt.supplierId,
            sourceType: receipt.sourceType,
            status: 'ACTIVE',
            createdAt: at,
          },
        });
        await tx.purchaseReceiptLine.update({ where: { id: line.id }, data: { lotId: lot.id } });
        await this.stock.move(tx, {
          lot: { id: lot.id, product_id: lot.productId, site_id: lot.siteId },
          type: 'PURCHASE_IN',
          qty: qtyBase,
          unitCostHt,
          documentType: 'RECEIPT',
          documentId: receipt.id,
          documentNumber: number,
          counterpartType: receipt.supplierId ? 'SUPPLIER' : 'NONE',
          counterpartId: receipt.supplierId,
          counterpartName:
            counterpartName ??
            (receipt.sourceType === 'DONATION'
              ? 'Don'
              : receipt.sourceType === 'TRANSFER'
                ? 'Transfert'
                : receipt.sourceReason),
          reason: receipt.sourceType === 'OTHER' ? receipt.sourceReason : null,
          actor,
          at,
        });
        if (options.updateReferencePrices) {
          const net = BigInt(
            mulDivRound(Number(line.unitPriceHt), 10_000 - line.discountBp, 10_000),
          );
          if (net !== line.product.refPurchasePriceHt && line.qty > 0) {
            await tx.product.update({
              where: { id: line.productId },
              data: { refPurchasePriceHt: net, version: { increment: 1 } },
            });
            await tx.productPriceHistory.create({
              data: {
                productId: line.productId,
                field: 'refPurchasePriceHt',
                oldValue: line.product.refPurchasePriceHt,
                newValue: net,
                changedById: actor.userId,
                changedAt: at,
              },
            });
            await this.audit.record(tx, {
              eventType: 'PRODUCT_PRICE_CHANGED',
              actor,
              entityType: 'product',
              entityId: line.productId,
              entityRef: `${line.product.internalCode} — ${line.product.name}`,
              summary: `Prix d’achat de référence mis à jour par la réception ${number}`,
              before: { refPurchasePriceHt: line.product.refPurchasePriceHt },
              after: { refPurchasePriceHt: net },
              notify: false,
            });
          }
        }
      }

      if (receipt.purchaseOrderId) {
        await this.orders.applyReceipt(
          tx,
          receipt.purchaseOrderId,
          receipt.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
          1,
        );
      }
      const validated = await tx.purchaseReceipt.update({
        where: { id },
        data: {
          status: 'VALIDATED',
          number,
          validatedById: actor.userId,
          validatedAt: at,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        eventType: 'RECEIPT_VALIDATED',
        actor,
        entityType: 'receipt',
        entityId: id,
        entityRef: number,
        summary: `Réception ${number} validée — ${receipt.lines.length} ligne(s), ${(num(receipt.totalTtc) / 1000).toFixed(3).replace('.', ',')} DT TTC${counterpartName ? ` (${counterpartName})` : ''}`,
        after: {
          number,
          totalHt: receipt.totalHt,
          totalTtc: receipt.totalTtc,
          lines: receipt.lines.length,
        },
        metadata: warnings.length > 0 ? { acknowledgedWarnings: warnings } : undefined,
        notify: { data: { amount: num(receipt.totalTtc) } },
      });
      return validated;
    });
  }

  /** Annulation d'une réception validée (RG-15) : seulement si aucune unité n'est sortie. */
  async cancel(id: string, reason: string, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const locked = await tx.$queryRaw<
        { status: ReceiptStatus }[]
      >`SELECT status FROM purchase_receipts WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new AppError('NOT_FOUND');
      if (locked[0]!.status !== 'VALIDATED')
        throw new AppError('CONFLICT', undefined, {
          message: 'Seule une réception validée peut être annulée.',
        });
      const receipt = await tx.purchaseReceipt.findUniqueOrThrow({
        where: { id },
        include: { lines: true, supplier: true },
      });
      const lotIds = receipt.lines.map((l) => l.lotId).filter((x): x is string => !!x);
      await this.stock.lockProducts(
        tx,
        receipt.lines.map((l) => l.productId),
      );
      const lots = await this.stock.lockLots(tx, lotIds);
      const otherMovements = await tx.stockMovement.count({
        where: { lotId: { in: lotIds }, type: { not: 'PURCHASE_IN' } },
      });
      const consumed = [...lots.values()].filter((l) => l.remaining_qty !== l.initial_qty);
      if (otherMovements > 0 || consumed.length > 0) throw new AppError('RECEIPT_LOTS_CONSUMED');
      const at = now();
      for (const lot of lots.values()) {
        await this.stock.move(tx, {
          lot,
          type: 'RECEIPT_CANCEL',
          qty: -lot.remaining_qty,
          unitCostHt: lot.unit_cost_ht,
          documentType: 'RECEIPT',
          documentId: id,
          documentNumber: receipt.number,
          counterpartType: receipt.supplierId ? 'SUPPLIER' : 'NONE',
          counterpartId: receipt.supplierId,
          counterpartName: receipt.supplier?.name ?? null,
          reason,
          actor,
          at,
        });
        await tx.lot.update({
          where: { id: lot.id },
          data: { status: 'EXHAUSTED', blockReason: `Réception ${receipt.number} annulée` },
        });
      }
      if (receipt.purchaseOrderId) {
        await this.orders.applyReceipt(
          tx,
          receipt.purchaseOrderId,
          receipt.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
          -1,
        );
      }
      const cancelled = await tx.purchaseReceipt.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledById: actor.userId,
          cancelledAt: at,
          cancelReason: reason,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        eventType: 'RECEIPT_CANCELLED',
        actor,
        entityType: 'receipt',
        entityId: id,
        entityRef: receipt.number,
        summary: `Réception ${receipt.number} annulée — ${receipt.lines.length} lot(s) retiré(s) du stock`,
        reason,
        before: { status: 'VALIDATED', totalTtc: receipt.totalTtc },
        after: { status: 'CANCELLED' },
        notify: { data: { amount: num(receipt.totalTtc) } },
      });
      return cancelled;
    });
  }
}
