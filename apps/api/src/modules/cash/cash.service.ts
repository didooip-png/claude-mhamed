import { Injectable } from '@nestjs/common';
import type { CloseCashSessionInput } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import type { CashMovementType } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';

const MOVEMENT_SIGN: Record<CashMovementType, 1 | -1 | 0> = {
  OPENING_FLOAT: 1,
  SALE_PAYMENT: 1,
  REFUND: -1,
  EXPENSE: -1,
  DEPOSIT: 1,
  WITHDRAWAL: -1,
  DRAWER_OPEN: 0,
};

export interface CashSummary {
  openingFloat: number;
  salesCash: number;
  refunds: number;
  expenses: number;
  deposits: number;
  withdrawals: number;
  drawerOpenings: number;
  expected: number;
  byMethod: { method: string; amount: number; count: number }[];
  salesCount: number;
  salesTotal: number;
  cancelledCount: number;
}

/**
 * Sessions de caisse (§6.11) : ouverture par poste avec fond de caisse, mouvements,
 * clôture par comptage à l'aveugle (le théorique n'est jamais montré avant, RG-19).
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
  ) {}

  async lockOpenSession(
    tx: Tx,
    deviceId: string,
  ): Promise<{ id: string; number: string; user_id: string } | null> {
    const rows = await tx.$queryRaw<{ id: string; number: string; user_id: string }[]>`
      SELECT id, number, user_id FROM cash_sessions WHERE device_id = ${deviceId}::uuid AND status = 'OPEN' FOR UPDATE`;
    return rows[0] ?? null;
  }

  currentSession(deviceId: string) {
    return this.prisma.cashSession.findFirst({
      where: { deviceId, status: 'OPEN' },
      select: {
        id: true,
        number: true,
        openedAt: true,
        openingFloat: true,
        userId: true,
        deviceId: true,
      },
    });
  }

  /** Mouvement de caisse : le montant est donné en valeur absolue, le signe dépend du type. */
  async addMovement(
    tx: Tx,
    m: {
      sessionId: string;
      type: CashMovementType;
      amount: number;
      reason?: string | null;
      documentType?: string;
      documentId?: string;
      documentRef?: string | null;
      actor: Actor;
      authorizedById?: string | null;
      at?: Date;
    },
  ): Promise<void> {
    const signed = MOVEMENT_SIGN[m.type] * Math.abs(m.amount);
    await tx.cashMovement.create({
      data: {
        sessionId: m.sessionId,
        type: m.type,
        amount: BigInt(signed),
        reason: m.reason ?? null,
        documentType: m.documentType ?? null,
        documentId: m.documentId ?? null,
        documentRef: m.documentRef ?? null,
        userId: m.actor.userId,
        authorizedById: m.authorizedById ?? null,
        createdAt: m.at ?? now(),
      },
    });
  }

  async open(actor: Actor, openingFloat: number, notes?: string | null) {
    if (!actor.deviceId) throw new AppError('DEVICE_UNKNOWN');
    return this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM devices WHERE id = ${actor.deviceId}::uuid FOR UPDATE`;
      if (await this.lockOpenSession(tx, actor.deviceId!))
        throw new AppError('CASH_SESSION_ALREADY_OPEN');
      const at = now();
      const number = await this.sequences.next(tx, 'CS', at);
      const session = await tx.cashSession.create({
        data: {
          number,
          siteId: actor.siteId,
          deviceId: actor.deviceId!,
          userId: actor.userId,
          openedAt: at,
          openingFloat: BigInt(openingFloat),
          notes: notes ?? null,
        },
      });
      await this.audit.record(tx, {
        eventType: 'CASH_SESSION_OPENED',
        actor,
        entityType: 'cash_session',
        entityId: session.id,
        entityRef: number,
        summary: `Caisse ${number} ouverte sur « ${actor.deviceName} » par ${actor.userCode} (fond de caisse ${(openingFloat / 1000).toFixed(3).replace('.', ',')} DT)`,
        after: { openingFloat },
        notify: { data: { amount: openingFloat } },
      });
      return session;
    });
  }

  /** Mouvement manuel : sortie (dépense), apport, retrait, ouverture du tiroir sans vente. */
  async manualMovement(
    actor: Actor,
    input: {
      type: 'EXPENSE' | 'DEPOSIT' | 'WITHDRAWAL' | 'DRAWER_OPEN';
      amount: number;
      reason: string;
    },
  ) {
    if (!actor.deviceId) throw new AppError('DEVICE_UNKNOWN');
    if (input.type !== 'DRAWER_OPEN' && input.amount <= 0)
      throw new AppError('VALIDATION_ERROR', { fieldErrors: { amount: 'Montant obligatoire' } });
    return this.prisma.tx(async (tx) => {
      const session = await this.lockOpenSession(tx, actor.deviceId!);
      if (!session) throw new AppError('CASH_SESSION_NOT_OPEN');
      const at = now();
      await this.addMovement(tx, {
        sessionId: session.id,
        type: input.type,
        amount: input.type === 'DRAWER_OPEN' ? 0 : input.amount,
        reason: input.reason,
        actor,
        at,
      });
      const labels = {
        EXPENSE: 'Sortie de caisse',
        DEPOSIT: 'Apport en caisse',
        WITHDRAWAL: 'Retrait de caisse',
        DRAWER_OPEN: 'Ouverture du tiroir sans vente',
      };
      await this.audit.record(tx, {
        eventType: input.type === 'DRAWER_OPEN' ? 'CASH_DRAWER_OPENED' : 'CASH_MOVEMENT',
        actor,
        entityType: 'cash_session',
        entityId: session.id,
        entityRef: session.number,
        summary: `${labels[input.type]}${input.type === 'DRAWER_OPEN' ? '' : ` : ${(input.amount / 1000).toFixed(3).replace('.', ',')} DT`} — caisse ${session.number}`,
        reason: input.reason,
        after: { type: input.type, amount: input.amount },
      });
    });
  }

  async summary(sessionId: string, client: Tx | PrismaService = this.prisma): Promise<CashSummary> {
    const session = await client.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    const movements = await client.cashMovement.groupBy({
      by: ['type'],
      where: { sessionId },
      _sum: { amount: true },
      _count: true,
    });
    const sum = (t: CashMovementType) => num(movements.find((m) => m.type === t)?._sum.amount);
    const count = (t: CashMovementType) => movements.find((m) => m.type === t)?._count ?? 0;
    const byMethod = await client.payment.groupBy({
      by: ['method'],
      where: { cashSessionId: sessionId, status: { not: 'CANCELLED' } },
      _sum: { amount: true },
      _count: true,
    });
    // Encaissements non espèces du poste pendant la session (cartes, chèques…) pour le rapport Z.
    const otherMethods = await client.payment.groupBy({
      by: ['method'],
      where: {
        deviceId: session.deviceId,
        paidAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) },
        method: { not: 'CASH' },
        status: { not: 'CANCELLED' },
      },
      _sum: { amount: true },
      _count: true,
    });
    const sales = await client.sale.aggregate({
      where: { cashSessionId: sessionId, status: { in: ['VALIDATED', 'CANCELLED'] } },
      _count: true,
      _sum: { totalTtc: true },
    });
    const cancelled = await client.sale.count({
      where: { cashSessionId: sessionId, status: 'CANCELLED' },
    });
    const movementsTotal = movements.reduce((a, m) => a + num(m._sum.amount), 0);
    return {
      openingFloat: num(session.openingFloat),
      salesCash: sum('SALE_PAYMENT'),
      refunds: -sum('REFUND'),
      expenses: -sum('EXPENSE'),
      deposits: sum('DEPOSIT'),
      withdrawals: -sum('WITHDRAWAL'),
      drawerOpenings: count('DRAWER_OPEN'),
      expected: num(session.openingFloat) + movementsTotal,
      byMethod: [...byMethod.filter((m) => m.method === 'CASH'), ...otherMethods].map((m) => ({
        method: m.method,
        amount: num(m._sum.amount),
        count: m._count,
      })),
      salesCount: sales._count,
      salesTotal: num(sales._sum.totalTtc),
      cancelledCount: cancelled,
    };
  }

  /** Clôture avec comptage à l'aveugle : l'écart est calculé par le serveur. */
  async close(sessionId: string, input: CloseCashSessionInput, actor: Actor) {
    const settings = await this.settings.all();
    const counted = input.denominations.reduce((a, d) => a + d.value * d.count, 0);
    return this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; status: string; user_id: string; number: string }[]
      >`
        SELECT id, status, user_id, number FROM cash_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const session = rows[0];
      if (!session) throw new AppError('NOT_FOUND');
      if (session.status !== 'OPEN') throw new AppError('CASH_SESSION_NOT_OPEN');
      if (session.user_id !== actor.userId && !actor.permissions.has('cash.view_expected')) {
        throw new AppError('FORBIDDEN', undefined, {
          message:
            'Seul l’utilisateur qui a ouvert la caisse (ou un administrateur) peut la clôturer.',
        });
      }
      const summary = await this.summary(sessionId, tx);
      const difference = counted - summary.expected;
      const at = now();
      await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          status: 'CLOSED',
          closedAt: at,
          closedById: actor.userId,
          expectedAmount: BigInt(summary.expected),
          countedAmount: BigInt(counted),
          difference: BigInt(difference),
          denominations: input.denominations.filter((d) => d.count > 0),
          closeNotes: input.notes ?? null,
        },
      });
      await this.audit.record(tx, {
        eventType: 'CASH_SESSION_CLOSED',
        actor,
        entityType: 'cash_session',
        entityId: sessionId,
        entityRef: session.number,
        summary: `Caisse ${session.number} clôturée — compté ${(counted / 1000).toFixed(3).replace('.', ',')} DT, écart ${(difference / 1000).toFixed(3).replace('.', ',')} DT`,
        after: { expected: summary.expected, counted, difference },
        notify: { data: { amount: Math.abs(difference), difference } },
      });
      if (Math.abs(difference) > settings['cash.discrepancy_threshold']) {
        await this.audit.record(tx, {
          eventType: 'CASH_DISCREPANCY',
          actor,
          entityType: 'cash_session',
          entityId: sessionId,
          entityRef: session.number,
          summary: `Écart de caisse ${difference > 0 ? 'positif' : 'négatif'} de ${(Math.abs(difference) / 1000).toFixed(3).replace('.', ',')} DT sur la caisse ${session.number}`,
          after: { expected: summary.expected, counted, difference },
          notify: {
            data: { amount: Math.abs(difference), difference },
            link: `/cash/${sessionId}`,
          },
        });
      }
      return {
        id: sessionId,
        number: session.number,
        counted,
        ...(actor.permissions.has('cash.view_expected')
          ? { expected: summary.expected, difference }
          : {}),
      };
    });
  }

  list(q: { page: number; pageSize: number; status?: 'OPEN' | 'CLOSED' }) {
    const where = q.status ? { status: q.status } : {};
    return Promise.all([
      this.prisma.cashSession.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { device: { select: { name: true } } },
      }),
      this.prisma.cashSession.count({ where }),
    ]);
  }
}
