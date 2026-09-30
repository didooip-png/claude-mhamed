import { Injectable } from '@nestjs/common';
import { todayIso } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import type {
  ClientType,
  LedgerEntryType,
  SalePaymentStatus,
} from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface LockedClient {
  id: string;
  code: string;
  name: string;
  type: ClientType;
  balance: bigint;
  credit_limit: bigint;
  is_walk_in: boolean;
  is_active: boolean;
  payment_terms_days: number;
  email: string | null;
}

export interface CreditSource {
  kind: 'CREDIT_NOTE' | 'PAYMENT';
  id: string;
  number: string;
  available: number;
  date: Date;
}

export interface ClientAccountSummary {
  balance: number;
  availableCredit: number;
  creditLimit: number;
  /** Montant encore vendable à crédit : plafond − solde (RG-17). */
  creditRemaining: number;
  overdueCount: number;
  overdueAmount: number;
  openInvoicesAmount: number;
}

/**
 * Compte client (grand livre en ajout seul, §6.9). Solde = Σ débits − Σ crédits :
 * positif = le client doit ; négatif = crédit en sa faveur. Le cache `clients.balance`
 * est mis à jour dans la même transaction, sous verrou de la ligne client.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async lockClient(tx: Tx, clientId: string): Promise<LockedClient> {
    const rows = await tx.$queryRaw<LockedClient[]>`
      SELECT id, code, name, type, balance, credit_limit, is_walk_in, is_active, payment_terms_days, email
      FROM clients WHERE id = ${clientId}::uuid FOR UPDATE`;
    const client = rows[0];
    if (!client) throw new AppError('NOT_FOUND', { entity: 'client' });
    return client;
  }

  async post(
    tx: Tx,
    entry: {
      clientId: string;
      type: LedgerEntryType;
      debit?: number | bigint;
      credit?: number | bigint;
      documentType: string;
      documentId: string;
      documentNumber: string | null;
      description?: string;
      actor: Actor;
      at?: Date;
    },
  ): Promise<bigint> {
    const debit = BigInt(entry.debit ?? 0);
    const credit = BigInt(entry.credit ?? 0);
    if (debit === 0n && credit === 0n) return (await this.lockClient(tx, entry.clientId)).balance;
    const updated = await tx.$queryRaw<{ balance: bigint }[]>`
      UPDATE clients SET balance = balance + ${debit - credit}, updated_at = now()
      WHERE id = ${entry.clientId}::uuid RETURNING balance`;
    const balanceAfter = updated[0]!.balance;
    await tx.clientLedger.create({
      data: {
        clientId: entry.clientId,
        entryType: entry.type,
        debit,
        credit,
        balanceAfter,
        documentType: entry.documentType,
        documentId: entry.documentId,
        documentNumber: entry.documentNumber,
        description: entry.description ?? null,
        userId: entry.actor.userId,
        createdAt: entry.at ?? now(),
      },
    });
    return balanceAfter;
  }

  /** Avoirs restants et acomptes (règlements non affectés), du plus ancien au plus récent. */
  async creditSources(
    tx: Tx | PrismaService,
    clientId: string,
    lock = false,
  ): Promise<CreditSource[]> {
    const notes = lock
      ? await tx.$queryRaw<
          { id: string; number: string; remaining_amount: bigint; created_at: Date }[]
        >`
          SELECT id, number, remaining_amount, created_at FROM credit_notes
          WHERE client_id = ${clientId}::uuid AND remaining_amount > 0 ORDER BY created_at, id FOR UPDATE`
      : await tx.$queryRaw<
          { id: string; number: string; remaining_amount: bigint; created_at: Date }[]
        >`
          SELECT id, number, remaining_amount, created_at FROM credit_notes
          WHERE client_id = ${clientId}::uuid AND remaining_amount > 0 ORDER BY created_at, id`;
    const payments = await tx.$queryRaw<
      { id: string; number: string; available: bigint; paid_at: Date }[]
    >`
      SELECT p.id, p.number, p.paid_at,
        (p.amount - p.refunded_amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id AND a.cancelled_at IS NULL), 0))::bigint AS available
      FROM payments p
      WHERE p.client_id = ${clientId}::uuid AND p.status = 'VALID'
      ORDER BY p.paid_at, p.id`;
    return [
      ...notes.map((n) => ({
        kind: 'CREDIT_NOTE' as const,
        id: n.id,
        number: n.number,
        available: num(n.remaining_amount),
        date: n.created_at,
      })),
      ...payments
        .filter((p) => num(p.available) > 0)
        .map((p) => ({
          kind: 'PAYMENT' as const,
          id: p.id,
          number: p.number,
          available: num(p.available),
          date: p.paid_at,
        })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /** Affecte le crédit disponible (avoirs puis acomptes, du plus ancien) à une facture. */
  async consumeCredit(
    tx: Tx,
    clientId: string,
    saleId: string,
    amount: number,
    actor: Actor,
    at: Date,
  ): Promise<number> {
    if (amount <= 0) return 0;
    const sources = await this.creditSources(tx, clientId, true);
    if (sources.length > 0) {
      const paymentIds = sources.filter((s) => s.kind === 'PAYMENT').map((s) => s.id);
      if (paymentIds.length > 0)
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ANY(${paymentIds}::uuid[]) ORDER BY id FOR UPDATE`;
    }
    const total = sources.reduce((a, s) => a + s.available, 0);
    if (total < amount)
      throw new AppError('CREDIT_BALANCE_INSUFFICIENT', { available: total, requested: amount });
    let rest = amount;
    for (const source of sources) {
      if (rest === 0) break;
      const take = Math.min(rest, source.available);
      if (source.kind === 'CREDIT_NOTE') {
        await tx.creditNoteAllocation.create({
          data: {
            creditNoteId: source.id,
            saleId,
            amount: BigInt(take),
            createdById: actor.userId,
            createdAt: at,
          },
        });
        await tx.$executeRaw`UPDATE credit_notes SET remaining_amount = remaining_amount - ${take} WHERE id = ${source.id}::uuid`;
      } else {
        await tx.paymentAllocation.create({
          data: {
            paymentId: source.id,
            saleId,
            amount: BigInt(take),
            createdById: actor.userId,
            createdAt: at,
          },
        });
      }
      rest -= take;
    }
    return amount;
  }

  /** Recalcule payé / reste à payer / statut de paiement d'une facture. */
  async refreshSaleAmounts(
    tx: Tx,
    saleId: string,
  ): Promise<{ amountPaid: number; amountDue: number; paymentStatus: SalePaymentStatus }> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { totalTtc: true },
    });
    const [payments, notes] = [
      await tx.paymentAllocation.aggregate({
        where: { saleId, cancelledAt: null },
        _sum: { amount: true },
      }),
      await tx.creditNoteAllocation.aggregate({
        where: { saleId, cancelledAt: null },
        _sum: { amount: true },
      }),
    ];
    const amountPaid = num(payments._sum.amount) + num(notes._sum.amount);
    const amountDue = num(sale.totalTtc) - amountPaid;
    if (amountDue < 0) throw new AppError('ALLOCATION_EXCEEDS_DUE');
    const paymentStatus: SalePaymentStatus =
      amountDue === 0 ? 'PAID' : amountPaid === 0 ? 'UNPAID' : 'PARTIALLY_PAID';
    await tx.sale.update({
      where: { id: saleId },
      data: { amountPaid: BigInt(amountPaid), amountDue: BigInt(amountDue), paymentStatus },
    });
    return { amountPaid, amountDue, paymentStatus };
  }

  /** Facture annulée : plus rien n'est dû ni affecté. */
  async refreshSaleAmountsAfterCancel(tx: Tx, saleId: string): Promise<void> {
    await tx.sale.update({
      where: { id: saleId },
      data: { amountPaid: 0n, amountDue: 0n, paymentStatus: 'UNPAID' },
    });
  }

  async summary(
    clientId: string,
    client: Tx | PrismaService = this.prisma,
  ): Promise<ClientAccountSummary> {
    const c = await client.client.findUnique({
      where: { id: clientId },
      select: { balance: true, creditLimit: true },
    });
    if (!c) throw new AppError('NOT_FOUND');
    const sources = await this.creditSources(client, clientId);
    const today = todayIso(await this.settings.get('general.timezone'), now());
    const overdue = await client.sale.aggregate({
      where: {
        clientId,
        status: 'VALIDATED',
        amountDue: { gt: 0 },
        dueDate: { lt: new Date(`${today}T00:00:00Z`) },
      },
      _count: true,
      _sum: { amountDue: true },
    });
    const open = await client.sale.aggregate({
      where: { clientId, status: 'VALIDATED', amountDue: { gt: 0 } },
      _sum: { amountDue: true },
    });
    const balance = num(c.balance);
    const creditLimit = num(c.creditLimit);
    return {
      balance,
      availableCredit: sources.reduce((a, s) => a + s.available, 0),
      creditLimit,
      creditRemaining: Math.max(0, creditLimit - balance),
      overdueCount: overdue._count,
      overdueAmount: num(overdue._sum.amountDue),
      openInvoicesAmount: num(open._sum.amountDue),
    };
  }
}
