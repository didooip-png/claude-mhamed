import { Injectable } from '@nestjs/common';
import {
  allocateProportionally,
  diffDaysIso,
  mulDivRound,
  todayIso,
  type CreateReturnData,
  type OverrideInput,
  type ReturnCondition,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import type { Prisma, ReturnLineDestination, SaleUnit } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { LedgerService } from '../accounts/ledger.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OverrideRequirements, OverrideService } from '../auth/override.service.js';
import { CashService } from '../cash/cash.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockService, type LockedLot } from '../stock/stock.service.js';

const money = (v: number | bigint) => `${(Number(v) / 1000).toFixed(3).replace('.', ',')} DT`;

/** Un produit ne peut pas être repris s'il est marqué « retour non autorisé », au froid ou à tableau. */
function nonReturnableReason(p: {
  returnable: boolean;
  coldChain: boolean;
  controlledClass: string;
}): string | null {
  if (!p.returnable) return 'produit marqué « retour non autorisé »';
  if (p.coldChain) return 'produit de la chaîne du froid';
  if (p.controlledClass !== 'NONE') return `produit à tableau ${p.controlledClass}`;
  return null;
}

function unitFactor(p: { sellByUnit: boolean; unitsPerPack: number }, unit: SaleUnit): number {
  return p.sellByUnit && unit === 'PACK' ? p.unitsPerPack : 1;
}

export interface ReturnResult {
  id: string;
  warnings: string[];
}

interface Resolved {
  productId: string;
  productName: string;
  lot: LockedLot;
  saleLineId: string | null;
  allocId: string | null;
  qtyBase: number;
  condition: ReturnCondition;
  amount: number;
  unitCostHt: bigint;
}

/**
 * Retours clients et avoirs (§6.8, RG-14) : quantités contrôlées ligne par ligne et lot par lot,
 * état du produit (revendable → lot d'origine ; sinon quarantaine ou destruction), montant réellement
 * payé au prorata, avoir `AV-` qui réduit d'abord le reste à payer de la facture d'origine,
 * remboursement en espèces réservé à l'administrateur.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly ledger: LedgerService,
    private readonly cash: CashService,
    private readonly overrides: OverrideService,
    private readonly outbox: EmailOutboxService,
  ) {}

  // ---------------------------------------------------------------------------
  // Assistant de retour : ce qui peut être retourné pour une vente
  // ---------------------------------------------------------------------------

  async returnable(saleId: string, actor: Actor) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        client: { select: { id: true, code: true, name: true, isWalkIn: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: true,
            allocations: { include: { lot: true }, orderBy: { lot: { expiryDate: 'asc' } } },
          },
        },
      },
    });
    if (!sale || !sale.number) throw new AppError('NOT_FOUND');
    const settings = await this.settings.all();
    const tz = settings['general.timezone'];
    const today = todayIso(tz, now());
    const daysSince = sale.validatedAt ? diffDaysIso(todayIso(tz, sale.validatedAt), today) : 0;
    return {
      sale: {
        id: sale.id,
        number: sale.number,
        status: sale.status,
        validatedAt: sale.validatedAt,
        totalTtc: sale.totalTtc,
        amountPaid: sale.amountPaid,
        amountDue: sale.amountDue,
        returnStatus: sale.returnStatus,
        client: sale.client,
      },
      rules: {
        daysSinceSale: daysSince,
        maxDays: settings['returns.max_days'],
        late: daysSince > settings['returns.max_days'],
        requireAdminCode: settings['returns.require_admin_code'],
        canCashRefund:
          settings['returns.cash_refund_allowed'] && actor.permissions.has('returns.cash_refund'),
        walkIn: sale.client?.isWalkIn ?? false,
      },
      lines: sale.lines.map((l) => {
        const blocked = nonReturnableReason(l.product);
        return {
          id: l.id,
          product: {
            id: l.product.id,
            internalCode: l.product.internalCode,
            name: l.product.name,
            dosage: l.product.dosage,
            unitsPerPack: l.product.unitsPerPack,
            sellByUnit: l.product.sellByUnit,
          },
          unit: l.unit,
          qtyBase: l.qtyBase,
          returnedQtyBase: l.returnedQtyBase,
          returnableQtyBase: l.qtyBase - l.returnedQtyBase,
          lineTotalTtc: l.lineTotalTtc,
          notReturnable: blocked,
          lots: l.allocations.map((a) => ({
            lotId: a.lotId,
            allocationId: a.id,
            lotNumber: a.lot.lotNumber,
            expiryDate: a.lot.expiryDate.toISOString().slice(0, 10),
            expired: a.lot.expiryDate.toISOString().slice(0, 10) <= today,
            status: a.lot.status,
            qtyBase: a.qtyBase,
            returnedQtyBase: a.returnedQtyBase,
            returnableQtyBase: a.qtyBase - a.returnedQtyBase,
          })),
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Création
  // ---------------------------------------------------------------------------

  async create(
    input: CreateReturnData,
    idempotencyKey: string | undefined,
    actor: Actor,
  ): Promise<ReturnResult> {
    if (idempotencyKey) {
      const previous = await this.prisma.customerReturn.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (previous) return { id: previous.id, warnings: [] };
    }
    const warnings: string[] = [];
    const id = await this.prisma.tx(
      (tx) => this.createCore(tx, input, idempotencyKey ?? null, actor, warnings),
      { timeout: 60_000 },
    );
    return { id, warnings };
  }

  private async createCore(
    tx: Tx,
    input: CreateReturnData,
    idempotencyKey: string | null,
    actor: Actor,
    warnings: string[],
  ): Promise<string> {
    const settings = await this.settings.all(tx);
    const tz = settings['general.timezone'];
    const at = now();
    const today = todayIso(tz, at);
    const req = new OverrideRequirements(actor);
    const entries = input.entries;

    // --- Verrous : vente → client → produits → lots (ordre global des transactions) -------
    let saleId: string | null = null;
    if (input.saleId) {
      const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM sales WHERE id = ${input.saleId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new AppError('NOT_FOUND');
      if (rows[0]!.status !== 'VALIDATED') throw new AppError('SALE_NOT_VALIDATED');
      saleId = input.saleId;
    } else {
      if (
        !settings['returns.allow_without_sale'] ||
        !actor.permissions.has('returns.without_sale')
      ) {
        throw new AppError('RETURN_NOT_ALLOWED', undefined, {
          message:
            'Un retour sans vente d’origine n’est pas autorisé (paramètre et droit administrateur).',
        });
      }
    }
    const sale = saleId
      ? await tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: {
            client: true,
            lines: { orderBy: { lineNo: 'asc' }, include: { product: true, allocations: true } },
          },
        })
      : null;
    const clientId = sale ? sale.clientId! : input.clientId!;
    const client = await this.ledger.lockClient(tx, clientId);
    const productIds = sale ? sale.lines.map((l) => l.productId) : entries.map((e) => e.productId!);
    await this.stock.lockProducts(tx, productIds);
    const lots = await this.stock.lockLots(
      tx,
      entries.map((e) => e.lotId),
    );

    // --- Résolution et contrôle des entrées ------------------------------------------------
    const resolved: Resolved[] = [];
    const forcedNonResellable: string[] = [];
    if (sale) {
      const used = new Map<string, number>();
      const lineUsed = new Map<string, number>();
      for (const e of entries) {
        const line = sale.lines.find((l) => l.id === e.saleLineId);
        if (!line) throw new AppError('NOT_FOUND', { entity: 'line' });
        const alloc = line.allocations.find((a) => a.lotId === e.lotId);
        const lot = lots.get(e.lotId);
        if (!alloc || !lot) throw new AppError('LOT_NOT_FOUND', { lotId: e.lotId });
        const qtyBase = e.qty * unitFactor(line.product, e.unit);
        const usedAlloc = (used.get(alloc.id) ?? 0) + qtyBase;
        const usedLine = (lineUsed.get(line.id) ?? 0) + qtyBase;
        if (
          usedAlloc > alloc.qtyBase - alloc.returnedQtyBase ||
          usedLine > line.qtyBase - line.returnedQtyBase
        ) {
          throw new AppError('RETURN_QTY_EXCEEDED', {
            product: line.product.name,
            lot: lot.lot_number,
            sold: alloc.qtyBase,
            alreadyReturned: alloc.returnedQtyBase,
            requested: usedAlloc,
          });
        }
        used.set(alloc.id, usedAlloc);
        lineUsed.set(line.id, usedLine);
        const blocked = nonReturnableReason(line.product);
        if (blocked) req.require('returns.non_returnable', `${line.product.name} : ${blocked}`);
        resolved.push({
          productId: line.productId,
          productName: line.product.name,
          lot,
          saleLineId: line.id,
          allocId: alloc.id,
          qtyBase,
          condition: e.condition,
          amount: 0,
          unitCostHt: alloc.unitCostHt,
        });
      }
      // Montant = prix réellement payé (après remises) au prorata, arrondi cumulé par ligne.
      for (const line of sale.lines) {
        const mine = resolved.filter((r) => r.saleLineId === line.id);
        if (mine.length === 0) continue;
        const qty = mine.reduce((a, r) => a + r.qtyBase, 0);
        const cum = (r: number) => mulDivRound(num(line.lineTotalTtc), r, line.qtyBase);
        const amount = cum(line.returnedQtyBase + qty) - cum(line.returnedQtyBase);
        const parts = allocateProportionally(
          amount,
          mine.map((r) => r.qtyBase),
        );
        mine.forEach((r, i) => (r.amount = parts[i]!));
      }
      const validatedDay = sale.validatedAt ? todayIso(tz, sale.validatedAt) : today;
      if (diffDaysIso(validatedDay, today) > settings['returns.max_days']) {
        req.require('returns.late', `retour au-delà de ${settings['returns.max_days']} jours`);
      }
    } else {
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      for (const e of entries) {
        const lot = lots.get(e.lotId);
        const product = products.find((p) => p.id === e.productId);
        if (!lot || !product || lot.product_id !== product.id)
          throw new AppError('LOT_NOT_FOUND', { lotId: e.lotId });
        const blocked = nonReturnableReason(product);
        if (blocked) req.require('returns.non_returnable', `${product.name} : ${blocked}`);
        resolved.push({
          productId: product.id,
          productName: product.name,
          lot,
          saleLineId: null,
          allocId: null,
          qtyBase: e.qty * unitFactor(product, e.unit),
          condition: e.condition,
          amount: e.amount!,
          unitCostHt: lot.unit_cost_ht,
        });
      }
    }
    // Lot entre-temps périmé → non revendable d'office ; lot bloqué / en quarantaine → idem.
    for (const r of resolved) {
      const expired = r.lot.expiry_date.toISOString().slice(0, 10) <= today;
      if (r.condition === 'RESELLABLE' && (expired || r.lot.status === 'QUARANTINE')) {
        r.condition = 'QUARANTINE';
        forcedNonResellable.push(`${r.productName} (lot ${r.lot.lot_number})`);
      }
    }
    const total = resolved.reduce((a, r) => a + r.amount, 0);

    // --- Mode de remboursement et autorisations --------------------------------------------
    const walkIn = client.is_walk_in;
    if (walkIn && input.refundMode !== 'CASH') {
      throw new AppError('CREDIT_NOT_ALLOWED', undefined, {
        message: 'Client comptoir : pas d’avoir, le retour est remboursé en espèces.',
      });
    }
    if (input.refundMode === 'CASH') {
      if (!settings['returns.cash_refund_allowed']) {
        throw new AppError('RETURN_NOT_ALLOWED', undefined, {
          message: 'Le remboursement en espèces est désactivé dans les paramètres.',
        });
      }
      if (!actor.permissions.has('returns.cash_refund')) {
        throw new AppError(
          'FORBIDDEN',
          { permissions: ['returns.cash_refund'] },
          { message: 'Seul un administrateur peut rembourser un retour en espèces.' },
        );
      }
    }
    if (settings['returns.require_admin_code']) req.require('returns.approve', 'retour client');
    const grant = await this.overrides.resolve(
      tx,
      req,
      input.override as OverrideInput | undefined,
      actor,
      {
        entityType: 'sale',
        entityId: saleId ?? undefined,
        entityRef: sale?.number ?? null,
        action: `retour client${sale ? ` sur la facture ${sale.number}` : ' sans vente d’origine'}`,
      },
    );

    // --- Effets sur la facture d'origine : l'avoir réduit d'abord le reste à payer -------------
    const reduction = sale ? Math.min(total, num(sale.amountDue)) : 0;
    const excess = total - reduction;
    const cashOut = input.refundMode === 'CASH' ? excess : 0;
    const session =
      cashOut > 0 && actor.deviceId ? await this.cash.lockOpenSession(tx, actor.deviceId) : null;
    if (cashOut > 0 && !session)
      throw new AppError('CASH_SESSION_REQUIRED', undefined, {
        message:
          'Un remboursement en espèces nécessite une session de caisse ouverte sur ce poste.',
      });

    // --- Documents et écritures ---------------------------------------------------------------
    const number = await this.sequences.next(tx, 'RT', at);
    const ret = await tx.customerReturn.create({
      data: {
        number,
        siteId: actor.siteId,
        saleId,
        clientId,
        totalTtc: BigInt(total),
        refundMode: input.refundMode === 'CASH' ? 'CASH' : 'CREDIT',
        reason: input.reason,
        cashSessionId: session?.id ?? null,
        deviceId: actor.deviceId,
        idempotencyKey,
        createdById: actor.userId,
        authorizedById: grant?.id ?? null,
        createdAt: at,
      },
    });
    for (const r of resolved) {
      const destination: ReturnLineDestination =
        r.condition === 'RESELLABLE'
          ? 'RESTOCK'
          : r.condition === 'QUARANTINE'
            ? 'QUARANTINE'
            : 'DESTRUCTION';
      let targetLot: Pick<LockedLot, 'id' | 'product_id' | 'site_id'> = r.lot;
      if (destination !== 'RESTOCK') targetLot = await this.quarantineLot(tx, r.lot, at);
      await tx.customerReturnLine.create({
        data: {
          returnId: ret.id,
          saleLineId: r.saleLineId,
          productId: r.productId,
          qtyBase: r.qtyBase,
          amount: BigInt(r.amount),
          resellable: r.condition === 'RESELLABLE',
          destination,
          lotId: targetLot.id,
          unitCostHt: r.unitCostHt,
        },
      });
      const common = {
        lot: targetLot,
        unitCostHt: r.unitCostHt,
        unitPriceTtc: mulDivRound(r.amount, 1, r.qtyBase),
        documentType: 'RETURN',
        documentId: ret.id,
        documentNumber: number,
        counterpartType: 'CLIENT' as const,
        counterpartId: clientId,
        counterpartName: client.name,
        actor,
        authorizedById: grant?.id ?? null,
        at,
      };
      await this.stock.move(tx, {
        ...common,
        type: 'CUSTOMER_RETURN_IN',
        qty: r.qtyBase,
        reason: `Retour client — ${input.reason}${destination === 'QUARANTINE' ? ' (quarantaine)' : destination === 'DESTRUCTION' ? ' (à détruire)' : ''}`,
      });
      if (destination === 'DESTRUCTION') {
        await this.stock.move(tx, {
          ...common,
          type: 'LOSS',
          qty: -r.qtyBase,
          reason: 'Retour client non revendable — produit détruit',
        });
      }
      if (sale && r.saleLineId && r.allocId) {
        await tx.saleLine.update({
          where: { id: r.saleLineId },
          data: { returnedQtyBase: { increment: r.qtyBase } },
        });
        await tx.saleLineAllocation.update({
          where: { id: r.allocId },
          data: { returnedQtyBase: { increment: r.qtyBase } },
        });
      }
    }
    if (sale) {
      const lines = await tx.saleLine.findMany({
        where: { saleId: sale.id },
        select: { qtyBase: true, returnedQtyBase: true },
      });
      const all = lines.every((l) => l.returnedQtyBase === l.qtyBase);
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          returnedAmount: { increment: BigInt(total) },
          returnStatus: all ? 'RETURNED' : 'PARTIALLY_RETURNED',
        },
      });
    }

    // Avoir : document AV (sauf client comptoir), écriture au compte client, puis affectation / remboursement.
    let creditNote: { id: string; number: string } | null = null;
    if (total > 0) {
      if (!walkIn) {
        const avNumber = await this.sequences.next(tx, 'AV', at);
        const note = await tx.creditNote.create({
          data: {
            number: avNumber,
            clientId,
            returnId: ret.id,
            source: 'RETURN',
            amount: BigInt(total),
            remainingAmount: BigInt(total),
            createdById: actor.userId,
            createdAt: at,
          },
        });
        creditNote = { id: note.id, number: avNumber };
        await this.ledger.post(tx, {
          clientId,
          type: 'CREDIT_NOTE',
          credit: total,
          documentType: 'CREDIT_NOTE',
          documentId: note.id,
          documentNumber: avNumber,
          description: `Avoir ${avNumber}${sale ? ` (retour sur ${sale.number})` : ''}`,
          actor,
          at,
        });
        if (reduction > 0 && sale) {
          await tx.creditNoteAllocation.create({
            data: {
              creditNoteId: note.id,
              saleId: sale.id,
              amount: BigInt(reduction),
              createdById: actor.userId,
              createdAt: at,
            },
          });
          await tx.$executeRaw`UPDATE credit_notes SET remaining_amount = remaining_amount - ${reduction} WHERE id = ${note.id}::uuid`;
          await this.ledger.refreshSaleAmounts(tx, sale.id);
        }
        if (cashOut > 0) {
          await tx.$executeRaw`UPDATE credit_notes SET remaining_amount = remaining_amount - ${cashOut} WHERE id = ${note.id}::uuid`;
        }
      } else {
        // Client comptoir : pas d'avoir, l'opération s'équilibre au compte (retour puis remboursement).
        await this.ledger.post(tx, {
          clientId,
          type: 'CREDIT_NOTE',
          credit: total,
          documentType: 'RETURN',
          documentId: ret.id,
          documentNumber: number,
          description: `Retour ${number}${sale ? ` sur ${sale.number}` : ''}`,
          actor,
          at,
        });
      }
      if (cashOut > 0 && session) {
        await this.cash.addMovement(tx, {
          sessionId: session.id,
          type: 'REFUND',
          amount: cashOut,
          documentType: 'RETURN',
          documentId: ret.id,
          documentRef: number,
          reason: `Retour client ${number}`,
          actor,
          authorizedById: grant?.id ?? null,
          at,
        });
        await this.ledger.post(tx, {
          clientId,
          type: 'REFUND',
          debit: cashOut,
          documentType: 'RETURN',
          documentId: ret.id,
          documentNumber: number,
          description: `Remboursement en espèces (retour ${number})`,
          actor,
          at,
        });
      }
    }

    // --- Audit ---------------------------------------------------------------------------------
    const ref = sale?.number ?? number;
    await this.audit.record(tx, {
      eventType: 'CUSTOMER_RETURN',
      actor,
      authorizedBy: grant ? { id: grant.id, code: grant.code } : null,
      entityType: 'return',
      entityId: ret.id,
      entityRef: number,
      summary: `Retour ${number}${sale ? ` sur la facture ${sale.number}` : ' sans vente d’origine'} — ${client.name} — ${money(total)}${creditNote ? ` (avoir ${creditNote.number})` : ''}${cashOut > 0 ? ` — remboursé en espèces ${money(cashOut)}` : ''}`,
      reason: input.reason,
      after: {
        total,
        refundMode: input.refundMode,
        reducedInvoice: reduction,
        lines: resolved.map((r) => ({
          product: r.productName,
          lot: r.lot.lot_number,
          qty: r.qtyBase,
          condition: r.condition,
          amount: r.amount,
        })),
      },
      metadata: { saleId, ref },
      notify: { data: { amount: total }, link: `/returns/${ret.id}` },
    });
    if (cashOut > 0) {
      await this.audit.record(tx, {
        eventType: 'CASH_REFUND',
        actor,
        entityType: 'return',
        entityId: ret.id,
        entityRef: number,
        summary: `Remboursement en espèces de ${money(cashOut)} (retour ${number})`,
        after: { amount: cashOut },
        notify: { data: { amount: cashOut } },
      });
    }

    // --- E-mail de l'avoir (file d'envoi, jamais bloquant) -----------------------------------------
    if (creditNote && input.refundMode === 'CREDIT') {
      const explicit = input.sendEmail === true || !!input.emailTo;
      if (explicit || input.sendEmail === undefined) {
        const queued = await this.outbox.queueDocument(tx, {
          kind: 'CREDIT_NOTE',
          entityType: 'credit_note',
          entityId: creditNote.id,
          clientId,
          to: input.emailTo ? [input.emailTo] : undefined,
          manual: explicit,
          actor,
        });
        if (!queued.queued && explicit) warnings.push(queued.reason);
      }
    }
    if (forcedNonResellable.length > 0) {
      warnings.push(
        `Non revendable d’office (lot périmé ou en quarantaine) : ${forcedNonResellable.join(', ')}.`,
      );
    }
    return ret.id;
  }

  /** Lot de quarantaine rattaché au lot d'origine (mêmes numéro et péremption), créé au besoin. */
  private async quarantineLot(
    tx: Tx,
    origin: LockedLot,
    at: Date,
  ): Promise<Pick<LockedLot, 'id' | 'product_id' | 'site_id'>> {
    const lotNumber = `${origin.lot_number}-RET`;
    const existing = await tx.lot.findFirst({
      where: {
        productId: origin.product_id,
        lotNumber,
        status: 'QUARANTINE',
        expiryDate: origin.expiry_date,
      },
    });
    if (existing) {
      await this.stock.lockLots(tx, [existing.id]);
      return { id: existing.id, product_id: existing.productId, site_id: existing.siteId };
    }
    const lot = await tx.lot.create({
      data: {
        siteId: origin.site_id,
        productId: origin.product_id,
        lotNumber,
        expiryDate: origin.expiry_date,
        receivedAt: at,
        initialQty: 0,
        remainingQty: 0,
        unitCostHt: origin.unit_cost_ht,
        sourceType: 'OTHER',
        status: 'QUARANTINE',
        blockReason: 'Retour client non revendable',
        createdAt: at,
      },
    });
    return { id: lot.id, product_id: lot.productId, site_id: lot.siteId };
  }

  // ---------------------------------------------------------------------------
  // Consultation
  // ---------------------------------------------------------------------------

  async list(q: {
    page: number;
    pageSize: number;
    q?: string;
    clientId?: string;
    saleId?: string;
    from?: Date;
    to?: Date;
  }) {
    const term = q.q?.trim();
    const where: Prisma.CustomerReturnWhereInput = {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.saleId ? { saleId: q.saleId } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
        : {}),
      ...(term
        ? {
            OR: [
              { number: { contains: term, mode: 'insensitive' } },
              { sale: { number: { contains: term, mode: 'insensitive' } } },
              { client: { name: { contains: term, mode: 'insensitive' } } },
              { creditNote: { number: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customerReturn.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: {
          sale: { select: { id: true, number: true } },
          client: { select: { id: true, code: true, name: true } },
          creditNote: { select: { id: true, number: true, amount: true, remainingAmount: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.customerReturn.count({ where }),
    ]);
    const users = await this.usersOf(items.flatMap((i) => [i.createdById, i.authorizedById]));
    return paginated(
      items.map((r) => ({
        id: r.id,
        number: r.number,
        createdAt: r.createdAt,
        sale: r.sale,
        client: r.client,
        totalTtc: r.totalTtc,
        refundMode: r.refundMode,
        reason: r.reason,
        lineCount: r._count.lines,
        creditNote: r.creditNote,
        createdBy: users.get(r.createdById) ?? null,
        authorizedBy: r.authorizedById ? (users.get(r.authorizedById) ?? null) : null,
      })),
      total,
      q,
    );
  }

  private async usersOf(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = unique.length
      ? await this.prisma.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, code: true, fullName: true },
        })
      : [];
    return new Map(rows.map((u) => [u.id, u]));
  }

  async get(id: string) {
    const r = await this.prisma.customerReturn.findUnique({
      where: { id },
      include: {
        sale: { select: { id: true, number: true } },
        client: { select: { id: true, code: true, name: true, isWalkIn: true } },
        creditNote: {
          include: { allocations: { include: { sale: { select: { id: true, number: true } } } } },
        },
        lines: true,
      },
    });
    if (!r) throw new AppError('NOT_FOUND');
    const users = await this.usersOf([r.createdById, r.authorizedById]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: r.lines.map((l) => l.productId) } },
      select: {
        id: true,
        internalCode: true,
        name: true,
        dosage: true,
        unitsPerPack: true,
        sellByUnit: true,
      },
    });
    const lots = await this.prisma.lot.findMany({
      where: { id: { in: r.lines.map((l) => l.lotId) } },
      select: { id: true, lotNumber: true, expiryDate: true, status: true },
    });
    return {
      id: r.id,
      number: r.number,
      createdAt: r.createdAt,
      sale: r.sale,
      client: r.client,
      totalTtc: r.totalTtc,
      refundMode: r.refundMode,
      reason: r.reason,
      createdBy: users.get(r.createdById) ?? null,
      authorizedBy: r.authorizedById ? (users.get(r.authorizedById) ?? null) : null,
      creditNote: r.creditNote
        ? {
            id: r.creditNote.id,
            number: r.creditNote.number,
            amount: r.creditNote.amount,
            remainingAmount: r.creditNote.remainingAmount,
            appliedTo: r.creditNote.allocations
              .filter((a) => !a.cancelledAt)
              .map((a) => ({ saleId: a.sale.id, saleNumber: a.sale.number, amount: a.amount })),
          }
        : null,
      lines: r.lines.map((l) => ({
        id: l.id,
        product: products.find((p) => p.id === l.productId) ?? null,
        lot: lots.find((x) => x.id === l.lotId) ?? null,
        qtyBase: l.qtyBase,
        amount: l.amount,
        resellable: l.resellable,
        destination: l.destination,
      })),
    };
  }
}
