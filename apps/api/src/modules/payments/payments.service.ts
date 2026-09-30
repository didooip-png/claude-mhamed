import { Injectable } from '@nestjs/common';
import {
  addDaysIso,
  diffDaysIso,
  todayIso,
  type RecordPaymentData,
  type SettleData,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { Prisma, type PaymentMethod } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { LedgerService } from '../accounts/ledger.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CashService } from '../cash/cash.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PaymentsCoreService } from './payments-core.service.js';

const money = (v: number | bigint) => `${(Number(v) / 1000).toFixed(3).replace('.', ',')} DT`;
const NON_CASH_TERMS: PaymentMethod[] = ['CHEQUE', 'DRAFT_BILL'];

export interface PaymentListQuery {
  page: number;
  pageSize: number;
  q?: string;
  clientId?: string;
  method?: PaymentMethod;
  status?: 'VALID' | 'CANCELLED' | 'BOUNCED';
  from?: Date;
  to?: Date;
  unallocated?: boolean;
}

/**
 * Règlements et lettrage (§6.10, RG-16). Ordre des verrous commun à toutes les opérations :
 * factures (triées) → client → avoirs / règlements (triés) → session de caisse → séquences → audit.
 * Σ des affectations d'un règlement ≤ son montant ; une affectation ≤ le reste à payer de la facture.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly core: PaymentsCoreService,
    private readonly cash: CashService,
    private readonly settings: SettingsService,
    private readonly outbox: EmailOutboxService,
  ) {}

  private async lockSales(tx: Tx, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)].sort();
    if (unique.length === 0) return;
    await tx.$queryRaw`SELECT id FROM sales WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  private openInvoices(tx: Tx | PrismaService, clientId: string) {
    return tx.sale.findMany({
      where: { clientId, status: 'VALIDATED', amountDue: { gt: 0 } },
      orderBy: [{ validatedAt: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        validatedAt: true,
        dueDate: true,
        totalTtc: true,
        amountDue: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Encaissement
  // ---------------------------------------------------------------------------

  async record(
    input: RecordPaymentData,
    idempotencyKey: string | undefined,
    actor: Actor,
  ): Promise<{ id: string; warnings: string[] }> {
    if (idempotencyKey) {
      const previous = await this.prisma.payment.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (previous) return { id: previous.id, warnings: [] };
    }
    const warnings: string[] = [];
    const id = await this.prisma.tx(async (tx) => {
      const candidates =
        input.allocation === 'NONE'
          ? []
          : input.allocation === 'MANUAL'
            ? input.items.map((i) => i.saleId)
            : (await this.openInvoices(tx, input.clientId)).map((s) => s.id);
      await this.lockSales(tx, candidates);
      const client = await this.ledger.lockClient(tx, input.clientId);
      if (client.is_walk_in) {
        throw new AppError('CREDIT_NOT_ALLOWED', undefined, {
          message: 'Le client comptoir n’a pas de compte : pas de règlement à enregistrer.',
        });
      }
      const at = now();
      const payment = await this.core.create(tx, {
        clientId: input.clientId,
        payment: {
          method: input.method,
          amount: input.amount,
          tendered: input.tendered,
          chequeNumber: input.chequeNumber,
          bank: input.bank,
          dueDate: input.dueDate,
          reference: input.reference,
        },
        actor,
        at,
        idempotencyKey,
        notes: input.notes ?? null,
      });

      // --- Lettrage -------------------------------------------------------------------------
      const locked = new Set(candidates);
      const invoices = (await this.openInvoices(tx, input.clientId)).filter((s) =>
        locked.has(s.id),
      );
      const plan: { saleId: string; number: string | null; amount: number }[] = [];
      if (input.allocation === 'AUTO') {
        let rest = input.amount;
        for (const s of invoices) {
          if (rest <= 0) break;
          const take = Math.min(rest, num(s.amountDue));
          plan.push({ saleId: s.id, number: s.number, amount: take });
          rest -= take;
        }
      } else if (input.allocation === 'MANUAL') {
        for (const item of input.items) {
          const s = invoices.find((x) => x.id === item.saleId);
          if (!s)
            throw new AppError(
              'NOT_FOUND',
              { entity: 'invoice', saleId: item.saleId },
              { message: 'Facture introuvable ou déjà soldée.' },
            );
          const already = plan.filter((p) => p.saleId === s.id).reduce((a, p) => a + p.amount, 0);
          if (already + item.amount > num(s.amountDue)) {
            throw new AppError('ALLOCATION_EXCEEDS_DUE', {
              number: s.number,
              due: num(s.amountDue),
              requested: already + item.amount,
            });
          }
          plan.push({ saleId: s.id, number: s.number, amount: item.amount });
        }
      }
      for (const p of plan) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            saleId: p.saleId,
            amount: BigInt(p.amount),
            createdById: actor.userId,
            createdAt: at,
          },
        });
        await this.ledger.refreshSaleAmounts(tx, p.saleId);
      }
      const allocated = plan.reduce((a, p) => a + p.amount, 0);
      const unallocated = input.amount - allocated;

      await this.audit.record(tx, {
        eventType: 'PAYMENT_RECEIVED',
        actor,
        entityType: 'payment',
        entityId: payment.id,
        entityRef: payment.number,
        summary: `Règlement ${payment.number} de ${money(input.amount)} (${client.name})${
          plan.length > 0 ? ` — lettré sur ${plan.map((p) => p.number).join(', ')}` : ''
        }${unallocated > 0 ? ` — acompte de ${money(unallocated)}` : ''}`,
        after: {
          amount: input.amount,
          method: input.method,
          allocated,
          unallocated,
          invoices: plan,
        },
        notify: { data: { amount: input.amount }, link: `/payments/${payment.id}` },
      });

      // Reçu de règlement par e-mail (file d'envoi, jamais bloquant).
      const explicit = input.sendEmail === true || !!input.emailTo;
      if (explicit || input.sendEmail === undefined) {
        const queued = await this.outbox.queueDocument(tx, {
          kind: 'PAYMENT_RECEIPT',
          entityType: 'payment',
          entityId: payment.id,
          clientId: input.clientId,
          to: input.emailTo ? [input.emailTo] : undefined,
          manual: explicit,
          actor,
        });
        if (!queued.queued && explicit) warnings.push(queued.reason);
      }
      return payment.id;
    });
    return { id, warnings };
  }

  // ---------------------------------------------------------------------------
  // Lettrage sans nouvel encaissement (avoirs et acomptes existants)
  // ---------------------------------------------------------------------------

  async settle(clientId: string, input: SettleData, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const candidates =
        input.mode === 'MANUAL'
          ? input.items.map((i) => i.saleId)
          : (await this.openInvoices(tx, clientId)).map((s) => s.id);
      await this.lockSales(tx, candidates);
      const client = await this.ledger.lockClient(tx, clientId);
      if (client.is_walk_in) throw new AppError('CREDIT_NOT_ALLOWED');
      const at = now();
      const sources = await this.ledger.creditSources(tx, clientId, true);
      const paymentIds = sources.filter((s) => s.kind === 'PAYMENT').map((s) => s.id);
      if (paymentIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ANY(${paymentIds}::uuid[]) ORDER BY id FOR UPDATE`;
      }
      const locked = new Set(candidates);
      const invoices = (await this.openInvoices(tx, clientId)).filter((s) => locked.has(s.id));
      const available = new Map(sources.map((s) => [`${s.kind}:${s.id}`, s.available]));
      const due = new Map(invoices.map((s) => [s.id, num(s.amountDue)]));
      const plan: {
        kind: 'PAYMENT' | 'CREDIT_NOTE';
        sourceId: string;
        saleId: string;
        amount: number;
      }[] = [];
      const take = (
        kind: 'PAYMENT' | 'CREDIT_NOTE',
        sourceId: string,
        saleId: string,
        amount: number,
      ) => {
        const key = `${kind}:${sourceId}`;
        const have = available.get(key);
        if (have === undefined)
          throw new AppError(
            'NOT_FOUND',
            { entity: 'credit' },
            { message: 'Avoir ou acompte introuvable.' },
          );
        const owed = due.get(saleId);
        if (owed === undefined)
          throw new AppError(
            'NOT_FOUND',
            { entity: 'invoice' },
            { message: 'Facture introuvable ou déjà soldée.' },
          );
        if (amount > have)
          throw new AppError('ALLOCATION_EXCEEDS_PAYMENT', { available: have, requested: amount });
        if (amount > owed)
          throw new AppError('ALLOCATION_EXCEEDS_DUE', { due: owed, requested: amount });
        available.set(key, have - amount);
        due.set(saleId, owed - amount);
        plan.push({ kind, sourceId, saleId, amount });
      };
      if (input.mode === 'MANUAL') {
        for (const i of input.items) take(i.sourceKind, i.sourceId, i.saleId, i.amount);
      } else {
        for (const inv of invoices) {
          for (const src of sources) {
            const left = available.get(`${src.kind}:${src.id}`) ?? 0;
            const owed = due.get(inv.id) ?? 0;
            const amount = Math.min(left, owed);
            if (amount > 0) take(src.kind, src.id, inv.id, amount);
          }
        }
      }
      if (plan.length === 0)
        throw new AppError('VALIDATION_ERROR', undefined, {
          message: 'Aucun crédit à affecter sur une facture ouverte.',
        });
      for (const p of plan) {
        if (p.kind === 'CREDIT_NOTE') {
          await tx.creditNoteAllocation.create({
            data: {
              creditNoteId: p.sourceId,
              saleId: p.saleId,
              amount: BigInt(p.amount),
              createdById: actor.userId,
              createdAt: at,
            },
          });
          await tx.$executeRaw`UPDATE credit_notes SET remaining_amount = remaining_amount - ${p.amount} WHERE id = ${p.sourceId}::uuid`;
        } else {
          await tx.paymentAllocation.create({
            data: {
              paymentId: p.sourceId,
              saleId: p.saleId,
              amount: BigInt(p.amount),
              createdById: actor.userId,
              createdAt: at,
            },
          });
        }
      }
      for (const saleId of new Set(plan.map((p) => p.saleId)))
        await this.ledger.refreshSaleAmounts(tx, saleId);
      const total = plan.reduce((a, p) => a + p.amount, 0);
      await this.audit.record(tx, {
        eventType: 'PAYMENT_ALLOCATED',
        actor,
        entityType: 'client',
        entityId: clientId,
        entityRef: `${client.code} — ${client.name}`,
        summary: `Lettrage de ${money(total)} (avoirs / acomptes) sur les factures de ${client.name}`,
        after: { total, allocations: plan },
        notify: false,
      });
      return { allocated: total, count: plan.length };
    });
  }

  // ---------------------------------------------------------------------------
  // Annulation d'un règlement, chèque impayé, statut d'un chèque
  // ---------------------------------------------------------------------------

  /** Annule un règlement (admin) ou le déclare impayé : lettrage annulé, factures rouvertes, écriture au compte. */
  private async reverse(
    id: string,
    kind: 'CANCEL' | 'BOUNCE',
    reason: string,
    actor: Actor,
  ): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const pre = await tx.payment.findUnique({
        where: { id },
        include: { allocations: { where: { cancelledAt: null }, select: { saleId: true } } },
      });
      if (!pre) throw new AppError('NOT_FOUND');
      if (kind === 'BOUNCE' && !NON_CASH_TERMS.includes(pre.method)) {
        throw new AppError('PAYMENT_NOT_VALID', undefined, {
          message: 'Seuls un chèque ou une traite peuvent être déclarés impayés.',
        });
      }
      await this.lockSales(
        tx,
        pre.allocations.map((a) => a.saleId),
      );
      await this.ledger.lockClient(tx, pre.clientId);
      const rows = await tx.$queryRaw<{ status: string; refunded_amount: bigint }[]>`
        SELECT status, refunded_amount FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
      const row = rows[0]!;
      if (row.status !== 'VALID') throw new AppError('PAYMENT_NOT_VALID', { status: row.status });
      if (num(row.refunded_amount) > 0) {
        throw new AppError('PAYMENT_NOT_VALID', undefined, {
          message: 'Ce règlement a déjà été remboursé en partie : il ne peut plus être annulé.',
        });
      }
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id },
        include: {
          client: { select: { name: true } },
          allocations: {
            where: { cancelledAt: null },
            include: {
              sale: {
                select: {
                  id: true,
                  number: true,
                  validatedAt: true,
                  dueDate: true,
                  clientId: true,
                },
              },
            },
          },
        },
      });
      const at = now();
      const settings = await this.settings.all(tx);

      // Espèces : la contre-écriture de caisse va dans la session ouverte (jamais dans une session fermée).
      if (kind === 'CANCEL' && payment.method === 'CASH') {
        const session = actor.deviceId ? await this.cash.lockOpenSession(tx, actor.deviceId) : null;
        if (!session && settings['cash.required_for_cash_payments']) {
          throw new AppError('CASH_SESSION_REQUIRED', undefined, {
            message:
              'L’annulation d’un règlement en espèces nécessite une session de caisse ouverte sur ce poste.',
          });
        }
        if (session) {
          await this.cash.addMovement(tx, {
            sessionId: session.id,
            type: 'REFUND',
            amount: num(payment.amount),
            documentType: 'PAYMENT',
            documentId: payment.id,
            documentRef: payment.number,
            reason: `Annulation du règlement ${payment.number}`,
            actor,
            at,
          });
        }
      }
      await tx.paymentAllocation.updateMany({
        where: { paymentId: id, cancelledAt: null },
        data: { cancelledAt: at, cancelledById: actor.userId },
      });
      await tx.payment.update({
        where: { id },
        data: {
          status: kind === 'CANCEL' ? 'CANCELLED' : 'BOUNCED',
          ...(kind === 'BOUNCE' ? { chequeStatus: 'BOUNCED' as const } : {}),
          cancelledAt: at,
          cancelledById: actor.userId,
          cancelReason: reason,
        },
      });
      await this.ledger.post(tx, {
        clientId: payment.clientId,
        type: 'PAYMENT_CANCEL',
        debit: payment.amount,
        documentType: 'PAYMENT',
        documentId: payment.id,
        documentNumber: payment.number,
        description: `${kind === 'CANCEL' ? 'Annulation du règlement' : 'Impayé du règlement'} ${payment.number}`,
        actor,
        at,
      });
      // Factures rouvertes : reste à payer recalculé ; une facture soldée à la caisse reçoit son échéance.
      const tz = settings['general.timezone'];
      const terms = (
        await tx.client.findUniqueOrThrow({
          where: { id: payment.clientId },
          select: { paymentTermsDays: true },
        })
      ).paymentTermsDays;
      const reopened: string[] = [];
      for (const alloc of payment.allocations) {
        const after = await this.ledger.refreshSaleAmounts(tx, alloc.saleId);
        reopened.push(alloc.sale.number ?? '');
        if (after.amountDue > 0 && !alloc.sale.dueDate && alloc.sale.validatedAt) {
          const due = addDaysIso(todayIso(tz, alloc.sale.validatedAt), terms);
          await tx.sale.update({
            where: { id: alloc.saleId },
            data: { dueDate: new Date(`${due}T00:00:00Z`) },
          });
        }
      }
      const summaryBase = `${payment.number} de ${money(payment.amount)} (${payment.client.name})`;
      await this.audit.record(tx, {
        eventType: kind === 'CANCEL' ? 'PAYMENT_CANCELLED' : 'CHEQUE_BOUNCED',
        actor,
        entityType: 'payment',
        entityId: payment.id,
        entityRef: payment.number,
        summary:
          kind === 'CANCEL'
            ? `Règlement ${summaryBase} annulé${reopened.length ? ` — factures rouvertes : ${reopened.join(', ')}` : ''}`
            : `${payment.method === 'CHEQUE' ? 'Chèque' : 'Traite'} impayé : règlement ${summaryBase}${reopened.length ? ` — factures rouvertes : ${reopened.join(', ')}` : ''}`,
        reason,
        before: {
          status: 'VALID',
          amount: payment.amount,
          allocations: payment.allocations.map((a) => ({ sale: a.sale.number, amount: a.amount })),
        },
        after: { status: kind === 'CANCEL' ? 'CANCELLED' : 'BOUNCED' },
        notify: { data: { amount: num(payment.amount) }, link: `/payments/${payment.id}` },
      });
    });
  }

  cancel(id: string, reason: string, actor: Actor) {
    return this.reverse(id, 'CANCEL', reason, actor);
  }

  bounce(id: string, reason: string, actor: Actor) {
    return this.reverse(id, 'BOUNCE', reason, actor);
  }

  async setChequeStatus(id: string, status: 'DEPOSITED' | 'CASHED', actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: string; cheque_status: string | null; method: string; number: string }[]
      >`
        SELECT status, cheque_status, method, number FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND');
      if (
        row.status !== 'VALID' ||
        !NON_CASH_TERMS.includes(row.method as PaymentMethod) ||
        !row.cheque_status
      ) {
        throw new AppError('PAYMENT_NOT_VALID', undefined, {
          message: 'Ce règlement n’est pas un chèque ou une traite en cours.',
        });
      }
      const order = ['IN_PORTFOLIO', 'DEPOSITED', 'CASHED'];
      if (order.indexOf(status) <= order.indexOf(row.cheque_status)) {
        throw new AppError('CONFLICT', undefined, {
          message: 'Le statut ne peut qu’avancer : en portefeuille → remis en banque → encaissé.',
        });
      }
      await tx.payment.update({ where: { id }, data: { chequeStatus: status } });
      await this.audit.record(tx, {
        eventType: 'CHEQUE_STATUS_CHANGED',
        actor,
        entityType: 'payment',
        entityId: id,
        entityRef: row.number,
        summary: `Règlement ${row.number} : ${status === 'DEPOSITED' ? 'remis en banque' : 'encaissé'}`,
        before: { chequeStatus: row.cheque_status },
        after: { chequeStatus: status },
        notify: false,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Consultation
  // ---------------------------------------------------------------------------

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

  async list(q: PaymentListQuery) {
    const term = q.q?.trim();
    const where: Prisma.PaymentWhereInput = {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? { paidAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
        : {}),
      ...(term
        ? {
            OR: [
              { number: { contains: term, mode: 'insensitive' } },
              { chequeNumber: { contains: term, mode: 'insensitive' } },
              { reference: { contains: term, mode: 'insensitive' } },
              { client: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: [{ paidAt: 'desc' }, { number: 'desc' }],
      ...(q.unallocated ? {} : pageArgs(q)),
      include: {
        client: { select: { id: true, code: true, name: true } },
        allocations: { where: { cancelledAt: null }, select: { amount: true } },
      },
    });
    const mapped = rows.map((p) => {
      const allocated = p.allocations.reduce((a, x) => a + num(x.amount), 0);
      return {
        id: p.id,
        number: p.number,
        paidAt: p.paidAt,
        client: p.client,
        method: p.method,
        amount: p.amount,
        refundedAmount: p.refundedAmount,
        allocated,
        unallocated: p.status === 'VALID' ? num(p.amount) - num(p.refundedAmount) - allocated : 0,
        status: p.status,
        chequeNumber: p.chequeNumber,
        bank: p.bank,
        dueDate: p.dueDate,
        chequeStatus: p.chequeStatus,
        reference: p.reference,
        createdById: p.createdById,
        saleId: p.saleId,
      };
    });
    const filtered = q.unallocated ? mapped.filter((p) => p.unallocated > 0) : mapped;
    const total = q.unallocated ? filtered.length : await this.prisma.payment.count({ where });
    const page = q.unallocated
      ? filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
      : filtered;
    const users = await this.usersOf(page.map((p) => p.createdById));
    const sums = await this.prisma.payment.aggregate({
      where: { ...where, status: 'VALID' },
      _sum: { amount: true },
    });
    return {
      ...paginated(
        page.map(({ createdById, ...p }) => ({ ...p, createdBy: users.get(createdById) ?? null })),
        total,
        q,
      ),
      totals: { amount: num(sums._sum.amount) },
    };
  }

  async get(id: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, code: true, name: true, isWalkIn: true } },
        allocations: {
          include: {
            sale: { select: { id: true, number: true, validatedAt: true, totalTtc: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        cashSession: { select: { id: true, number: true } },
      },
    });
    if (!p) throw new AppError('NOT_FOUND');
    const users = await this.usersOf([
      p.createdById,
      p.cancelledById,
      ...p.allocations.map((a) => a.createdById),
    ]);
    const active = p.allocations.filter((a) => !a.cancelledAt);
    const allocated = active.reduce((a, x) => a + num(x.amount), 0);
    return {
      id: p.id,
      number: p.number,
      paidAt: p.paidAt,
      client: p.client,
      method: p.method,
      amount: p.amount,
      refundedAmount: p.refundedAmount,
      allocated,
      unallocated: p.status === 'VALID' ? num(p.amount) - num(p.refundedAmount) - allocated : 0,
      status: p.status,
      chequeNumber: p.chequeNumber,
      bank: p.bank,
      dueDate: p.dueDate,
      chequeStatus: p.chequeStatus,
      reference: p.reference,
      notes: p.notes,
      cashSession: p.cashSession,
      saleId: p.saleId,
      printCount: p.printCount,
      createdBy: users.get(p.createdById) ?? null,
      cancelledBy: p.cancelledById ? (users.get(p.cancelledById) ?? null) : null,
      cancelledAt: p.cancelledAt,
      cancelReason: p.cancelReason,
      allocations: p.allocations.map((a) => ({
        id: a.id,
        sale: a.sale,
        amount: a.amount,
        createdAt: a.createdAt,
        createdBy: users.get(a.createdById) ?? null,
        cancelledAt: a.cancelledAt,
      })),
    };
  }

  /** Chèques et traites en portefeuille, par date d'échéance. */
  async cheques(q: {
    page: number;
    pageSize: number;
    q?: string;
    status?: 'IN_PORTFOLIO' | 'DEPOSITED' | 'CASHED' | 'BOUNCED';
    from?: Date;
    to?: Date;
    clientId?: string;
  }) {
    const settings = await this.settings.all();
    const today = todayIso(settings['general.timezone'], now());
    const term = q.q?.trim();
    const where: Prisma.PaymentWhereInput = {
      method: { in: NON_CASH_TERMS },
      ...(q.status ? { chequeStatus: q.status } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.from || q.to
        ? { dueDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
      ...(term
        ? {
            OR: [
              { number: { contains: term, mode: 'insensitive' } },
              { chequeNumber: { contains: term, mode: 'insensitive' } },
              { bank: { contains: term, mode: 'insensitive' } },
              { client: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total, byStatus] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { paidAt: 'asc' }],
        ...pageArgs(q),
        include: { client: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.groupBy({
        by: ['chequeStatus'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    return {
      ...paginated(
        rows.map((p) => {
          const due = p.dueDate?.toISOString().slice(0, 10) ?? null;
          return {
            id: p.id,
            number: p.number,
            method: p.method,
            client: p.client,
            chequeNumber: p.chequeNumber,
            bank: p.bank,
            amount: p.amount,
            dueDate: due,
            daysToDue: due ? diffDaysIso(today, due) : null,
            overdue:
              !!due &&
              due < today &&
              (p.chequeStatus === 'IN_PORTFOLIO' || p.chequeStatus === 'DEPOSITED'),
            chequeStatus: p.chequeStatus,
            status: p.status,
          };
        }),
        total,
        q,
      ),
      summary: byStatus.map((s) => ({
        status: s.chequeStatus,
        count: s._count,
        amount: num(s._sum.amount),
      })),
    };
  }

  /** Factures ouvertes d'un client avec leur ancienneté et leur échéance. */
  async openInvoicesOf(clientId: string) {
    const settings = await this.settings.all();
    const tz = settings['general.timezone'];
    const today = todayIso(tz, now());
    const rows = await this.openInvoices(this.prisma, clientId);
    return rows.map((s) => {
      const day = s.validatedAt ? todayIso(tz, s.validatedAt) : today;
      const due = s.dueDate?.toISOString().slice(0, 10) ?? null;
      return {
        id: s.id,
        number: s.number,
        validatedAt: s.validatedAt,
        dueDate: due,
        totalTtc: s.totalTtc,
        amountDue: s.amountDue,
        ageDays: diffDaysIso(day, today),
        overdueDays: due && due < today ? diffDaysIso(due, today) : 0,
      };
    });
  }

  /** Balance âgée : créances par client en tranches 0–30, 31–60, 61–90, > 90 jours (âge depuis la facture). */
  async aging(asOf?: string) {
    const settings = await this.settings.all();
    const tz = settings['general.timezone'];
    const date = asOf ?? todayIso(tz, now());
    const rows = await this.prisma.$queryRaw<
      {
        client_id: string;
        code: string;
        name: string;
        b0: bigint;
        b1: bigint;
        b2: bigint;
        b3: bigint;
        overdue: bigint;
        invoices: bigint;
      }[]
    >(Prisma.sql`
      SELECT c.id AS client_id, c.code, c.name,
        COALESCE(SUM(x.amount_due) FILTER (WHERE x.age <= 30), 0)::bigint AS b0,
        COALESCE(SUM(x.amount_due) FILTER (WHERE x.age BETWEEN 31 AND 60), 0)::bigint AS b1,
        COALESCE(SUM(x.amount_due) FILTER (WHERE x.age BETWEEN 61 AND 90), 0)::bigint AS b2,
        COALESCE(SUM(x.amount_due) FILTER (WHERE x.age > 90), 0)::bigint AS b3,
        COALESCE(SUM(x.amount_due) FILTER (WHERE x.due_date IS NOT NULL AND x.due_date < ${date}::date), 0)::bigint AS overdue,
        COUNT(*)::bigint AS invoices
      FROM (
        SELECT s.client_id, s.amount_due, s.due_date,
          (${date}::date - (s.validated_at AT TIME ZONE ${tz})::date) AS age
        FROM sales s WHERE s.status = 'VALIDATED' AND s.amount_due > 0 AND s.validated_at <= ${date}::date + 1
      ) x
      JOIN clients c ON c.id = x.client_id
      WHERE NOT c.is_walk_in
      GROUP BY c.id, c.code, c.name
      ORDER BY SUM(x.amount_due) DESC`);
    const creditNotes = await this.prisma.$queryRaw<{ client_id: string; total: bigint }[]>`
      SELECT client_id, SUM(remaining_amount)::bigint AS total FROM credit_notes WHERE remaining_amount > 0 GROUP BY client_id`;
    const deposits = await this.prisma.$queryRaw<{ client_id: string; total: bigint }[]>`
      SELECT p.client_id,
        SUM(p.amount - p.refunded_amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id AND a.cancelled_at IS NULL), 0))::bigint AS total
      FROM payments p WHERE p.status = 'VALID' GROUP BY p.client_id`;
    const credit = new Map<string, number>();
    for (const r of [...creditNotes, ...deposits])
      credit.set(r.client_id, (credit.get(r.client_id) ?? 0) + Math.max(0, num(r.total)));
    const clients = rows.map((r) => {
      const b = [num(r.b0), num(r.b1), num(r.b2), num(r.b3)] as const;
      return {
        clientId: r.client_id,
        code: r.code,
        name: r.name,
        buckets: b,
        total: b[0] + b[1] + b[2] + b[3],
        overdue: num(r.overdue),
        invoices: num(r.invoices),
        credit: credit.get(r.client_id) ?? 0,
      };
    });
    const sum = (f: (c: (typeof clients)[number]) => number) =>
      clients.reduce((a, c) => a + f(c), 0);
    return {
      asOf: date,
      clients,
      totals: {
        buckets: [0, 1, 2, 3].map((i) => sum((c) => c.buckets[i]!)),
        total: sum((c) => c.total),
        overdue: sum((c) => c.overdue),
        credit: sum((c) => c.credit),
      },
    };
  }
}
