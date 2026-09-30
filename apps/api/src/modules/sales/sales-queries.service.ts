import { Injectable } from '@nestjs/common';
import {
  endOfLocalDayExclusive,
  productLabel,
  startOfLocalDay,
  type PaginationQuery,
} from '@pharmastock/shared';
import { num } from '../../common/json.js';
import { orderBy, pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface SalesListQuery extends PaginationQuery {
  status?: 'VALIDATED' | 'CANCELLED';
  paymentStatus?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  clientId?: string;
  userId?: string;
  productId?: string;
  deviceId?: string;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
}

/** Historique des ventes (§6.6), onglet « Ventes annulées » et indicateurs du mouchard (§6.16). */
@Injectable()
export class SalesQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async period(
    from: string | undefined,
    to: string | undefined,
  ): Promise<Prisma.DateTimeFilter | undefined> {
    if (!from && !to) return undefined;
    const tz = await this.settings.get('general.timezone');
    return {
      ...(from ? { gte: startOfLocalDay(from, tz) } : {}),
      ...(to ? { lt: endOfLocalDayExclusive(to, tz) } : {}),
    };
  }

  private async users(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0)
      return new Map<string, { id: string; code: string; fullName: string }>();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, code: true, fullName: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }

  async list(q: SalesListQuery, actor: Actor) {
    const validatedAt = await this.period(q.from, q.to);
    const term = q.q?.trim();
    const where: Prisma.SaleWhereInput = {
      status: q.status ? q.status : { in: ['VALIDATED', 'CANCELLED'] },
      ...(q.paymentStatus ? { paymentStatus: q.paymentStatus, status: 'VALIDATED' } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.userId ? { validatedById: q.userId } : {}),
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.productId ? { lines: { some: { productId: q.productId } } } : {}),
      ...(validatedAt ? { validatedAt } : {}),
      ...(q.minAmount !== undefined || q.maxAmount !== undefined
        ? {
            totalTtc: {
              ...(q.minAmount !== undefined ? { gte: BigInt(q.minAmount) } : {}),
              ...(q.maxAmount !== undefined ? { lte: BigInt(q.maxAmount) } : {}),
            },
          }
        : {}),
      // Sans la permission « voir toutes les ventes », seulement les siennes.
      ...(actor.permissions.has('sales.view_all') ? {} : { validatedById: actor.userId }),
      ...(term
        ? {
            OR: [
              { number: { contains: term, mode: 'insensitive' } },
              { client: { name: { contains: term, mode: 'insensitive' } } },
              { client: { code: { contains: term, mode: 'insensitive' } } },
              { client: { phone: { contains: term } } },
            ],
          }
        : {}),
    };
    const [items, total, sums] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: [
          orderBy(q.sort, ['validatedAt', 'totalTtc', 'number'] as const, { validatedAt: 'desc' }),
        ],
        ...pageArgs(q),
        select: {
          id: true,
          number: true,
          status: true,
          paymentStatus: true,
          returnStatus: true,
          validatedAt: true,
          cancelledAt: true,
          totalTtc: true,
          amountDue: true,
          totalDiscount: true,
          validatedById: true,
          deviceId: true,
          replacesSaleId: true,
          replacedBy: { select: { id: true, number: true } },
          client: { select: { id: true, code: true, name: true, isWalkIn: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where: { ...where, status: 'VALIDATED' },
        _sum: { totalTtc: true, amountDue: true },
      }),
    ]);
    const users = await this.users(items.map((i) => i.validatedById));
    const devices = await this.prisma.device.findMany({
      where: { id: { in: items.map((i) => i.deviceId).filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    });
    return {
      ...paginated(
        items.map((s) => ({
          id: s.id,
          number: s.number,
          status: s.status,
          paymentStatus: s.paymentStatus,
          returnStatus: s.returnStatus,
          validatedAt: s.validatedAt,
          cancelledAt: s.cancelledAt,
          totalTtc: s.totalTtc,
          amountDue: s.status === 'CANCELLED' ? 0n : s.amountDue,
          totalDiscount: s.totalDiscount,
          lineCount: s._count.lines,
          client: s.client,
          validatedBy: s.validatedById ? (users.get(s.validatedById) ?? null) : null,
          device: devices.find((d) => d.id === s.deviceId)?.name ?? null,
          replacesSaleId: s.replacesSaleId,
          replacedBy: s.replacedBy,
        })),
        total,
        q,
      ),
      totals: { totalTtc: num(sums._sum.totalTtc), amountDue: num(sums._sum.amountDue) },
    };
  }

  /** Onglet « Ventes annulées » du mouchard, avec le total annulé sur la période. */
  async cancelled(q: PaginationQuery & { from?: string; to?: string; userId?: string }) {
    const cancelledAt = await this.period(q.from, q.to);
    const term = q.q?.trim();
    const where: Prisma.SaleWhereInput = {
      status: 'CANCELLED',
      ...(cancelledAt ? { cancelledAt } : {}),
      ...(q.userId ? { OR: [{ cancelledById: q.userId }, { validatedById: q.userId }] } : {}),
      ...(term
        ? {
            AND: [
              {
                OR: [
                  { number: { contains: term, mode: 'insensitive' } },
                  { client: { name: { contains: term, mode: 'insensitive' } } },
                ],
              },
            ],
          }
        : {}),
    };
    const [items, total, sums] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { cancelledAt: 'desc' },
        ...pageArgs(q),
        select: {
          id: true,
          number: true,
          validatedAt: true,
          cancelledAt: true,
          cancelReason: true,
          totalTtc: true,
          validatedById: true,
          cancelledById: true,
          cancelAuthorizedById: true,
          replacedBy: { select: { id: true, number: true, totalTtc: true } },
          client: { select: { id: true, code: true, name: true } },
          lines: {
            orderBy: { lineNo: 'asc' },
            select: {
              qty: true,
              unit: true,
              lineTotalTtc: true,
              product: { select: { name: true, dosage: true } },
            },
          },
        },
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({ where, _sum: { totalTtc: true } }),
    ]);
    const users = await this.users(
      items.flatMap((i) => [i.validatedById, i.cancelledById, i.cancelAuthorizedById]),
    );
    const u = (id: string | null) => (id ? (users.get(id) ?? null) : null);
    return {
      ...paginated(
        items.map((s) => ({
          id: s.id,
          number: s.number,
          validatedAt: s.validatedAt,
          cancelledAt: s.cancelledAt,
          reason: s.cancelReason,
          totalTtc: s.totalTtc,
          client: s.client,
          soldBy: u(s.validatedById),
          cancelledBy: u(s.cancelledById),
          authorizedBy: u(s.cancelAuthorizedById),
          replacedBy: s.replacedBy,
          lines: s.lines.map((l) => ({
            product: productLabel(l.product),
            qty: l.qty,
            unit: l.unit,
            total: l.lineTotalTtc,
          })),
        })),
        total,
        q,
      ),
      totalCancelled: num(sums._sum.totalTtc),
    };
  }

  /** Indicateurs par utilisateur sur la période : annulations, retraits de lignes, paniers abandonnés. */
  async indicators(q: { from?: string; to?: string }) {
    const occurredAt = await this.period(q.from, q.to);
    const events = [
      'SALE_CANCELLED',
      'SALE_MODIFIED',
      'CART_LINE_REMOVED',
      'DRAFT_SALE_DISCARDED',
      'DISCOUNT_OVER_LIMIT',
      'PRICE_OVERRIDE',
      'DOCUMENT_REPRINTED',
      'CASH_DRAWER_OPENED',
    ];
    const grouped = await this.prisma.auditLog.groupBy({
      by: ['userId', 'eventType'],
      where: {
        eventType: { in: events },
        userId: { not: null },
        ...(occurredAt ? { occurredAt } : {}),
      },
      _count: true,
    });
    // Ventes de l'utilisateur ensuite annulées (par lui ou par un administrateur).
    const cancelledAt = occurredAt;
    const soldCancelled = await this.prisma.sale.groupBy({
      by: ['validatedById'],
      where: { status: 'CANCELLED', ...(cancelledAt ? { cancelledAt } : {}) },
      _count: true,
      _sum: { totalTtc: true },
    });
    const sold = await this.prisma.sale.groupBy({
      by: ['validatedById'],
      where: {
        status: { in: ['VALIDATED', 'CANCELLED'] },
        ...(occurredAt ? { validatedAt: occurredAt } : {}),
      },
      _count: true,
      _sum: { totalTtc: true },
    });
    const ids = [
      ...grouped.map((g) => g.userId),
      ...soldCancelled.map((s) => s.validatedById),
      ...sold.map((s) => s.validatedById),
    ];
    const users = await this.users(ids);
    return [...users.values()]
      .map((user) => {
        const count = (type: string) =>
          grouped.find((g) => g.userId === user.id && g.eventType === type)?._count ?? 0;
        const sc = soldCancelled.find((s) => s.validatedById === user.id);
        const sv = sold.find((s) => s.validatedById === user.id);
        return {
          user,
          salesCount: sv?._count ?? 0,
          salesTotal: num(sv?._sum.totalTtc),
          cancellationsDone: count('SALE_CANCELLED'),
          modificationsDone: count('SALE_MODIFIED'),
          ownSalesCancelled: sc?._count ?? 0,
          ownSalesCancelledAmount: num(sc?._sum.totalTtc),
          lineRemovals: count('CART_LINE_REMOVED'),
          draftsDiscarded: count('DRAFT_SALE_DISCARDED'),
          discountsOverLimit: count('DISCOUNT_OVER_LIMIT'),
          priceOverrides: count('PRICE_OVERRIDE'),
          reprints: count('DOCUMENT_REPRINTED'),
          drawerOpenings: count('CASH_DRAWER_OPENED'),
        };
      })
      .sort((a, b) => a.user.code.localeCompare(b.user.code));
  }

  /** Historique des e-mails liés à une vente. */
  emails(saleId: string) {
    return this.prisma.emailOutbox.findMany({
      where: { relatedEntityType: 'sale', relatedEntityId: saleId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        to: true,
        cc: true,
        status: true,
        attempts: true,
        lastError: true,
        sentAt: true,
        createdAt: true,
        subject: true,
      },
    });
  }
}
