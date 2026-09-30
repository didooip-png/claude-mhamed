import { Injectable } from '@nestjs/common';
import {
  type PaginationQuery,
  type PurchaseOrderInput,
  type PurchaseOrderStatus,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { SmtpService } from '../email/smtp.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ReorderService } from '../stock/reorder.service.js';

export interface OrderWarning {
  line: number;
  productName: string;
  kind: 'ORDER_OVERRUN' | 'NOT_ORDERED';
  message: string;
}

const productSelect = {
  id: true,
  internalCode: true,
  name: true,
  dosage: true,
  form: true,
  unitsPerPack: true,
  sellByUnit: true,
  refPurchasePriceHt: true,
} satisfies Prisma.ProductSelect;

const total = (lines: { qty: number; unitPriceHt: bigint | number }[]) =>
  lines.reduce((acc, l) => acc + l.qty * num(l.unitPriceHt), 0);

/**
 * Commandes fournisseurs (§6.3) : brouillon (issu des suggestions de réapprovisionnement ou saisi),
 * envoi au fournisseur (numéro BC-…, e-mail avec PDF), réceptions rattachées avec contrôle des
 * quantités, clôture ou annulation.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
    private readonly outbox: EmailOutboxService,
    private readonly smtp: SmtpService,
    private readonly documents: DocumentsService,
    private readonly reorder: ReorderService,
  ) {}

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  async list(
    q: PaginationQuery & { status?: PurchaseOrderStatus; supplierId?: string; open?: '0' | '1' },
  ) {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.open === '1' ? { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } } : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { supplier: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, count] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          lines: { select: { qty: true, receivedQty: true } },
        },
        ...pageArgs(q),
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paginated(
      rows.map((o) => {
        const ordered = o.lines.reduce((a, l) => a + l.qty, 0);
        const received = o.lines.reduce((a, l) => a + Math.min(l.receivedQty, l.qty), 0);
        return {
          id: o.id,
          number: o.number,
          status: o.status,
          supplier: o.supplier,
          expectedDate: o.expectedDate?.toISOString().slice(0, 10) ?? null,
          totalHt: num(o.totalHt),
          lineCount: o.lines.length,
          receivedPercent: ordered === 0 ? 0 : Math.round((received / ordered) * 100),
          createdAt: o.createdAt,
          sentAt: o.sentAt,
        };
      }),
      count,
      q,
    );
  }

  async get(id: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, code: true, name: true, email: true, phone: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: productSelect } } },
        receipts: {
          select: { id: true, number: true, status: true, receivedAt: true, totalHt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) throw new AppError('NOT_FOUND');
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [order.createdById, order.sentById, order.cancelledById].filter(
            (x): x is string => !!x,
          ),
        },
      },
      select: { id: true, code: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      supplier: order.supplier,
      expectedDate: order.expectedDate?.toISOString().slice(0, 10) ?? null,
      notes: order.notes,
      totalHt: num(order.totalHt),
      version: order.version,
      createdAt: order.createdAt,
      createdBy: byId.get(order.createdById) ?? null,
      sentAt: order.sentAt,
      sentBy: order.sentById ? (byId.get(order.sentById) ?? null) : null,
      closedAt: order.closedAt,
      cancelledAt: order.cancelledAt,
      cancelledBy: order.cancelledById ? (byId.get(order.cancelledById) ?? null) : null,
      cancelReason: order.cancelReason,
      lines: order.lines.map((l) => ({
        id: l.id,
        product: { ...l.product, refPurchasePriceHt: num(l.product.refPurchasePriceHt) },
        qty: l.qty,
        receivedQty: l.receivedQty,
        remainingQty: Math.max(0, l.qty - l.receivedQty),
        unitPriceHt: num(l.unitPriceHt),
        lineTotalHt: num(l.lineTotalHt),
      })),
      receipts: order.receipts.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        receivedAt: r.receivedAt.toISOString().slice(0, 10),
        totalHt: num(r.totalHt),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Création et édition du brouillon
  // -------------------------------------------------------------------------

  private async buildLines(tx: Tx, input: PurchaseOrderInput) {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier)
      throw new AppError('VALIDATION_ERROR', {
        fieldErrors: { supplierId: 'Fournisseur inconnu' },
      });
    if (!supplier.isActive)
      throw new AppError('CONFLICT', undefined, { message: 'Fournisseur désactivé.' });
    const products = await tx.product.findMany({
      where: { id: { in: input.lines.map((l) => l.productId) } },
      select: { id: true, isActive: true, refPurchasePriceHt: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return input.lines.map((l, i) => {
      const product = byId.get(l.productId);
      if (!product)
        throw new AppError('VALIDATION_ERROR', { fieldErrors: { lines: 'Produit inconnu' } });
      if (!product.isActive) throw new AppError('PRODUCT_INACTIVE');
      const unitPriceHt = BigInt(l.unitPriceHt ?? num(product.refPurchasePriceHt));
      return {
        lineNo: i + 1,
        productId: l.productId,
        qty: l.qty,
        unitPriceHt,
        lineTotalHt: unitPriceHt * BigInt(l.qty),
      };
    });
  }

  async create(input: PurchaseOrderInput, actor: Actor) {
    const id = await this.prisma.tx(async (tx) => {
      const lines = await this.buildLines(tx, input);
      const order = await tx.purchaseOrder.create({
        data: {
          siteId: actor.siteId,
          supplierId: input.supplierId,
          status: 'DRAFT',
          expectedDate: input.expectedDate ? new Date(`${input.expectedDate}T00:00:00Z`) : null,
          notes: input.notes ?? null,
          totalHt: BigInt(total(lines)),
          createdById: actor.userId,
          lines: { create: lines },
        },
      });
      return order.id;
    });
    return this.get(id);
  }

  async update(id: string, input: PurchaseOrderInput) {
    await this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<{ status: PurchaseOrderStatus; version: number }[]>`
        SELECT status, version FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const current = rows[0];
      if (!current) throw new AppError('NOT_FOUND');
      if (current.status !== 'DRAFT') throw new AppError('ORDER_NOT_DRAFT');
      if (input.version !== undefined && input.version !== current.version)
        throw new AppError('VERSION_CONFLICT');
      const lines = await this.buildLines(tx, input);
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: input.supplierId,
          expectedDate: input.expectedDate ? new Date(`${input.expectedDate}T00:00:00Z`) : null,
          notes: input.notes ?? null,
          totalHt: BigInt(total(lines)),
          version: { increment: 1 },
          lines: { create: lines },
        },
      });
    });
    return this.get(id);
  }

  /** Brouillon prérempli d'après les suggestions de réapprovisionnement d'un fournisseur. */
  async fromSuggestions(
    input: { supplierId: string; productIds?: string[]; includeUnassigned: boolean },
    actor: Actor,
  ) {
    const suggestions = await this.reorder.suggestions(actor, { supplierId: input.supplierId });
    let items = suggestions;
    if (input.includeUnassigned) {
      const unassigned = (await this.reorder.suggestions(actor)).filter((s) => !s.supplier);
      items = [...items, ...unassigned];
    }
    if (input.productIds) items = items.filter((s) => input.productIds!.includes(s.productId));
    if (items.length === 0)
      throw new AppError('CONFLICT', undefined, {
        message: 'Aucune suggestion de réapprovisionnement pour ce fournisseur.',
      });
    return this.create(
      {
        supplierId: input.supplierId,
        notes: 'Commande générée d’après les suggestions de réapprovisionnement',
        lines: items.map((s) => ({
          productId: s.productId,
          // Suggestion en unités de base → boîtes (unité de réception).
          qty: Math.max(1, Math.ceil(s.suggestedQty / (s.sellByUnit ? s.unitsPerPack : 1))),
        })),
      },
      actor,
    );
  }

  // -------------------------------------------------------------------------
  // Envoi, clôture, annulation
  // -------------------------------------------------------------------------

  private async lockOrder(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string; status: PurchaseOrderStatus }[]>`
      SELECT id, status FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new AppError('NOT_FOUND');
    return rows[0]!;
  }

  /** Valide le brouillon : numéro BC-…, statut « envoyée », e-mail au fournisseur si demandé. */
  async send(id: string, input: { to: string[]; cc: string[]; message?: string }, actor: Actor) {
    if (input.to.length > 0 && !(await this.smtp.isOperational()))
      throw new AppError('EMAIL_DISABLED');
    await this.prisma.tx(async (tx) => {
      const locked = await this.lockOrder(tx, id);
      if (locked.status !== 'DRAFT') throw new AppError('ORDER_NOT_DRAFT');
      const order = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { supplier: true, lines: true },
      });
      if (order.lines.length === 0)
        throw new AppError('VALIDATION_ERROR', undefined, { message: 'La commande est vide.' });
      const at = now();
      const number = await this.sequences.next(tx, 'BC', at);
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'SENT',
          number,
          sentById: actor.userId,
          sentAt: at,
          version: { increment: 1 },
        },
      });
      if (input.to.length > 0) await this.queueEmail(tx, id, order.supplier.name, input, actor);
      await this.audit.record(tx, {
        eventType: 'PURCHASE_ORDER_SENT',
        actor,
        entityType: 'purchase_order',
        entityId: id,
        entityRef: number,
        summary: `Commande ${number} envoyée à ${order.supplier.name} : ${order.lines.length} produit(s), ${num(order.totalHt) / 1000} DT HT estimés${input.to.length ? ` (e-mail à ${input.to.join(', ')})` : ''}`,
        after: { number, totalHt: order.totalHt, emailed: input.to },
        notify: false,
      });
    });
    return this.get(id);
  }

  private async queueEmail(
    tx: Tx,
    id: string,
    supplierName: string,
    input: { to: string[]; cc: string[]; message?: string },
    actor: Actor,
  ) {
    const settings = await this.settings.all(tx);
    if (settings['email.auto_send'].PURCHASE_ORDER === 'DISABLED')
      throw new AppError('EMAIL_DISABLED', undefined, {
        message: 'L’envoi des bons de commande est désactivé dans les paramètres e-mail.',
      });
    const smtp = await this.smtp.publicConfig();
    await this.outbox.queue(tx, {
      kind: 'PURCHASE_ORDER',
      to: input.to,
      cc: input.cc,
      bcc: smtp.bccArchive ? [smtp.bccArchive] : [],
      templateKey: 'PURCHASE_ORDER',
      payload: { message: input.message ?? '', fournisseur: supplierName },
      attachments: [{ entityType: 'purchase_order', entityId: id }],
      relatedEntityType: 'purchase_order',
      relatedEntityId: id,
      createdById: actor.userId,
    });
  }

  /** Renvoie le bon de commande par e-mail. */
  async resend(id: string, input: { to: string[]; cc: string[]; message?: string }, actor: Actor) {
    if (input.to.length === 0)
      throw new AppError('EMAIL_INVALID', undefined, { message: 'Indiquez au moins une adresse.' });
    if (!(await this.smtp.isOperational())) throw new AppError('EMAIL_DISABLED');
    await this.prisma.tx(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { supplier: true },
      });
      if (!order) throw new AppError('NOT_FOUND');
      if (!order.number) throw new AppError('ORDER_NOT_RECEIVABLE');
      await this.queueEmail(tx, id, order.supplier.name, input, actor);
      await this.audit.record(tx, {
        eventType: 'EMAIL_SENT_MANUALLY',
        actor,
        entityType: 'purchase_order',
        entityId: id,
        entityRef: order.number,
        summary: `Bon de commande ${order.number} envoyé par e-mail à ${input.to.join(', ')}`,
        notify: false,
      });
    });
    return this.get(id);
  }

  /** Clôture une commande partiellement livrée (le reliquat ne sera pas livré). */
  async close(id: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const locked = await this.lockOrder(tx, id);
      if (locked.status !== 'SENT' && locked.status !== 'PARTIALLY_RECEIVED')
        throw new AppError('ORDER_NOT_RECEIVABLE');
      const order = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'RECEIVED', closedAt: now(), version: { increment: 1 } },
        include: { lines: true },
      });
      const missing = order.lines.reduce((a, l) => a + Math.max(0, l.qty - l.receivedQty), 0);
      await this.audit.record(tx, {
        eventType: 'PURCHASE_ORDER_CLOSED',
        actor,
        entityType: 'purchase_order',
        entityId: id,
        entityRef: order.number,
        summary: `Commande ${order.number} clôturée${missing > 0 ? ` avec ${missing} unité(s) non livrée(s)` : ''}`,
        notify: false,
      });
    });
    return this.get(id);
  }

  async cancel(id: string, reason: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const locked = await this.lockOrder(tx, id);
      if (locked.status === 'CANCELLED' || locked.status === 'RECEIVED')
        throw new AppError('ORDER_NOT_RECEIVABLE');
      const received = await tx.purchaseReceipt.count({
        where: { purchaseOrderId: id, status: 'VALIDATED' },
      });
      if (received > 0)
        throw new AppError('CONFLICT', undefined, {
          message: 'Des réceptions sont rattachées à cette commande : clôturez-la plutôt.',
        });
      const order = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledById: actor.userId,
          cancelledAt: now(),
          cancelReason: reason,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        eventType: 'PURCHASE_ORDER_CANCELLED',
        actor,
        entityType: 'purchase_order',
        entityId: id,
        entityRef: order.number ?? 'brouillon',
        summary: `Commande ${order.number ?? '(brouillon)'} annulée`,
        reason,
        notify: false,
      });
    });
    return this.get(id);
  }

  async pdf(id: string, actor: Actor): Promise<Buffer> {
    return this.documents.purchaseOrderPdf(id, actor);
  }

  // -------------------------------------------------------------------------
  // Réceptions rattachées
  // -------------------------------------------------------------------------

  /** La commande peut-elle recevoir une réception de ce fournisseur ? */
  async assertReceivable(tx: Tx, orderId: string, supplierId: string | null | undefined) {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      select: { status: true, supplierId: true, number: true },
    });
    if (!order) throw new AppError('NOT_FOUND', { entity: 'purchase_order' });
    if (order.status !== 'SENT' && order.status !== 'PARTIALLY_RECEIVED')
      throw new AppError('ORDER_NOT_RECEIVABLE');
    if (supplierId && supplierId !== order.supplierId)
      throw new AppError('VALIDATION_ERROR', undefined, {
        message: `La commande ${order.number} concerne un autre fournisseur.`,
      });
  }

  /** Contrôle des quantités d'une réception par rapport au reliquat de la commande. */
  async warnings(
    tx: Tx,
    orderId: string,
    lines: { productId: string; qty: number; productName?: string }[],
  ): Promise<OrderWarning[]> {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { lines: { include: { product: { select: { name: true } } } } },
    });
    if (!order) return [];
    const bought = new Map<string, number>();
    lines.forEach((l) => bought.set(l.productId, (bought.get(l.productId) ?? 0) + l.qty));
    const out: OrderWarning[] = [];
    lines.forEach((l, i) => {
      const ol = order.lines.find((x) => x.productId === l.productId);
      const name = l.productName ?? ol?.product.name ?? 'Produit';
      if (!ol) {
        out.push({
          line: i + 1,
          productName: name,
          kind: 'NOT_ORDERED',
          message: `Produit non commandé (commande ${order.number})`,
        });
        return;
      }
      const remaining = Math.max(0, ol.qty - ol.receivedQty);
      const total = bought.get(l.productId) ?? 0;
      if (total > remaining) {
        out.push({
          line: i + 1,
          productName: name,
          kind: 'ORDER_OVERRUN',
          message: `Quantité reçue (${total}) supérieure au reliquat commandé (${remaining}) — commande ${order.number}`,
        });
      }
    });
    // Un même produit sur plusieurs lignes ne doit produire qu'un avertissement.
    return out.filter(
      (w, i) => out.findIndex((x) => x.kind === w.kind && x.productName === w.productName) === i,
    );
  }

  /**
   * Applique (sign = 1) ou annule (sign = −1) une réception sur la commande : quantités reçues
   * par produit puis statut (envoyée, partiellement reçue, reçue).
   */
  async applyReceipt(
    tx: Tx,
    orderId: string,
    lines: { productId: string; qty: number }[],
    sign: 1 | -1,
  ): Promise<void> {
    const locked = await this.lockOrder(tx, orderId);
    if (locked.status === 'CANCELLED' || locked.status === 'DRAFT') return;
    const byProduct = new Map<string, number>();
    lines.forEach((l) => byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.qty));
    const orderLines = await tx.purchaseOrderLine.findMany({ where: { orderId } });
    for (const ol of orderLines) {
      const delta = (byProduct.get(ol.productId) ?? 0) * sign;
      if (delta === 0) continue;
      await tx.purchaseOrderLine.update({
        where: { id: ol.id },
        data: { receivedQty: Math.max(0, ol.receivedQty + delta) },
      });
    }
    const updated = await tx.purchaseOrderLine.findMany({ where: { orderId } });
    const any = updated.some((l) => l.receivedQty > 0);
    const all = updated.every((l) => l.receivedQty >= l.qty);
    const status: PurchaseOrderStatus = all ? 'RECEIVED' : any ? 'PARTIALLY_RECEIVED' : 'SENT';
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { status, closedAt: all ? now() : null, version: { increment: 1 } },
    });
  }
}
