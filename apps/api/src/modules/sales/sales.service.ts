import { Injectable } from '@nestjs/common';
import {
  addDaysIso,
  computeSaleTotals,
  htFromTtc,
  mulDivRound,
  todayIso,
  type AddSaleLineInput,
  type CancelSaleInput,
  type ModifySaleInput,
  type OverrideInput,
  type PrescriptionInput,
  type UpdateSaleLineInput,
  type ValidateSaleInput,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import type { DraftEventType, Prisma, SaleUnit } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { LedgerService } from '../accounts/ledger.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { OverrideRequirements, OverrideService } from '../auth/override.service.js';
import { CashService } from '../cash/cash.service.js';
import { isProfessionalClient } from '../clients/clients.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { PaymentsCoreService } from '../payments/payments-core.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockService } from '../stock/stock.service.js';
import { planAllocations, type PlannedAllocation } from './allocation.js';

type ProductRow = Prisma.ProductGetPayload<{ include: { tvaRate: true } }>;

const money = (v: number | bigint) => `${(Number(v) / 1000).toFixed(3).replace('.', ',')} DT`;

/** Facteur boîte → unité de base (RG-07). */
function unitFactor(
  product: Pick<ProductRow, 'sellByUnit' | 'unitsPerPack'>,
  unit: SaleUnit,
): number {
  return product.sellByUnit && unit === 'PACK' ? product.unitsPerPack : 1;
}

function catalogPrice(
  product: Pick<ProductRow, 'sellByUnit' | 'salePriceTtc' | 'unitSalePriceTtc'>,
  unit: SaleUnit,
): bigint {
  if (unit === 'UNIT') {
    if (!product.sellByUnit || product.unitSalePriceTtc === null)
      throw new AppError('UNIT_SALE_NOT_ALLOWED');
    return product.unitSalePriceTtc;
  }
  return product.salePriceTtc;
}

export interface ValidateOptions {
  /** Modification (RG-13) : règlements et avoirs de la vente d'origine à réaffecter en priorité. */
  transfer?: { paymentIds: string[]; creditNoteIds: string[] };
  excessMode?: 'CREDIT' | 'REFUND';
  skipIdempotency?: boolean;
}

/**
 * Ventes (§6.6–6.7) : panier persisté côté serveur (statut DRAFT), mise en attente, validation
 * transactionnelle (lots FEFO/FIFO, numérotation, règlements, compte client, caisse, audit, e-mail),
 * annulation (RG-11) et modification (RG-13) par un administrateur.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsCoreService,
    private readonly cash: CashService,
    private readonly overrides: OverrideService,
    private readonly auth: AuthService,
    private readonly outbox: EmailOutboxService,
  ) {}

  // =========================================================================
  // Panier (vente au statut DRAFT)
  // =========================================================================

  /**
   * Verrouille un panier. Un panier en cours (DRAFT) n'est modifiable que par son auteur ;
   * une vente en attente (ON_HOLD) peut être reprise ou abandonnée depuis n'importe quel poste.
   */
  private async lockDraft(tx: Tx, saleId: string, actor: Actor, statuses: string[] = ['DRAFT']) {
    const rows = await tx.$queryRaw<
      { id: string; status: string; created_by: string }[]
    >`SELECT id, status, created_by FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND');
    if (!statuses.includes(row.status))
      throw new AppError('SALE_NOT_DRAFT', { status: row.status });
    if (row.status === 'DRAFT' && row.created_by !== actor.userId) {
      throw new AppError('FORBIDDEN', undefined, {
        message: 'Ce panier appartient à un autre utilisateur.',
      });
    }
    return tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, client: true },
    });
  }

  private async event(
    tx: Tx,
    saleId: string,
    event: DraftEventType,
    actor: Actor,
    data: { productId?: string; qty?: number; details?: Record<string, unknown> } = {},
  ) {
    await tx.saleDraftEvent.create({
      data: {
        saleId,
        event,
        productId: data.productId ?? null,
        qty: data.qty ?? null,
        details: (data.details ?? undefined) as Prisma.InputJsonValue | undefined,
        userId: actor.userId,
        deviceId: actor.deviceId,
        createdAt: now(),
      },
    });
  }

  /** Panier en cours de l'utilisateur sur ce poste (reprise après coupure). */
  async currentDraft(actor: Actor) {
    const draft = await this.prisma.sale.findFirst({
      where: { status: 'DRAFT', createdById: actor.userId, deviceId: actor.deviceId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return draft ? this.view(draft.id, actor) : null;
  }

  async create(actor: Actor, clientId?: string | null) {
    const sale = await this.prisma.tx(async (tx) => {
      if (clientId) {
        const client = await tx.client.findUnique({ where: { id: clientId } });
        if (!client || !client.isActive) throw new AppError('CLIENT_INACTIVE');
      }
      return tx.sale.create({
        data: {
          siteId: actor.siteId,
          clientId: clientId ?? null,
          deviceId: actor.deviceId,
          createdById: actor.userId,
          createdAt: now(),
        },
      });
    });
    return this.view(sale.id, actor);
  }

  async setClient(saleId: string, clientId: string | null, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const sale = await this.lockDraft(tx, saleId, actor);
      let defaultDiscount = 0;
      if (clientId) {
        const client = await tx.client.findUnique({ where: { id: clientId } });
        if (!client || !client.isActive) throw new AppError('CLIENT_INACTIVE');
        defaultDiscount = client.defaultDiscountBp;
      }
      await tx.sale.update({ where: { id: saleId }, data: { clientId } });
      // Remise habituelle du client : appliquée aux lignes sans remise.
      if (defaultDiscount > 0) {
        await tx.saleLine.updateMany({
          where: { saleId, discountBp: 0 },
          data: { discountBp: defaultDiscount },
        });
      }
      await this.event(tx, saleId, 'CLIENT_CHANGE', actor, {
        details: { from: sale.clientId, to: clientId },
      });
    });
    return this.view(saleId, actor);
  }

  async addLine(saleId: string, input: AddSaleLineInput, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const sale = await this.lockDraft(tx, saleId, actor);
      const product = await tx.product.findUnique({
        where: { id: input.productId },
        include: { tvaRate: true },
      });
      if (!product) throw new AppError('NOT_FOUND', { entity: 'product' });
      if (!product.isActive) throw new AppError('PRODUCT_INACTIVE');
      const unit = input.unit ?? 'PACK';
      const qty = input.qty ?? 1;
      const price = catalogPrice(product, unit);
      const existing = sale.lines.find(
        (l) =>
          l.productId === product.id &&
          l.unit === unit &&
          !l.forcedLotId &&
          l.priceAuthorizedById === null,
      );
      if (existing) {
        const newQty = existing.qty + qty;
        await tx.saleLine.update({
          where: { id: existing.id },
          data: { qty: newQty, qtyBase: newQty * unitFactor(product, unit) },
        });
        await this.event(tx, saleId, 'QTY_CHANGE', actor, {
          productId: product.id,
          qty: newQty,
          details: { from: existing.qty },
        });
      } else {
        const discountBp = sale.client?.defaultDiscountBp ?? sale.globalDiscountBp ?? 0;
        await tx.saleLine.create({
          data: {
            saleId,
            lineNo: (sale.lines.at(-1)?.lineNo ?? 0) + 1,
            productId: product.id,
            qty,
            unit,
            qtyBase: qty * unitFactor(product, unit),
            catalogPriceTtc: price,
            unitPriceTtc: price,
            discountBp: Math.max(discountBp, sale.globalDiscountBp),
            tvaRateBp: product.tvaRate.rateBp,
            lineTotalTtc: 0n,
            createdAt: now(),
          },
        });
        await this.event(tx, saleId, 'ADD', actor, {
          productId: product.id,
          qty,
          details: { unit },
        });
      }
    });
    return this.view(saleId, actor);
  }

  /** Plafond de remise sans autorisation : max(plafond préparateur, remise habituelle du client). */
  private async discountLimit(tx: Tx, clientDefault: number | undefined): Promise<number> {
    return Math.max(
      await this.settings.get('sales.preparer_max_discount_bp', tx),
      clientDefault ?? 0,
    );
  }

  async updateLine(saleId: string, lineId: string, patch: UpdateSaleLineInput, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const sale = await this.lockDraft(tx, saleId, actor);
      const line = sale.lines.find((l) => l.id === lineId);
      if (!line) throw new AppError('NOT_FOUND', { entity: 'line' });
      const product = await tx.product.findUniqueOrThrow({
        where: { id: line.productId },
        include: { tvaRate: true },
      });
      const unit = patch.unit ?? line.unit;
      const qty = patch.qty ?? line.qty;
      const catalog = catalogPrice(product, unit);
      const data: Prisma.SaleLineUpdateInput = {
        qty,
        unit,
        qtyBase: qty * unitFactor(product, unit),
        catalogPriceTtc: catalog,
      };
      const req = new OverrideRequirements(actor);
      const events: { type: DraftEventType; details: Record<string, unknown> }[] = [];
      const audits: {
        eventType: 'DISCOUNT_OVER_LIMIT' | 'PRICE_OVERRIDE' | 'LOT_FORCED';
        summary: string;
        before: unknown;
        after: unknown;
      }[] = [];

      if (patch.qty !== undefined && patch.qty !== line.qty)
        events.push({ type: 'QTY_CHANGE', details: { from: line.qty, to: patch.qty } });
      if (patch.unit !== undefined && patch.unit !== line.unit) {
        data.unitPriceTtc = catalog;
        data.priceAuthorizedById = null;
      }

      if (patch.discountBp !== undefined && patch.discountBp !== line.discountBp) {
        const limit = await this.discountLimit(tx, sale.client?.defaultDiscountBp);
        data.discountBp = patch.discountBp;
        events.push({
          type: 'DISCOUNT_CHANGE',
          details: { from: line.discountBp, to: patch.discountBp },
        });
        if (patch.discountBp > limit) {
          req.require(
            'sales.discount_over_limit',
            `remise de ${patch.discountBp / 100} % (plafond ${limit / 100} %)`,
          );
          audits.push({
            eventType: 'DISCOUNT_OVER_LIMIT',
            summary: `Remise de ${patch.discountBp / 100} % sur ${product.name} (plafond ${limit / 100} %)`,
            before: { discountBp: line.discountBp },
            after: { discountBp: patch.discountBp },
          });
        } else data.discountAuthorizedById = null;
      }
      if (
        patch.unitPriceTtc !== undefined &&
        BigInt(patch.unitPriceTtc) !== (patch.unit ? catalog : line.unitPriceTtc)
      ) {
        const newPrice = BigInt(patch.unitPriceTtc);
        data.unitPriceTtc = newPrice;
        events.push({
          type: 'PRICE_CHANGE',
          details: { from: num(line.unitPriceTtc), to: patch.unitPriceTtc, catalog: num(catalog) },
        });
        if (newPrice !== catalog) {
          req.require(
            'sales.price_override',
            `prix de ${product.name} modifié (${money(catalog)} → ${money(newPrice)})`,
          );
          audits.push({
            eventType: 'PRICE_OVERRIDE',
            summary: `Prix de ${product.name} modifié en vente : ${money(catalog)} → ${money(newPrice)}`,
            before: { unitPriceTtc: catalog },
            after: { unitPriceTtc: newPrice },
          });
        } else data.priceAuthorizedById = null;
      }
      if (patch.forcedLotId !== undefined && patch.forcedLotId !== line.forcedLotId) {
        data.forcedLotId = patch.forcedLotId;
        events.push({ type: 'LOT_FORCE', details: { lotId: patch.forcedLotId } });
        if (patch.forcedLotId) {
          const lot = await tx.lot.findUnique({ where: { id: patch.forcedLotId } });
          const sellableFrom = await this.stock.sellableFrom(tx);
          if (!lot || lot.productId !== product.id) throw new AppError('LOT_NOT_FOUND');
          if (
            lot.status !== 'ACTIVE' ||
            lot.remainingQty <= 0 ||
            lot.expiryDate.toISOString().slice(0, 10) <= sellableFrom
          )
            throw new AppError('LOT_NOT_SELLABLE');
          req.require(
            'sales.force_lot',
            `lot ${lot.lotNumber} de ${product.name} forcé hors règle de sortie`,
          );
          audits.push({
            eventType: 'LOT_FORCED',
            summary: `Lot ${lot.lotNumber} forcé pour ${product.name} (hors règle FEFO/FIFO)`,
            before: null,
            after: { lotId: lot.id, lotNumber: lot.lotNumber },
          });
        } else data.lotAuthorizedById = null;
      }

      const grant = await this.overrides.resolve(
        tx,
        req,
        patch.override as OverrideInput | undefined,
        actor,
        {
          entityType: 'sale',
          entityId: saleId,
          action: `modification d’une ligne du panier (${product.name})`,
        },
      );
      const authorizer = grant?.id ?? actor.userId;
      if (audits.some((a) => a.eventType === 'DISCOUNT_OVER_LIMIT'))
        data.discountAuthorizedById = authorizer;
      if (audits.some((a) => a.eventType === 'PRICE_OVERRIDE'))
        data.priceAuthorizedById = authorizer;
      if (audits.some((a) => a.eventType === 'LOT_FORCED')) data.lotAuthorizedById = authorizer;
      await tx.saleLine.update({ where: { id: lineId }, data });
      for (const e of events)
        await this.event(tx, saleId, e.type, actor, {
          productId: product.id,
          qty,
          details: e.details,
        });
      for (const a of audits) {
        await this.audit.record(tx, {
          eventType: a.eventType,
          actor,
          authorizedBy: grant ? { id: grant.id, code: grant.code } : null,
          entityType: 'sale',
          entityId: saleId,
          entityRef: 'Panier en cours',
          summary: a.summary,
          before: a.before,
          after: a.after,
          reason: grant?.reason ?? null,
          notify: { data: { productName: product.name, discountBp: patch.discountBp ?? null } },
        });
      }
    });
    return this.view(saleId, actor);
  }

  /** Remise globale : appliquée à toutes les lignes (mêmes règles de plafond). */
  async setGlobalDiscount(
    saleId: string,
    discountBp: number,
    override: OverrideInput | undefined,
    actor: Actor,
  ) {
    await this.prisma.tx(async (tx) => {
      const sale = await this.lockDraft(tx, saleId, actor);
      const limit = await this.discountLimit(tx, sale.client?.defaultDiscountBp);
      const req = new OverrideRequirements(actor);
      if (discountBp > limit)
        req.require(
          'sales.discount_over_limit',
          `remise globale de ${discountBp / 100} % (plafond ${limit / 100} %)`,
        );
      const grant = await this.overrides.resolve(tx, req, override, actor, {
        entityType: 'sale',
        entityId: saleId,
        action: 'remise globale sur le panier',
      });
      await tx.sale.update({ where: { id: saleId }, data: { globalDiscountBp: discountBp } });
      await tx.saleLine.updateMany({
        where: { saleId },
        data: {
          discountBp,
          discountAuthorizedById: discountBp > limit ? (grant?.id ?? actor.userId) : null,
        },
      });
      await this.event(tx, saleId, 'DISCOUNT_CHANGE', actor, {
        details: { global: true, from: sale.globalDiscountBp, to: discountBp },
      });
      if (discountBp > limit) {
        await this.audit.record(tx, {
          eventType: 'DISCOUNT_OVER_LIMIT',
          actor,
          authorizedBy: grant ? { id: grant.id, code: grant.code } : null,
          entityType: 'sale',
          entityId: saleId,
          entityRef: 'Panier en cours',
          summary: `Remise globale de ${discountBp / 100} % (plafond ${limit / 100} %)`,
          before: { discountBp: sale.globalDiscountBp },
          after: { discountBp },
          reason: grant?.reason ?? null,
          notify: { data: { discountBp } },
        });
      }
    });
    return this.view(saleId, actor);
  }

  /** Retrait d'une ligne avant validation : toujours tracé au mouchard (§6.6). */
  async removeLine(saleId: string, lineId: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const sale = await this.lockDraft(tx, saleId, actor);
      const line = sale.lines.find((l) => l.id === lineId);
      if (!line) throw new AppError('NOT_FOUND', { entity: 'line' });
      const product = await tx.product.findUniqueOrThrow({
        where: { id: line.productId },
        select: { name: true, internalCode: true },
      });
      await tx.saleLine.delete({ where: { id: lineId } });
      await this.event(tx, saleId, 'REMOVE', actor, {
        productId: line.productId,
        qty: line.qty,
        details: { unitPriceTtc: num(line.unitPriceTtc) },
      });
      await this.audit.record(tx, {
        eventType: 'CART_LINE_REMOVED',
        actor,
        entityType: 'sale',
        entityId: saleId,
        entityRef: sale.client ? `Panier — ${sale.client.name}` : 'Panier en cours',
        summary: `Ligne retirée du panier : ${line.qty} × ${product.name} (${money(line.unitPriceTtc * BigInt(line.qty))})`,
        before: {
          productId: line.productId,
          product: product.name,
          qty: line.qty,
          unit: line.unit,
          unitPriceTtc: line.unitPriceTtc,
        },
        notify: { data: { amount: num(line.unitPriceTtc) * line.qty } },
      });
    });
    return this.view(saleId, actor);
  }

  async setPrescription(saleId: string, input: PrescriptionInput, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      await this.lockDraft(tx, saleId, actor);
      await tx.sale.update({
        where: { id: saleId },
        data: {
          prescriberName: input.prescriberName ?? null,
          prescriptionRef: input.prescriptionRef ?? null,
          prescriptionDate: input.prescriptionDate
            ? new Date(`${input.prescriptionDate}T00:00:00Z`)
            : null,
        },
      });
    });
    return this.view(saleId, actor);
  }

  /** Mise en attente (F8) : la vente est visible de tous les postes. */
  async hold(saleId: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const sale = await this.lockDraft(tx, saleId, actor);
      if (sale.lines.length === 0) throw new AppError('SALE_EMPTY');
      await tx.sale.update({
        where: { id: saleId },
        data: { status: 'ON_HOLD', heldAt: now(), heldById: actor.userId },
      });
      await this.event(tx, saleId, 'HOLD', actor);
    });
    return { id: saleId, status: 'ON_HOLD' };
  }

  async resume(saleId: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      await this.lockDraft(tx, saleId, actor, ['ON_HOLD']);
      // La vente reprise devient le panier de l'utilisateur sur ce poste.
      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: 'DRAFT',
          heldAt: null,
          heldById: null,
          deviceId: actor.deviceId,
          createdById: actor.userId,
        },
      });
      await this.event(tx, saleId, 'RESUME', actor);
    });
    return this.view(saleId, actor);
  }

  /** Abandon du panier ou d'une vente en attente (tracé, RG-01). */
  async discard(saleId: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const sale = await this.lockDraft(tx, saleId, actor, ['DRAFT', 'ON_HOLD']);
      await tx.sale.update({ where: { id: saleId }, data: { status: 'DISCARDED' } });
      await this.event(tx, saleId, 'DISCARD', actor);
      if (sale.lines.length > 0) {
        const total = sale.lines.reduce((a, l) => a + num(l.unitPriceTtc) * l.qty, 0);
        await this.audit.record(tx, {
          eventType: 'DRAFT_SALE_DISCARDED',
          actor,
          entityType: 'sale',
          entityId: saleId,
          entityRef: sale.client ? `Panier — ${sale.client.name}` : 'Panier',
          summary: `${sale.status === 'ON_HOLD' ? 'Vente en attente' : 'Panier'} abandonné : ${sale.lines.length} ligne(s), ${money(total)}`,
          before: {
            lines: sale.lines.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              unitPriceTtc: l.unitPriceTtc,
            })),
          },
          notify: { data: { amount: total } },
        });
      }
    });
    return { id: saleId, status: 'DISCARDED' };
  }

  async onHold() {
    const sales = await this.prisma.sale.findMany({
      where: { status: 'ON_HOLD' },
      orderBy: { heldAt: 'asc' },
      include: {
        client: { select: { id: true, name: true, code: true } },
        lines: { select: { qty: true, unitPriceTtc: true, discountBp: true } },
      },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: sales.map((s) => s.heldById).filter((x): x is string => !!x) } },
      select: { id: true, code: true },
    });
    return sales.map((s) => ({
      id: s.id,
      heldAt: s.heldAt,
      heldBy: users.find((u) => u.id === s.heldById)?.code ?? null,
      client: s.client,
      lineCount: s.lines.length,
      estimatedTotal: s.lines.reduce(
        (a, l) => a + mulDivRound(num(l.unitPriceTtc) * l.qty, 10_000 - l.discountBp, 10_000),
        0,
      ),
    }));
  }

  // =========================================================================
  // Vue du panier / de la vente (aperçu des lots, totaux, contrôles)
  // =========================================================================

  async view(saleId: string, actor: Actor) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        client: true,
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: {
              include: { tvaRate: true, barcodes: { take: 1, orderBy: { isPrimary: 'desc' } } },
            },
            allocations: { include: { lot: { select: { lotNumber: true, expiryDate: true } } } },
          },
        },
        allocations: { where: { cancelledAt: null }, include: { payment: true } },
        creditAllocs: {
          where: { cancelledAt: null },
          include: { creditNote: { select: { number: true } } },
        },
      },
    });
    if (!sale) throw new AppError('NOT_FOUND');
    const settings = await this.settings.all();
    const isDraft = sale.status === 'DRAFT' || sale.status === 'ON_HOLD';
    const showCosts = actor.permissions.has('catalog.view_costs');

    // Prix : les lignes non modifiées suivent le prix catalogue courant.
    const lines = sale.lines.map((l) => {
      const catalog = isDraft ? catalogPrice(l.product, l.unit) : l.catalogPriceTtc;
      const unitPrice = isDraft && l.priceAuthorizedById === null ? catalog : l.unitPriceTtc;
      return { line: l, catalog, unitPrice };
    });
    const totals = computeSaleTotals(
      lines.map(({ line, unitPrice }) => ({
        qty: line.qty,
        unitPriceTtc: num(unitPrice),
        discountBp: line.discountBp,
        tvaBp: line.tvaRateBp,
      })),
      isDraft ? this.stampDuty(settings, sale.client) : num(sale.stampDuty),
    );

    let previews = new Map<number, PlannedAllocation[]>();
    let issues: {
      productId: string;
      requested: number;
      sellable: number;
      blocked: number;
      expired: number;
    }[] = [];
    if (isDraft && lines.length > 0) {
      const planned = await planAllocations(
        this.prisma,
        lines.map(({ line }, index) => ({
          index,
          productId: line.productId,
          productName: line.product.name,
          qtyBase: line.qtyBase,
          forcedLotId: line.forcedLotId,
        })),
        {
          exitRule: settings['stock.exit_rule'],
          sellableFrom: await this.stock.sellableFrom(),
          lock: false,
          throwOnShortage: false,
        },
      );
      previews = planned.plans;
      issues = planned.issues;
    }
    const productIds = [...new Set(sale.lines.map((l) => l.productId))];
    const sellable =
      isDraft && productIds.length > 0
        ? await this.prisma.$queryRaw<
            { product_id: string; sellable: bigint; next_expiry: Date | null }[]
          >`
          SELECT product_id, COALESCE(SUM(remaining_qty), 0)::bigint AS sellable, MIN(expiry_date) AS next_expiry FROM lots
          WHERE product_id = ANY(${productIds}::uuid[]) AND status = 'ACTIVE' AND remaining_qty > 0 AND expiry_date > ${await this.stock.sellableFrom()}::date
          GROUP BY product_id`
        : [];
    const prescriptionMode = settings['sales.prescription_required_for'];
    const prescriptionRequired = sale.lines.some((l) =>
      prescriptionMode === 'NONE'
        ? false
        : prescriptionMode === 'CONTROLLED_ONLY'
          ? l.product.controlledClass !== 'NONE'
          : l.product.requiresPrescription || l.product.controlledClass !== 'NONE',
    );
    const userIds = [
      sale.createdById,
      sale.validatedById,
      sale.cancelledById,
      sale.cancelAuthorizedById,
      sale.authorizedById,
      sale.creditAuthorizedById,
    ].filter((x): x is string => !!x);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, code: true, fullName: true },
    });
    const userOf = (id: string | null) => (id ? (users.find((u) => u.id === id) ?? null) : null);
    const [replacedBy, replaces] = await Promise.all([
      this.prisma.sale.findFirst({
        where: { replacesSaleId: sale.id },
        select: { id: true, number: true },
      }),
      sale.replacesSaleId
        ? this.prisma.sale.findUnique({
            where: { id: sale.replacesSaleId },
            select: { id: true, number: true },
          })
        : null,
    ]);

    return {
      id: sale.id,
      number: sale.number,
      status: sale.status,
      paymentStatus: sale.paymentStatus,
      returnStatus: sale.returnStatus,
      createdAt: sale.createdAt,
      validatedAt: sale.validatedAt,
      heldAt: sale.heldAt,
      dueDate: sale.dueDate,
      deviceId: sale.deviceId,
      client: sale.client
        ? {
            id: sale.client.id,
            code: sale.client.code,
            name: sale.client.name,
            type: sale.client.type,
            phone: sale.client.phone,
            email: sale.client.email,
            emailConsent: sale.client.emailConsent,
            emailDocPrefs: sale.client.emailDocPrefs,
            isWalkIn: sale.client.isWalkIn,
            defaultDiscountBp: sale.client.defaultDiscountBp,
            account: await this.ledger.summary(sale.client.id),
          }
        : null,
      lines: lines.map(({ line, catalog, unitPrice }, index) => {
        const priced = totals.lines[index]!;
        const stockRow = sellable.find((s) => s.product_id === line.productId);
        const issue = issues.find((i) => i.productId === line.productId);
        return {
          id: line.id,
          lineNo: line.lineNo,
          qty: line.qty,
          unit: line.unit,
          qtyBase: line.qtyBase,
          catalogPriceTtc: catalog,
          unitPriceTtc: unitPrice,
          discountBp: line.discountBp,
          discountAmount: priced.discountAmount,
          lineTotalTtc: priced.lineTotalTtc,
          tvaRateBp: line.tvaRateBp,
          forcedLotId: line.forcedLotId,
          returnedQtyBase: line.returnedQtyBase,
          costTotal: showCosts && !isDraft ? line.costTotal : null,
          authorized: {
            discount: !!line.discountAuthorizedById,
            price: !!line.priceAuthorizedById,
            lot: !!line.lotAuthorizedById,
          },
          product: {
            id: line.product.id,
            internalCode: line.product.internalCode,
            name: line.product.name,
            dosage: line.product.dosage,
            form: line.product.form,
            unitsPerPack: line.product.unitsPerPack,
            sellByUnit: line.product.sellByUnit,
            salePriceTtc: line.product.salePriceTtc,
            unitSalePriceTtc: line.product.unitSalePriceTtc,
            requiresPrescription: line.product.requiresPrescription,
            controlledClass: line.product.controlledClass,
            coldChain: line.product.coldChain,
            returnable: line.product.returnable,
            sellable: stockRow ? num(stockRow.sellable) : isDraft ? 0 : null,
            nextExpiry: stockRow?.next_expiry?.toISOString().slice(0, 10) ?? null,
          },
          lots: isDraft
            ? (previews.get(index) ?? []).map((p) => ({
                lotId: p.lotId,
                lotNumber: p.lotNumber,
                expiryDate: p.expiryDate,
                qty: p.qty,
              }))
            : line.allocations.map((a) => ({
                lotId: a.lotId,
                lotNumber: a.lot.lotNumber,
                expiryDate: a.lot.expiryDate.toISOString().slice(0, 10),
                qty: a.qtyBase,
                returnedQty: a.returnedQtyBase,
                unitCostHt: showCosts ? a.unitCostHt : null,
              })),
          stockIssue: issue ?? null,
        };
      }),
      totals,
      globalDiscountBp: sale.globalDiscountBp,
      prescription: {
        required: prescriptionRequired,
        prescriberName: sale.prescriberName,
        prescriptionRef: sale.prescriptionRef,
        prescriptionDate: sale.prescriptionDate?.toISOString().slice(0, 10) ?? null,
      },
      amountPaid: sale.amountPaid,
      amountDue: sale.amountDue,
      returnedAmount: sale.returnedAmount,
      cashTendered: sale.cashTendered,
      changeGiven: sale.changeGiven,
      totalCost: showCosts && !isDraft ? sale.totalCost : null,
      payments: [
        ...sale.allocations.map((a) => ({
          kind: 'PAYMENT' as const,
          id: a.payment.id,
          number: a.payment.number,
          method: a.payment.method,
          amount: a.amount,
          paidAt: a.payment.paidAt,
          chequeNumber: a.payment.chequeNumber,
          bank: a.payment.bank,
          reference: a.payment.reference,
        })),
        ...sale.creditAllocs.map((a) => ({
          kind: 'CREDIT_NOTE' as const,
          id: a.creditNoteId,
          number: a.creditNote.number,
          method: 'CREDIT_NOTE' as const,
          amount: a.amount,
          paidAt: a.createdAt,
        })),
      ],
      createdBy: userOf(sale.createdById),
      validatedBy: userOf(sale.validatedById),
      cancelledBy: userOf(sale.cancelledById),
      cancelAuthorizedBy: userOf(sale.cancelAuthorizedById),
      cancelledAt: sale.cancelledAt,
      cancelReason: sale.cancelReason,
      creditAuthorizedBy: userOf(sale.creditAuthorizedById),
      replaces,
      replacedBy,
      printCount: sale.printCount,
    };
  }

  private stampDuty(
    settings: Awaited<ReturnType<SettingsService['all']>>,
    client: { type: string; isWalkIn: boolean } | null,
  ): number {
    const scope = settings['tax.stamp_duty_scope'];
    if (scope === 'NONE') return 0;
    if (scope === 'ALL') return settings['tax.stamp_duty_amount'];
    return client && !client.isWalkIn && isProfessionalClient(client.type)
      ? settings['tax.stamp_duty_amount']
      : 0;
  }

  // =========================================================================
  // Validation (RG-05, RG-09, RG-10, RG-17, RG-18, RG-19, RG-23)
  // =========================================================================

  async validate(
    saleId: string,
    input: ValidateSaleInput,
    idempotencyKey: string | undefined,
    actor: Actor,
  ) {
    // Rejeu (double clic, coupure) : on renvoie le résultat initial sans double écriture.
    if (idempotencyKey) {
      const previous = await this.prisma.sale.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (previous) {
        if (previous.id !== saleId) throw new AppError('IDEMPOTENCY_CONFLICT');
        return { sale: await this.view(saleId, actor), warnings: [] as string[] };
      }
    }
    if (await this.settings.get('sales.require_pin_on_validation')) {
      if (!input.pin) throw new AppError('PIN_REQUIRED');
      await this.auth.confirmOwnPin(actor, input.pin);
    }
    const warnings: string[] = [];
    await this.prisma.tx(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { status: string; idempotency_key: string | null; created_by: string }[]
        >`SELECT status, idempotency_key, created_by FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
        if (rows.length === 0) throw new AppError('NOT_FOUND');
        if (
          rows[0]!.status === 'VALIDATED' &&
          idempotencyKey &&
          rows[0]!.idempotency_key === idempotencyKey
        )
          return null;
        if (rows[0]!.status !== 'DRAFT')
          throw new AppError('SALE_NOT_DRAFT', { status: rows[0]!.status });
        if (rows[0]!.created_by !== actor.userId)
          throw new AppError('FORBIDDEN', undefined, {
            message: 'Ce panier appartient à un autre utilisateur.',
          });
        return this.validateCore(tx, saleId, input, idempotencyKey ?? null, actor, {}, warnings);
      },
      { timeout: 60_000 },
    );
    return { sale: await this.view(saleId, actor), warnings };
  }

  /** Cœur de la validation, dans une transaction (partagé avec la modification RG-13). */
  private async validateCore(
    tx: Tx,
    saleId: string,
    input: ValidateSaleInput,
    idempotencyKey: string | null,
    actor: Actor,
    options: ValidateOptions,
    warnings: string[],
  ) {
    const settings = await this.settings.all(tx);
    const at = now();
    let sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: {
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { include: { tvaRate: true } } } },
      },
    });
    if (sale.lines.length === 0) throw new AppError('SALE_EMPTY');

    // --- Acheteur obligatoire (RG-09) ---------------------------------------
    if (!sale.clientId) {
      if (!settings['sales.walk_in_client_enabled'] || !actor.permissions.has('sales.walk_in'))
        throw new AppError('CLIENT_REQUIRED');
      const existing = await tx.client.findFirst({ where: { isWalkIn: true } });
      const walkIn =
        existing ??
        (await tx.client.create({
          data: {
            code: 'COMPTOIR',
            name: 'Client comptoir',
            type: 'INDIVIDUAL',
            isWalkIn: true,
            searchText: 'comptoir client comptoir',
          },
        }));
      await tx.sale.update({ where: { id: saleId }, data: { clientId: walkIn.id } });
      sale = { ...sale, clientId: walkIn.id };
    }
    const client = await this.ledger.lockClient(tx, sale.clientId!);
    if (!client.is_active) throw new AppError('CLIENT_INACTIVE');

    // --- Ordonnance -------------------------------------------------------------
    const mode = settings['sales.prescription_required_for'];
    const needsPrescription = sale.lines.some((l) =>
      mode === 'NONE'
        ? false
        : mode === 'CONTROLLED_ONLY'
          ? l.product.controlledClass !== 'NONE'
          : l.product.requiresPrescription || l.product.controlledClass !== 'NONE',
    );
    if (needsPrescription && (!sale.prescriberName || !sale.prescriptionRef)) {
      throw new AppError('PRESCRIPTION_REQUIRED', {
        products: sale.lines
          .filter((l) => l.product.requiresPrescription || l.product.controlledClass !== 'NONE')
          .map((l) => l.product.name),
      });
    }

    // --- Prix courants, remises autorisées ---------------------------------------
    const limit = await this.discountLimit(
      tx,
      (await tx.client.findUniqueOrThrow({ where: { id: client.id } })).defaultDiscountBp,
    );
    for (const line of sale.lines) {
      if (!line.product.isActive)
        throw new AppError('PRODUCT_INACTIVE', { product: line.product.name });
      const catalog = catalogPrice(line.product, line.unit);
      const unitPrice = line.priceAuthorizedById === null ? catalog : line.unitPriceTtc;
      if (
        line.discountBp > limit &&
        !line.discountAuthorizedById &&
        !actor.permissions.has('sales.discount_over_limit')
      ) {
        throw new AppError('DISCOUNT_TOO_HIGH', { product: line.product.name });
      }
      line.catalogPriceTtc = catalog;
      line.unitPriceTtc = unitPrice;
    }

    // --- Verrous et allocation des lots (RG-05) ------------------------------------
    await this.stock.lockProducts(
      tx,
      sale.lines.map((l) => l.productId),
    );
    const { plans } = await planAllocations(
      tx,
      sale.lines.map((l, index) => ({
        index,
        productId: l.productId,
        productName: l.product.name,
        qtyBase: l.qtyBase,
        forcedLotId: l.forcedLotId,
      })),
      {
        exitRule: settings['stock.exit_rule'],
        sellableFrom: await this.stock.sellableFrom(tx),
        lock: true,
        throwOnShortage: true,
      },
    );

    // --- Totaux ---------------------------------------------------------------------
    const stampDuty = this.stampDuty(settings, { type: client.type, isWalkIn: client.is_walk_in });
    const totals = computeSaleTotals(
      sale.lines.map((l) => ({
        qty: l.qty,
        unitPriceTtc: num(l.unitPriceTtc),
        discountBp: l.discountBp,
        tvaBp: l.tvaRateBp,
      })),
      stampDuty,
    );

    // --- Contrôles à autoriser : vente sous le coût (RG-18), plafond de crédit (RG-17) ---
    const req = new OverrideRequirements(actor);
    sale.lines.forEach((line, index) => {
      const plan = plans.get(index) ?? [];
      const netHtPerBase =
        htFromTtc(totals.lines[index]!.lineTotalTtc, line.tvaRateBp) / line.qtyBase;
      const maxCost = Math.max(...plan.map((p) => num(p.unitCostHt)), 0);
      if (netHtPerBase < maxCost && !line.belowCostAuthorizedById) {
        req.require('sales.below_cost', `${line.product.name} vendu sous le coût du lot`);
      }
    });
    const credit = options.transfer ? 0 : (input.useCredit ?? 0);
    const paymentsTotal = (input.payments ?? []).reduce((a, p) => a + p.amount, 0);
    if (client.is_walk_in && credit > 0) throw new AppError('CREDIT_NOT_ALLOWED');
    // Montant transféré (modification) : calculé plus bas, avant le contrôle du plafond.
    let transferable = 0;
    if (options.transfer) {
      const sources = await this.ledger.creditSources(tx, client.id, true);
      transferable = sources
        .filter(
          (s) =>
            (s.kind === 'PAYMENT' && options.transfer!.paymentIds.includes(s.id)) ||
            (s.kind === 'CREDIT_NOTE' && options.transfer!.creditNoteIds.includes(s.id)),
        )
        .reduce((a, s) => a + s.available, 0);
    }
    const transferUsed = Math.min(transferable, totals.totalTtc);
    const covered = paymentsTotal + credit + transferUsed;
    if (covered > totals.totalTtc)
      throw new AppError('PAYMENT_MISMATCH', { total: totals.totalTtc, covered });
    const due = totals.totalTtc - covered;
    if (due > 0) {
      if (client.is_walk_in)
        throw new AppError('CREDIT_NOT_ALLOWED', undefined, {
          message: 'Le client comptoir doit régler la totalité.',
        });
      if (!actor.permissions.has('sales.credit'))
        throw new AppError(
          'FORBIDDEN',
          { permissions: ['sales.credit'] },
          { message: 'Vous n’êtes pas autorisé à vendre à crédit.' },
        );
      const balanceAfter = num(client.balance) + due;
      if (balanceAfter > num(client.credit_limit)) {
        req.require(
          'sales.credit_over_limit',
          `plafond de crédit de ${client.name} dépassé (${money(balanceAfter)} pour un plafond de ${money(client.credit_limit)})`,
        );
      }
    }
    const grant = await this.overrides.resolve(
      tx,
      req,
      input.override as OverrideInput | undefined,
      actor,
      {
        entityType: 'sale',
        entityId: saleId,
        entityRef: client.name,
        action: `validation de la vente à ${client.name}`,
      },
    );

    // --- Numéro, écritures de stock (ordre des verrous : caisse puis séquences) ---------------
    const cashSession = actor.deviceId ? await this.cash.lockOpenSession(tx, actor.deviceId) : null;
    const number = await this.sequences.next(tx, 'FAC', at);
    let totalCost = 0;
    for (const [index, line] of sale.lines.entries()) {
      const plan = plans.get(index) ?? [];
      const lineTotal = totals.lines[index]!;
      const unitPriceBase = mulDivRound(lineTotal.lineTotalTtc, 1, line.qtyBase);
      let lineCost = 0;
      for (const alloc of plan) {
        await tx.saleLineAllocation.create({
          data: {
            saleLineId: line.id,
            lotId: alloc.lotId,
            qtyBase: alloc.qty,
            unitCostHt: alloc.unitCostHt,
          },
        });
        await this.stock.move(tx, {
          lot: { id: alloc.lotId, product_id: line.productId, site_id: alloc.siteId },
          type: 'SALE_OUT',
          qty: -alloc.qty,
          unitCostHt: alloc.unitCostHt,
          unitPriceTtc: unitPriceBase,
          documentType: 'SALE',
          documentId: saleId,
          documentNumber: number,
          counterpartType: 'CLIENT',
          counterpartId: client.id,
          counterpartName: client.name,
          actor,
          authorizedById:
            line.lotAuthorizedById && line.lotAuthorizedById !== actor.userId
              ? line.lotAuthorizedById
              : null,
          at,
        });
        lineCost += alloc.qty * num(alloc.unitCostHt);
      }
      totalCost += lineCost;
      await tx.saleLine.update({
        where: { id: line.id },
        data: {
          catalogPriceTtc: line.catalogPriceTtc,
          unitPriceTtc: line.unitPriceTtc,
          discountAmount: BigInt(lineTotal.discountAmount),
          lineTotalTtc: BigInt(lineTotal.lineTotalTtc),
          costTotal: BigInt(lineCost),
          belowCostAuthorizedById:
            grant && req.missing.has('sales.below_cost') ? grant.id : line.belowCostAuthorizedById,
        },
      });
    }

    // --- Facture, compte client, règlements -------------------------------------------------
    const clientTerms = (
      await tx.client.findUniqueOrThrow({
        where: { id: client.id },
        select: { paymentTermsDays: true },
      })
    ).paymentTermsDays;
    const tendered = (input.payments ?? [])
      .filter((p) => p.method === 'CASH')
      .reduce((a, p) => a + (p.tendered ?? p.amount), 0);
    const cashAmount = (input.payments ?? [])
      .filter((p) => p.method === 'CASH')
      .reduce((a, p) => a + p.amount, 0);
    const tz = settings['general.timezone'];
    await tx.sale.update({
      where: { id: saleId },
      data: {
        number,
        status: 'VALIDATED',
        subtotalHt: BigInt(totals.subtotalHt),
        totalTva: BigInt(totals.totalTva),
        totalDiscount: BigInt(totals.totalDiscount),
        stampDuty: BigInt(totals.stampDuty),
        totalTtc: BigInt(totals.totalTtc),
        totalCost: BigInt(totalCost),
        taxBreakdown: totals.taxes as unknown as Prisma.InputJsonValue,
        validatedById: actor.userId,
        validatedAt: at,
        authorizedById: grant?.id ?? null,
        creditAuthorizedById: grant && req.missing.has('sales.credit_over_limit') ? grant.id : null,
        cashSessionId: cashSession?.id ?? null,
        deviceId: actor.deviceId,
        idempotencyKey,
        cashTendered: tendered > 0 ? BigInt(tendered) : null,
        changeGiven: tendered > cashAmount ? BigInt(tendered - cashAmount) : null,
        dueDate:
          due > 0 ? new Date(`${addDaysIso(todayIso(tz, at), clientTerms)}T00:00:00Z`) : null,
      },
    });
    await this.ledger.post(tx, {
      clientId: client.id,
      type: 'INVOICE',
      debit: totals.totalTtc,
      documentType: 'SALE',
      documentId: saleId,
      documentNumber: number,
      description: `Facture ${number}`,
      actor,
      at,
    });
    for (const p of input.payments ?? []) {
      await this.payments.create(tx, {
        clientId: client.id,
        payment: p,
        actor,
        at,
        allocateToSaleId: saleId,
        saleId,
      });
    }
    if (options.transfer) {
      await this.reallocate(tx, client.id, saleId, options.transfer, transferUsed, actor, at);
    }
    if (credit > 0) await this.ledger.consumeCredit(tx, client.id, saleId, credit, actor, at);
    await this.ledger.refreshSaleAmounts(tx, saleId);

    // --- Audit --------------------------------------------------------------------------------
    if (grant && req.missing.has('sales.credit_over_limit')) {
      await this.audit.record(tx, {
        eventType: 'CREDIT_LIMIT_OVERRIDE',
        actor,
        authorizedBy: { id: grant.id, code: grant.code },
        entityType: 'sale',
        entityId: saleId,
        entityRef: number,
        summary: `Plafond de crédit de ${client.name} dépassé (vente ${number}, reste dû ${money(due)})`,
        reason: grant.reason,
        after: { due, creditLimit: client.credit_limit, balanceBefore: client.balance },
      });
    }
    if (grant && req.missing.has('sales.below_cost')) {
      await this.audit.record(tx, {
        eventType: 'SALE_BELOW_COST',
        actor,
        authorizedBy: { id: grant.id, code: grant.code },
        entityType: 'sale',
        entityId: saleId,
        entityRef: number,
        summary: `Vente ${number} sous le coût du lot autorisée`,
        reason: grant.reason,
      });
    }
    await this.audit.record(tx, {
      eventType: 'SALE_VALIDATED',
      actor,
      authorizedBy: grant ? { id: grant.id, code: grant.code } : null,
      entityType: 'sale',
      entityId: saleId,
      entityRef: number,
      summary: `Vente ${number} validée — ${client.name} — ${money(totals.totalTtc)}${due > 0 ? ` (reste dû ${money(due)})` : ''}`,
      after: { totalTtc: totals.totalTtc, due, lines: sale.lines.length },
      notify: false,
    });

    // --- E-mail de la facture (file d'envoi transactionnelle, jamais bloquant) -----------------
    if (input.sendEmail || input.emailTo) {
      const queued = await this.outbox.queueDocument(tx, {
        kind: 'INVOICE',
        entityType: 'sale',
        entityId: saleId,
        clientId: client.id,
        to: input.emailTo ? [input.emailTo] : undefined,
        manual: !!input.emailTo || input.sendEmail === true,
        actor,
      });
      if (!queued.queued) warnings.push(queued.reason);
    }
    return { number, due };
  }

  /** Réaffecte en priorité les règlements / avoirs indiqués (modification RG-13). */
  private async reallocate(
    tx: Tx,
    clientId: string,
    saleId: string,
    transfer: { paymentIds: string[]; creditNoteIds: string[] },
    max: number,
    actor: Actor,
    at: Date,
  ) {
    let rest = max;
    const sources = (await this.ledger.creditSources(tx, clientId, true)).filter(
      (s) =>
        (s.kind === 'PAYMENT' && transfer.paymentIds.includes(s.id)) ||
        (s.kind === 'CREDIT_NOTE' && transfer.creditNoteIds.includes(s.id)),
    );
    for (const s of sources) {
      if (rest <= 0) break;
      const take = Math.min(rest, s.available);
      if (s.kind === 'PAYMENT') {
        await tx.paymentAllocation.create({
          data: {
            paymentId: s.id,
            saleId,
            amount: BigInt(take),
            createdById: actor.userId,
            createdAt: at,
          },
        });
      } else {
        await tx.creditNoteAllocation.create({
          data: {
            creditNoteId: s.id,
            saleId,
            amount: BigInt(take),
            createdById: actor.userId,
            createdAt: at,
          },
        });
        await tx.$executeRaw`UPDATE credit_notes SET remaining_amount = remaining_amount - ${take} WHERE id = ${s.id}::uuid`;
      }
      rest -= take;
    }
  }

  // =========================================================================
  // Annulation (RG-11, RG-12) et modification (RG-13)
  // =========================================================================

  private async snapshot(tx: Tx, saleId: string) {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: {
        client: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: { select: { name: true, internalCode: true } },
            allocations: { include: { lot: { select: { lotNumber: true } } } },
          },
        },
        allocations: {
          where: { cancelledAt: null },
          include: { payment: { select: { number: true, method: true } } },
        },
        creditAllocs: {
          where: { cancelledAt: null },
          include: { creditNote: { select: { number: true } } },
        },
      },
    });
    return {
      number: sale.number,
      client: sale.client,
      totalTtc: sale.totalTtc,
      amountPaid: sale.amountPaid,
      amountDue: sale.amountDue,
      validatedAt: sale.validatedAt,
      lines: sale.lines.map((l) => ({
        product: `${l.product.internalCode} — ${l.product.name}`,
        qty: l.qty,
        unit: l.unit,
        unitPriceTtc: l.unitPriceTtc,
        discountBp: l.discountBp,
        lineTotalTtc: l.lineTotalTtc,
        lots: l.allocations.map((a) => `${a.lot.lotNumber} × ${a.qtyBase}`),
      })),
      payments: [
        ...sale.allocations.map((a) => ({
          number: a.payment.number,
          method: a.payment.method,
          amount: a.amount,
        })),
        ...sale.creditAllocs.map((a) => ({
          number: a.creditNote.number,
          method: 'AVOIR',
          amount: a.amount,
        })),
      ],
    };
  }

  /** Défait une vente validée : stock réintégré dans les lots d'origine, règlements libérés. */
  private async undo(
    tx: Tx,
    saleId: string,
    refundMode: 'REFUND' | 'CREDIT' | 'KEEP',
    reason: string,
    actor: Actor,
    at: Date,
  ): Promise<{ paymentIds: string[]; creditNoteIds: string[]; refunded: number }> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: {
        client: true,
        lines: { include: { allocations: true } },
        allocations: { where: { cancelledAt: null }, include: { payment: true } },
        creditAllocs: { where: { cancelledAt: null } },
      },
    });
    if (sale.status === 'CANCELLED') throw new AppError('SALE_ALREADY_CANCELLED');
    if (sale.status !== 'VALIDATED') throw new AppError('SALE_NOT_VALIDATED');
    if (sale.returnStatus !== 'NONE' || sale.lines.some((l) => l.returnedQtyBase > 0))
      throw new AppError('SALE_HAS_RETURNS');
    await this.ledger.lockClient(tx, sale.clientId!);
    await this.stock.lockProducts(
      tx,
      sale.lines.map((l) => l.productId),
    );
    const lotIds = sale.lines.flatMap((l) => l.allocations.map((a) => a.lotId));
    const lots = await this.stock.lockLots(tx, lotIds);

    // Stock : réintégration exacte dans les lots d'origine (même périmés : stock invendable).
    for (const line of sale.lines) {
      for (const alloc of line.allocations) {
        const lot = lots.get(alloc.lotId)!;
        await this.stock.move(tx, {
          lot,
          type: 'SALE_CANCEL',
          qty: alloc.qtyBase,
          unitCostHt: alloc.unitCostHt,
          unitPriceTtc: mulDivRound(num(line.lineTotalTtc), 1, line.qtyBase),
          documentType: 'SALE',
          documentId: saleId,
          documentNumber: sale.number,
          counterpartType: 'CLIENT',
          counterpartId: sale.clientId,
          counterpartName: sale.client?.name ?? null,
          reason,
          actor,
          at,
        });
      }
    }

    // Compte client : annulation de la facture.
    await this.ledger.post(tx, {
      clientId: sale.clientId!,
      type: 'INVOICE_CANCEL',
      credit: sale.totalTtc,
      documentType: 'SALE',
      documentId: saleId,
      documentNumber: sale.number,
      description: `Annulation de la facture ${sale.number}`,
      actor,
      at,
    });

    // Règlements : affectations annulées → remboursement en espèces ou crédit client.
    let refunded = 0;
    const paymentIds: string[] = [];
    for (const alloc of sale.allocations) {
      await tx.paymentAllocation.update({
        where: { id: alloc.id },
        data: { cancelledAt: at, cancelledById: actor.userId },
      });
      paymentIds.push(alloc.paymentId);
      if (refundMode === 'REFUND') refunded += num(alloc.amount);
    }
    const creditNoteIds: string[] = [];
    for (const alloc of sale.creditAllocs) {
      await tx.creditNoteAllocation.update({
        where: { id: alloc.id },
        data: { cancelledAt: at, cancelledById: actor.userId },
      });
      await tx.$executeRaw`UPDATE credit_notes SET remaining_amount = remaining_amount + ${alloc.amount} WHERE id = ${alloc.creditNoteId}::uuid`;
      creditNoteIds.push(alloc.creditNoteId);
    }
    if (refunded > 0)
      await this.refundPayments(
        tx,
        sale.clientId!,
        sale.allocations.map((a) => ({ paymentId: a.paymentId, amount: num(a.amount) })),
        saleId,
        sale.number,
        actor,
        at,
      );
    return { paymentIds, creditNoteIds, refunded };
  }

  /** Remboursement en espèces (sortie de caisse, session ouverte obligatoire). */
  private async refundPayments(
    tx: Tx,
    clientId: string,
    parts: { paymentId: string; amount: number }[],
    documentId: string,
    documentNumber: string | null,
    actor: Actor,
    at: Date,
  ) {
    const total = parts.reduce((a, p) => a + p.amount, 0);
    if (total <= 0) return;
    const session = actor.deviceId ? await this.cash.lockOpenSession(tx, actor.deviceId) : null;
    if (!session)
      throw new AppError('CASH_SESSION_REQUIRED', undefined, {
        message:
          'Un remboursement en espèces nécessite une session de caisse ouverte sur ce poste.',
      });
    for (const part of parts) {
      await tx.$executeRaw`UPDATE payments SET refunded_amount = refunded_amount + ${part.amount} WHERE id = ${part.paymentId}::uuid`;
    }
    await this.cash.addMovement(tx, {
      sessionId: session.id,
      type: 'REFUND',
      amount: total,
      documentType: 'SALE',
      documentId,
      documentRef: documentNumber,
      reason: 'Remboursement',
      actor,
      at,
    });
    await this.ledger.post(tx, {
      clientId,
      type: 'REFUND',
      debit: total,
      documentType: 'SALE',
      documentId,
      documentNumber,
      description: `Remboursement en espèces (${documentNumber})`,
      actor,
      at,
    });
    await this.audit.record(tx, {
      eventType: 'CASH_REFUND',
      actor,
      entityType: 'sale',
      entityId: documentId,
      entityRef: documentNumber,
      summary: `Remboursement en espèces de ${money(total)} (${documentNumber})`,
      after: { amount: total },
      notify: { data: { amount: total } },
    });
  }

  async cancel(saleId: string, input: CancelSaleInput, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new AppError('NOT_FOUND');
      const before = await this.snapshot(tx, saleId);
      const at = now();
      const reason = `${input.reasonCode === 'OTHER' ? '' : `${input.reasonCode} — `}${input.reason}`;
      const { refunded } = await this.undo(tx, saleId, input.refundMode, reason, actor, at);
      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: 'CANCELLED',
          cancelledById: actor.userId,
          cancelledAt: at,
          cancelReason: input.reason,
        },
      });
      await this.ledger.refreshSaleAmountsAfterCancel(tx, saleId);
      await this.audit.record(tx, {
        eventType: 'SALE_CANCELLED',
        actor,
        entityType: 'sale',
        entityId: saleId,
        entityRef: before.number,
        summary: `Vente ${before.number} annulée — ${before.client?.name ?? ''} — ${money(before.totalTtc)}${refunded > 0 ? ` (remboursé ${money(refunded)})` : before.payments.length > 0 ? ' (règlements convertis en crédit client)' : ''}`,
        reason: input.reason,
        before,
        after: {
          status: 'CANCELLED',
          refundMode: input.refundMode,
          refunded,
          reasonCode: input.reasonCode,
        },
        metadata: { reasonCode: input.reasonCode },
        notify: {
          data: { amount: num(before.totalTtc), clientName: before.client?.name },
          link: `/sales/${saleId}`,
        },
      });
      await this.outbox.queueDocument(tx, {
        kind: 'INVOICE_CANCELLED',
        entityType: 'sale',
        entityId: saleId,
        clientId: before.client!.id,
        manual: false,
        actor,
      });
    });
    return this.view(saleId, actor);
  }

  /** Modification = annulation + nouvelle vente liée, dans la même transaction (RG-13). */
  async modify(saleId: string, input: ModifySaleInput, actor: Actor) {
    const warnings: string[] = [];
    const newId = await this.prisma.tx(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
        if (rows.length === 0) throw new AppError('NOT_FOUND');
        const original = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
        const before = await this.snapshot(tx, saleId);
        const at = now();
        const { paymentIds, creditNoteIds } = await this.undo(
          tx,
          saleId,
          'KEEP',
          `Modification : ${input.reason}`,
          actor,
          at,
        );
        await tx.sale.update({
          where: { id: saleId },
          data: {
            status: 'CANCELLED',
            cancelledById: actor.userId,
            cancelledAt: at,
            cancelReason: `Modification : ${input.reason}`,
          },
        });
        await this.ledger.refreshSaleAmountsAfterCancel(tx, saleId);

        // Nouvelle vente pré-remplie et liée.
        const clientId = input.clientId ?? original.clientId!;
        const created = await tx.sale.create({
          data: {
            siteId: original.siteId,
            clientId,
            status: 'DRAFT',
            replacesSaleId: saleId,
            deviceId: actor.deviceId,
            createdById: actor.userId,
            createdAt: at,
            prescriberName: input.prescription?.prescriberName ?? original.prescriberName,
            prescriptionRef: input.prescription?.prescriptionRef ?? original.prescriptionRef,
            prescriptionDate: input.prescription?.prescriptionDate
              ? new Date(`${input.prescription.prescriptionDate}T00:00:00Z`)
              : original.prescriptionDate,
          },
        });
        const req = new OverrideRequirements(actor);
        const limit = await this.discountLimit(
          tx,
          (await tx.client.findUniqueOrThrow({ where: { id: clientId } })).defaultDiscountBp,
        );
        for (const [i, l] of input.lines.entries()) {
          const product = await tx.product.findUnique({
            where: { id: l.productId },
            include: { tvaRate: true },
          });
          if (!product) throw new AppError('NOT_FOUND', { entity: 'product' });
          const unit = l.unit ?? 'PACK';
          const catalog = catalogPrice(product, unit);
          const price = l.unitPriceTtc !== undefined ? BigInt(l.unitPriceTtc) : catalog;
          if (price !== catalog)
            req.require('sales.price_override', `prix de ${product.name} modifié`);
          if ((l.discountBp ?? 0) > limit)
            req.require(
              'sales.discount_over_limit',
              `remise de ${(l.discountBp ?? 0) / 100} % sur ${product.name}`,
            );
          if (l.forcedLotId) req.require('sales.force_lot', `lot forcé pour ${product.name}`);
          await tx.saleLine.create({
            data: {
              saleId: created.id,
              lineNo: i + 1,
              productId: product.id,
              qty: l.qty,
              unit,
              qtyBase: l.qty * unitFactor(product, unit),
              catalogPriceTtc: catalog,
              unitPriceTtc: price,
              discountBp: l.discountBp ?? 0,
              tvaRateBp: product.tvaRate.rateBp,
              lineTotalTtc: 0n,
              forcedLotId: l.forcedLotId ?? null,
              priceAuthorizedById: price !== catalog ? actor.userId : null,
              discountAuthorizedById: (l.discountBp ?? 0) > limit ? actor.userId : null,
              lotAuthorizedById: l.forcedLotId ? actor.userId : null,
              createdAt: at,
            },
          });
        }
        await this.overrides.resolve(tx, req, input.override as OverrideInput | undefined, actor, {
          entityType: 'sale',
          entityId: saleId,
          action: 'modification de la vente',
        });

        // Règlements de l'originale transférés ; excédent → crédit client ou remboursement.
        await this.validateCore(
          tx,
          created.id,
          {
            payments: input.payments,
            useCredit: 0,
            document: 'NONE',
            sendEmail: false,
            override: input.override,
          },
          null,
          actor,
          { transfer: { paymentIds, creditNoteIds }, excessMode: input.excessMode },
          warnings,
        );
        if (input.excessMode === 'REFUND') {
          const leftovers = (await this.ledger.creditSources(tx, clientId, true)).filter(
            (s) => s.kind === 'PAYMENT' && paymentIds.includes(s.id),
          );
          await this.refundPayments(
            tx,
            clientId,
            leftovers.map((s) => ({ paymentId: s.id, amount: s.available })),
            created.id,
            (await tx.sale.findUniqueOrThrow({ where: { id: created.id } })).number,
            actor,
            at,
          );
        }
        const after = await this.snapshot(tx, created.id);
        await this.audit.record(tx, {
          eventType: 'SALE_MODIFIED',
          actor,
          entityType: 'sale',
          entityId: saleId,
          entityRef: before.number,
          summary: `Vente ${before.number} modifiée → ${after.number} (${money(before.totalTtc)} → ${money(after.totalTtc)})`,
          reason: input.reason,
          before,
          after,
          metadata: {
            newSaleId: created.id,
            newNumber: after.number,
            reasonCode: input.reasonCode,
          },
          notify: {
            data: { amount: num(before.totalTtc), newAmount: num(after.totalTtc) },
            link: `/sales/${created.id}`,
          },
        });
        await this.outbox.queueDocument(tx, {
          kind: 'INVOICE_CANCELLED',
          entityType: 'sale',
          entityId: saleId,
          clientId,
          manual: false,
          actor,
        });
        await this.outbox.queueDocument(tx, {
          kind: 'INVOICE',
          entityType: 'sale',
          entityId: created.id,
          clientId,
          manual: false,
          actor,
        });
        return created.id;
      },
      { timeout: 60_000 },
    );
    return { sale: await this.view(newId, actor), warnings };
  }
}
