import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StockService } from './stock.service.js';

export interface RecallCustomer {
  clientId: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  isWalkIn: boolean;
  qty: number;
  sales: { id: string; number: string | null; date: Date | null; qty: number }[];
}

/**
 * Rappel de lot (§6.4, §6.13) : retrouve tous les lots portant un numéro, les bloque (plus aucune
 * vente possible), et liste les clients qui ont reçu des unités de ces lots (nets des retours)
 * pour les contacter. Le retour fournisseur se fait ensuite depuis le rapport.
 */
@Injectable()
export class RecallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async lookup(lotNumber: string, productId?: string) {
    const lots = await this.prisma.lot.findMany({
      where: {
        lotNumber: { equals: lotNumber, mode: 'insensitive' },
        ...(productId ? { productId } : {}),
      },
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
          },
        },
        supplier: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ productId: 'asc' }, { expiryDate: 'asc' }],
    });
    if (lots.length === 0) return { lotNumber, lots: [], customers: [] as RecallCustomer[] };
    const allocations = await this.prisma.saleLineAllocation.findMany({
      where: {
        lotId: { in: lots.map((l) => l.id) },
        saleLine: { sale: { status: 'VALIDATED' } },
      },
      include: {
        saleLine: {
          select: {
            sale: {
              select: {
                id: true,
                number: true,
                validatedAt: true,
                client: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    phone: true,
                    email: true,
                    isWalkIn: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    const soldByLot = new Map<string, number>();
    const customers = new Map<string, RecallCustomer>();
    for (const a of allocations) {
      const net = a.qtyBase - a.returnedQtyBase;
      soldByLot.set(a.lotId, (soldByLot.get(a.lotId) ?? 0) + net);
      if (net <= 0) continue;
      const sale = a.saleLine.sale;
      const client = sale.client;
      if (!client) continue;
      const entry =
        customers.get(client.id) ??
        ({
          clientId: client.id,
          code: client.code,
          name: client.name,
          phone: client.phone,
          email: client.email,
          isWalkIn: client.isWalkIn,
          qty: 0,
          sales: [],
        } satisfies RecallCustomer);
      entry.qty += net;
      const existing = entry.sales.find((s) => s.id === sale.id);
      if (existing) existing.qty += net;
      else entry.sales.push({ id: sale.id, number: sale.number, date: sale.validatedAt, qty: net });
      customers.set(client.id, entry);
    }
    return {
      lotNumber,
      lots: lots.map((l) => ({
        id: l.id,
        lotNumber: l.lotNumber,
        product: l.product,
        supplier: l.supplier,
        status: l.status,
        blockReason: l.blockReason,
        expiryDate: l.expiryDate.toISOString().slice(0, 10),
        receivedAt: l.receivedAt,
        initialQty: l.initialQty,
        remainingQty: l.remainingQty,
        soldQty: soldByLot.get(l.id) ?? 0,
        unitCostHt: num(l.unitCostHt),
      })),
      customers: [...customers.values()].sort(
        (a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'fr'),
      ),
    };
  }

  /** Bloque les lots concernés (RG : plus aucune vente) et trace le rappel au mouchard. */
  async execute(
    input: { lotNumber: string; productId?: string; lotIds?: string[]; reason: string },
    actor: Actor,
  ) {
    const report = await this.lookup(input.lotNumber, input.productId);
    const targets = report.lots.filter(
      (l) =>
        (!input.lotIds || input.lotIds.includes(l.id)) &&
        l.status !== 'BLOCKED' &&
        (l.remainingQty > 0 || l.soldQty > 0),
    );
    if (targets.length === 0)
      throw new AppError('CONFLICT', undefined, {
        message: 'Aucun lot à bloquer : ils sont déjà bloqués ou sans stock.',
      });
    await this.prisma.tx(async (tx) => {
      await this.stock.lockProducts(
        tx,
        targets.map((l) => l.product.id),
      );
      const locked = await this.stock.lockLots(
        tx,
        targets.map((l) => l.id),
      );
      const reasonText = `Rappel de lot : ${input.reason}`;
      for (const target of targets) {
        const lot = locked.get(target.id);
        if (!lot || lot.status === 'BLOCKED') continue;
        await tx.lot.update({
          where: { id: lot.id },
          data: { status: 'BLOCKED', blockReason: reasonText },
        });
        await this.audit.record(tx, {
          eventType: 'LOT_BLOCKED',
          actor,
          entityType: 'lot',
          entityId: lot.id,
          entityRef: `${target.product.internalCode} — ${target.product.name} — lot ${lot.lot_number}`,
          summary: `Lot ${lot.lot_number} de ${target.product.name} bloqué (rappel, ${lot.remaining_qty} unité(s) en stock)`,
          reason: reasonText,
          before: { status: lot.status },
          after: { status: 'BLOCKED' },
          notify: false,
        });
      }
      await this.audit.record(tx, {
        eventType: 'LOT_RECALL',
        actor,
        entityType: 'lot',
        entityId: targets[0]!.id,
        entityRef: `Lot ${input.lotNumber}`,
        summary: `Rappel du lot ${input.lotNumber} : ${targets.length} lot(s) bloqué(s), ${targets.reduce((a, l) => a + l.remainingQty, 0)} unité(s) en stock, ${report.customers.length} client(s) concerné(s)`,
        reason: input.reason,
        metadata: {
          lots: targets.map((l) => ({
            id: l.id,
            product: l.product.name,
            remainingQty: l.remainingQty,
            soldQty: l.soldQty,
          })),
          customers: report.customers.map((c) => ({ id: c.clientId, name: c.name, qty: c.qty })),
        },
        notify: { link: `/stock/recall?lot=${encodeURIComponent(input.lotNumber)}` },
      });
    });
    return this.lookup(input.lotNumber, input.productId);
  }
}
