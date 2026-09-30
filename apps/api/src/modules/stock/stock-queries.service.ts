import { Injectable } from '@nestjs/common';
import {
  addDaysIso,
  diffDaysIso,
  endOfLocalDayExclusive,
  expiryLevel,
  startOfLocalDay,
  todayIso,
  type MovementQuery,
  type PaginationQuery,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { normalizeSearch } from '../../common/search.js';
import { Prisma, type StockMovementType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockService } from './stock.service.js';

export interface StockStateQuery extends PaginationQuery {
  categoryId?: string;
  laboratoryId?: string;
  location?: string;
  status?: 'OK' | 'LOW' | 'OUT';
  onlyWithStock?: boolean;
}

export interface LotQuery extends PaginationQuery {
  productId?: string;
  status?: string;
  level?: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK';
  supplierId?: string;
  withStock?: boolean;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function searchConditions(alias: string, q: string | undefined): Prisma.Sql[] {
  if (!q) return [];
  const term = normalizeSearch(q);
  const words = term.split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const col = Prisma.raw(`${alias}.search_text`);
  const likes = Prisma.join(
    words.map((w) => Prisma.sql`${col} LIKE ${`%${w}%`}`),
    ' AND ',
  );
  const likes2 = Prisma.join(
    words.map((w) => Prisma.sql`p2.search_text LIKE ${`%${w}%`}`),
    ' AND ',
  );
  // La recherche approximative (fautes de frappe) n'intervient que si aucune correspondance exacte n'existe.
  return [
    Prisma.sql`((${likes})
      OR (${term} <% ${col} AND NOT EXISTS (SELECT 1 FROM products p2 WHERE ${likes2}))
      OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = ${Prisma.raw(alias)}.id AND b.barcode = ${q.trim()}))`,
  ];
}

/** Écrans de consultation du stock (§6.4, §6.5). */
@Injectable()
export class StockQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  private async today(): Promise<string> {
    return todayIso(await this.settings.get('general.timezone'), now());
  }

  /** État du stock par produit : total, vendable, bloqué / périmé, lots, prochaine péremption, valeur. */
  async state(q: StockStateQuery, actor: Actor) {
    const sellableFrom = await this.stock.sellableFrom();
    const conditions: Prisma.Sql[] = [Prisma.sql`p.is_active`, ...searchConditions('p', q.q)];
    if (q.categoryId) conditions.push(Prisma.sql`p.category_id = ${q.categoryId}::uuid`);
    if (q.laboratoryId) conditions.push(Prisma.sql`p.laboratory_id = ${q.laboratoryId}::uuid`);
    if (q.location) conditions.push(Prisma.sql`p.location ILIKE ${`%${q.location}%`}`);
    if (q.onlyWithStock) conditions.push(Prisma.sql`COALESCE(s.total, 0) > 0`);
    if (q.status === 'OUT') conditions.push(Prisma.sql`COALESCE(s.sellable, 0) <= 0`);
    if (q.status === 'LOW')
      conditions.push(
        Prisma.sql`COALESCE(s.sellable, 0) > 0 AND p.min_stock > 0 AND s.sellable <= p.min_stock`,
      );
    if (q.status === 'OK')
      conditions.push(
        Prisma.sql`COALESCE(s.sellable, 0) > 0 AND (p.min_stock = 0 OR s.sellable > p.min_stock)`,
      );
    const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const cte = Prisma.sql`
      WITH s AS (
        SELECT product_id,
          SUM(remaining_qty)::bigint AS total,
          (SUM(remaining_qty) FILTER (WHERE status = 'ACTIVE' AND expiry_date > ${sellableFrom}::date))::bigint AS sellable,
          COUNT(*) FILTER (WHERE remaining_qty > 0)::bigint AS lot_count,
          MIN(expiry_date) FILTER (WHERE remaining_qty > 0 AND status = 'ACTIVE' AND expiry_date > ${sellableFrom}::date) AS next_expiry,
          SUM(remaining_qty::bigint * unit_cost_ht)::bigint AS value_cost
        FROM lots GROUP BY product_id)`;
    const sortMap: Record<string, Prisma.Sql> = {
      name: Prisma.sql`p.name`,
      sellable: Prisma.sql`COALESCE(s.sellable, 0)`,
      total: Prisma.sql`COALESCE(s.total, 0)`,
      nextExpiry: Prisma.sql`s.next_expiry`,
      valueCost: Prisma.sql`COALESCE(s.value_cost, 0)`,
      location: Prisma.sql`p.location`,
    };
    const [field, dir] = (q.sort ?? 'name:asc').split(':');
    const order = sortMap[field ?? ''] ?? Prisma.sql`p.name`;
    const direction = dir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const { skip, take } = pageArgs(q);
    type Row = {
      id: string;
      internal_code: string;
      name: string;
      dosage: string | null;
      form: string | null;
      location: string | null;
      min_stock: number;
      units_per_pack: number;
      sell_by_unit: boolean;
      sale_price_ttc: bigint;
      unit_sale_price_ttc: bigint | null;
      category: string;
      laboratory: string | null;
      total: bigint | null;
      sellable: bigint | null;
      lot_count: bigint | null;
      next_expiry: Date | null;
      value_cost: bigint | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      ${cte}
      SELECT p.id, p.internal_code, p.name, p.dosage, p.form, p.location, p.min_stock, p.units_per_pack, p.sell_by_unit,
        p.sale_price_ttc, p.unit_sale_price_ttc, c.name AS category, l.name AS laboratory,
        s.total, s.sellable, s.lot_count, s.next_expiry, s.value_cost
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN laboratories l ON l.id = p.laboratory_id
      LEFT JOIN s ON s.product_id = p.id
      ${where}
      ORDER BY ${order} ${direction} NULLS LAST, p.name ASC
      LIMIT ${take} OFFSET ${skip}`;
    const agg = await this.prisma.$queryRaw<
      {
        count: bigint;
        value_cost: bigint | null;
        value_sale: bigint | null;
        out: bigint;
        low: bigint;
      }[]
    >`
      ${cte}
      SELECT COUNT(*)::bigint AS count,
        SUM(COALESCE(s.value_cost, 0))::bigint AS value_cost,
        SUM(COALESCE(s.sellable, 0) * CASE WHEN p.sell_by_unit THEN COALESCE(p.unit_sale_price_ttc, 0) ELSE p.sale_price_ttc END)::bigint AS value_sale,
        COUNT(*) FILTER (WHERE COALESCE(s.sellable, 0) <= 0)::bigint AS out,
        COUNT(*) FILTER (WHERE COALESCE(s.sellable, 0) > 0 AND p.min_stock > 0 AND s.sellable <= p.min_stock)::bigint AS low
      FROM products p LEFT JOIN s ON s.product_id = p.id ${where}`;
    const showCosts = actor.permissions.has('catalog.view_costs');
    const items = rows.map((r) => {
      const sellable = num(r.sellable);
      const total = num(r.total);
      const unitPrice = r.sell_by_unit ? num(r.unit_sale_price_ttc) : num(r.sale_price_ttc);
      return {
        id: r.id,
        internalCode: r.internal_code,
        name: r.name,
        dosage: r.dosage,
        form: r.form,
        location: r.location,
        category: r.category,
        laboratory: r.laboratory,
        minStock: r.min_stock,
        unitsPerPack: r.units_per_pack,
        sellByUnit: r.sell_by_unit,
        total,
        sellable,
        unavailable: total - sellable,
        lotCount: num(r.lot_count),
        nextExpiry: iso(r.next_expiry),
        valueCost: showCosts ? num(r.value_cost) : null,
        valueSale: sellable * unitPrice,
        status: sellable <= 0 ? 'OUT' : r.min_stock > 0 && sellable <= r.min_stock ? 'LOW' : 'OK',
      };
    });
    const a = agg[0];
    return {
      ...paginated(items, num(a?.count), q),
      totals: {
        valueCost: showCosts ? num(a?.value_cost) : null,
        valueSale: num(a?.value_sale),
        outOfStock: num(a?.out),
        low: num(a?.low),
      },
    };
  }

  /** Liste des lots avec code couleur de péremption (§6.4). */
  async lots(q: LotQuery, actor: Actor) {
    const settings = await this.settings.all();
    const today = await this.today();
    const orange = settings['stock.expiry_orange_days'];
    const yellow = settings['stock.expiry_yellow_days'];
    const conditions: Prisma.Sql[] = [...searchConditions('p', q.q)];
    if (q.q)
      conditions[0] = Prisma.sql`(${conditions[0]} OR lt.lot_number ILIKE ${`%${q.q.trim()}%`})`;
    if (q.productId) conditions.push(Prisma.sql`lt.product_id = ${q.productId}::uuid`);
    if (q.supplierId) conditions.push(Prisma.sql`lt.supplier_id = ${q.supplierId}::uuid`);
    if (q.withStock !== false) conditions.push(Prisma.sql`lt.remaining_qty > 0`);
    if (q.status === 'EXPIRED') conditions.push(Prisma.sql`lt.expiry_date <= ${today}::date`);
    else if (q.status) conditions.push(Prisma.sql`lt.status = ${q.status}::"LotStatus"`);
    if (q.level === 'EXPIRED') conditions.push(Prisma.sql`lt.expiry_date <= ${today}::date`);
    if (q.level === 'CRITICAL')
      conditions.push(
        Prisma.sql`lt.expiry_date > ${today}::date AND lt.expiry_date < ${addDaysIso(today, orange)}::date`,
      );
    if (q.level === 'WARNING')
      conditions.push(
        Prisma.sql`lt.expiry_date >= ${addDaysIso(today, orange)}::date AND lt.expiry_date < ${addDaysIso(today, yellow)}::date`,
      );
    if (q.level === 'OK')
      conditions.push(Prisma.sql`lt.expiry_date >= ${addDaysIso(today, yellow)}::date`);
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const sortMap: Record<string, Prisma.Sql> = {
      expiryDate: Prisma.sql`lt.expiry_date`,
      receivedAt: Prisma.sql`lt.received_at`,
      remainingQty: Prisma.sql`lt.remaining_qty`,
      product: Prisma.sql`p.name`,
      lotNumber: Prisma.sql`lt.lot_number`,
    };
    const [field, dir] = (q.sort ?? 'expiryDate:asc').split(':');
    const order = sortMap[field ?? ''] ?? Prisma.sql`lt.expiry_date`;
    const direction = dir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const { skip, take } = pageArgs(q);
    type Row = {
      id: string;
      lot_number: string;
      expiry_date: Date;
      received_at: Date;
      initial_qty: number;
      remaining_qty: number;
      unit_cost_ht: bigint;
      status: string;
      block_reason: string | null;
      source_type: string;
      product_id: string;
      internal_code: string;
      product_name: string;
      dosage: string | null;
      units_per_pack: number;
      sell_by_unit: boolean;
      supplier_name: string | null;
    };
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT lt.id, lt.lot_number, lt.expiry_date, lt.received_at, lt.initial_qty, lt.remaining_qty, lt.unit_cost_ht, lt.status,
          lt.block_reason, lt.source_type, p.id AS product_id, p.internal_code, p.name AS product_name, p.dosage, p.units_per_pack,
          p.sell_by_unit, s.name AS supplier_name
        FROM lots lt JOIN products p ON p.id = lt.product_id LEFT JOIN suppliers s ON s.id = lt.supplier_id
        ${where}
        ORDER BY ${order} ${direction}, lt.received_at ASC, lt.id ASC
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ count: bigint; value: bigint | null }[]>`
        SELECT COUNT(*)::bigint AS count, SUM(lt.remaining_qty::bigint * lt.unit_cost_ht)::bigint AS value
        FROM lots lt JOIN products p ON p.id = lt.product_id ${where}`,
    ]);
    const showCosts = actor.permissions.has('catalog.view_costs');
    const items = rows.map((r) => {
      const expiry = iso(r.expiry_date)!;
      return {
        id: r.id,
        lotNumber: r.lot_number,
        expiryDate: expiry,
        daysToExpiry: diffDaysIso(today, expiry),
        level: expiryLevel(expiry, today, orange, yellow),
        receivedAt: r.received_at,
        initialQty: r.initial_qty,
        remainingQty: r.remaining_qty,
        unitCostHt: showCosts ? num(r.unit_cost_ht) : null,
        valueCost: showCosts ? r.remaining_qty * num(r.unit_cost_ht) : null,
        status: r.status,
        blockReason: r.block_reason,
        sourceType: r.source_type,
        supplierName: r.supplier_name,
        product: {
          id: r.product_id,
          internalCode: r.internal_code,
          name: r.product_name,
          dosage: r.dosage,
          unitsPerPack: r.units_per_pack,
          sellByUnit: r.sell_by_unit,
        },
      };
    });
    return {
      ...paginated(items, num(count[0]?.count), q),
      totals: { valueCost: showCosts ? num(count[0]?.value) : null },
    };
  }

  /** Lots à échéance dans les N prochains jours, y compris les périmés encore en stock. */
  async expiries(days: number, q: PaginationQuery, actor: Actor) {
    const today = await this.today();
    const limit = addDaysIso(today, days);
    const settings = await this.settings.all();
    const showCosts = actor.permissions.has('catalog.view_costs');
    const where = Prisma.sql`WHERE lt.remaining_qty > 0 AND lt.expiry_date <= ${limit}::date ${q.q ? Prisma.sql`AND (${searchConditions('p', q.q)[0] ?? Prisma.sql`TRUE`} OR lt.lot_number ILIKE ${`%${q.q}%`})` : Prisma.empty}`;
    const { skip, take } = pageArgs(q);
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        lot_number: string;
        expiry_date: Date;
        remaining_qty: number;
        unit_cost_ht: bigint;
        status: string;
        product_id: string;
        internal_code: string;
        name: string;
        dosage: string | null;
        location: string | null;
        supplier_id: string | null;
        supplier_name: string | null;
        units_per_pack: number;
        sell_by_unit: boolean;
      }[]
    >`
      SELECT lt.id, lt.lot_number, lt.expiry_date, lt.remaining_qty, lt.unit_cost_ht, lt.status, p.id AS product_id, p.internal_code, p.name, p.dosage,
        p.location, lt.supplier_id, s.name AS supplier_name, p.units_per_pack, p.sell_by_unit
      FROM lots lt JOIN products p ON p.id = lt.product_id LEFT JOIN suppliers s ON s.id = lt.supplier_id
      ${where}
      ORDER BY lt.expiry_date ASC, p.name ASC
      LIMIT ${take} OFFSET ${skip}`;
    const totals = await this.prisma.$queryRaw<
      { count: bigint; value: bigint | null; expired_value: bigint | null; expired: bigint }[]
    >`
      SELECT COUNT(*)::bigint AS count, SUM(lt.remaining_qty::bigint * lt.unit_cost_ht)::bigint AS value,
        SUM(lt.remaining_qty::bigint * lt.unit_cost_ht) FILTER (WHERE lt.expiry_date <= ${today}::date)::bigint AS expired_value,
        COUNT(*) FILTER (WHERE lt.expiry_date <= ${today}::date)::bigint AS expired
      FROM lots lt JOIN products p ON p.id = lt.product_id ${where}`;
    const t = totals[0];
    return {
      ...paginated(
        rows.map((r) => {
          const expiry = iso(r.expiry_date)!;
          return {
            id: r.id,
            lotNumber: r.lot_number,
            expiryDate: expiry,
            daysToExpiry: diffDaysIso(today, expiry),
            level: expiryLevel(
              expiry,
              today,
              settings['stock.expiry_orange_days'],
              settings['stock.expiry_yellow_days'],
            ),
            remainingQty: r.remaining_qty,
            valueCost: showCosts ? r.remaining_qty * num(r.unit_cost_ht) : null,
            status: r.status,
            supplier: r.supplier_id ? { id: r.supplier_id, name: r.supplier_name } : null,
            product: {
              id: r.product_id,
              internalCode: r.internal_code,
              name: r.name,
              dosage: r.dosage,
              location: r.location,
              unitsPerPack: r.units_per_pack,
              sellByUnit: r.sell_by_unit,
            },
          };
        }),
        num(t?.count),
        q,
      ),
      totals: {
        valueCost: showCosts ? num(t?.value) : null,
        expiredValueCost: showCosts ? num(t?.expired_value) : null,
        expiredCount: num(t?.expired),
      },
    };
  }

  /**
   * Fiche de mouvement d'un produit (§6.5, RG-21) : stock initial à la date de début, mouvements
   * chronologiques (qui, quand, quoi), totaux par type et stock final.
   */
  async movements(q: MovementQuery & { page?: number; pageSize?: number }, actor: Actor) {
    const product = await this.prisma.product.findUnique({
      where: { id: q.productId },
      select: {
        id: true,
        internalCode: true,
        name: true,
        dosage: true,
        form: true,
        unitsPerPack: true,
        sellByUnit: true,
      },
    });
    if (!product) throw new AppError('NOT_FOUND');
    const tz = await this.settings.get('general.timezone');
    const from = startOfLocalDay(q.from, tz);
    const to = q.to ? endOfLocalDayExclusive(q.to, tz) : new Date(now().getTime() + 1000);
    if (to <= from)
      throw new AppError('VALIDATION_ERROR', {
        fieldErrors: { to: 'La date de fin doit être postérieure à la date de début' },
      });

    const opening = await this.prisma.stockMovement.aggregate({
      where: { productId: q.productId, createdAt: { lt: from } },
      _sum: { qty: true },
    });
    const openingQty = opening._sum.qty ?? 0;
    // Les totaux par type peuvent mélanger entrées et sorties (ex. inventaire) : on les recalcule par signe.
    const bySign = await this.prisma.$queryRaw<
      { type: StockMovementType; qty_in: bigint; qty_out: bigint; count: bigint }[]
    >`
      SELECT type, COALESCE(SUM(qty) FILTER (WHERE qty > 0), 0)::bigint AS qty_in, COALESCE(-SUM(qty) FILTER (WHERE qty < 0), 0)::bigint AS qty_out, COUNT(*)::bigint AS count
      FROM stock_movements WHERE product_id = ${q.productId}::uuid AND created_at >= ${from} AND created_at < ${to}
      GROUP BY type ORDER BY type`;
    const sumIn = bySign.reduce((a, r) => a + num(r.qty_in), 0);
    const sumOut = bySign.reduce((a, r) => a + num(r.qty_out), 0);

    const where: Prisma.StockMovementWhereInput = {
      productId: q.productId,
      createdAt: { gte: from, lt: to },
      ...(q.type ? { type: { in: q.type.split(',') as StockMovementType[] } } : {}),
      ...(q.lotId ? { lotId: q.lotId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.counterpartId ? { counterpartId: q.counterpartId } : {}),
    };
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 100, 1000);
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { lot: { select: { lotNumber: true, expiryDate: true } } },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.userId, r.authorizedById].filter((x): x is string => !!x))),
    ];
    const deviceIds = [...new Set(rows.map((r) => r.deviceId).filter((x): x is string => !!x))];
    const [users, devices] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, code: true, fullName: true },
      }),
      this.prisma.device.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, name: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const deviceById = new Map(devices.map((d) => [d.id, d.name]));
    const showCosts = actor.permissions.has('catalog.view_costs');
    return {
      product,
      period: { from: from.toISOString(), to: to.toISOString() },
      openingQty,
      totalIn: sumIn,
      totalOut: sumOut,
      closingQty: openingQty + sumIn - sumOut,
      byType: bySign.map((r) => ({
        type: r.type,
        qtyIn: num(r.qty_in),
        qtyOut: num(r.qty_out),
        count: num(r.count),
      })),
      items: rows.map((r) => ({
        id: Number(r.id),
        createdAt: r.createdAt,
        type: r.type,
        documentType: r.documentType,
        documentId: r.documentId,
        documentNumber: r.documentNumber,
        lotId: r.lotId,
        lotNumber: r.lot.lotNumber,
        expiryDate: iso(r.lot.expiryDate),
        qtyIn: r.qty > 0 ? r.qty : 0,
        qtyOut: r.qty < 0 ? -r.qty : 0,
        balanceAfter: r.productBalanceAfter,
        lotBalanceAfter: r.lotBalanceAfter,
        counterpartType: r.counterpartType,
        counterpartId: r.counterpartId,
        counterpartName: r.counterpartName,
        unitPriceTtc: r.unitPriceTtc,
        unitCostHt: showCosts ? r.unitCostHt : null,
        user: userById.get(r.userId) ?? null,
        authorizedBy: r.authorizedById ? (userById.get(r.authorizedById) ?? null) : null,
        device: r.deviceId ? (deviceById.get(r.deviceId) ?? null) : null,
        reason: r.reason,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** État du stock tel qu'il était à la fin d'une date donnée (reconstitué depuis les mouvements). */
  async atDate(date: string, q: PaginationQuery, actor: Actor) {
    const tz = await this.settings.get('general.timezone');
    const until = endOfLocalDayExclusive(date, tz);
    const conditions: Prisma.Sql[] = [...searchConditions('p', q.q)];
    const where =
      conditions.length > 0 ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const { skip, take } = pageArgs(q);
    const cte = Prisma.sql`
      WITH lb AS (
        SELECT m.product_id, m.lot_id, SUM(m.qty)::bigint AS qty
        FROM stock_movements m WHERE m.created_at < ${until}
        GROUP BY m.product_id, m.lot_id HAVING SUM(m.qty) <> 0),
      pb AS (
        SELECT lb.product_id, SUM(lb.qty)::bigint AS qty, SUM(lb.qty * l.unit_cost_ht)::bigint AS value_cost, COUNT(*)::bigint AS lot_count
        FROM lb JOIN lots l ON l.id = lb.lot_id GROUP BY lb.product_id)`;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        internal_code: string;
        name: string;
        dosage: string | null;
        units_per_pack: number;
        sell_by_unit: boolean;
        qty: bigint;
        value_cost: bigint;
        lot_count: bigint;
      }[]
    >`
      ${cte}
      SELECT p.id, p.internal_code, p.name, p.dosage, p.units_per_pack, p.sell_by_unit, pb.qty, pb.value_cost, pb.lot_count
      FROM pb JOIN products p ON p.id = pb.product_id
      WHERE TRUE ${where}
      ORDER BY p.name ASC LIMIT ${take} OFFSET ${skip}`;
    const totals = await this.prisma.$queryRaw<
      { count: bigint; qty: bigint | null; value_cost: bigint | null }[]
    >`
      ${cte}
      SELECT COUNT(*)::bigint AS count, SUM(pb.qty)::bigint AS qty, SUM(pb.value_cost)::bigint AS value_cost
      FROM pb JOIN products p ON p.id = pb.product_id WHERE TRUE ${where}`;
    const showCosts = actor.permissions.has('catalog.view_costs');
    return {
      ...paginated(
        rows.map((r) => ({
          id: r.id,
          internalCode: r.internal_code,
          name: r.name,
          dosage: r.dosage,
          unitsPerPack: r.units_per_pack,
          sellByUnit: r.sell_by_unit,
          qty: num(r.qty),
          lotCount: num(r.lot_count),
          valueCost: showCosts ? num(r.value_cost) : null,
        })),
        num(totals[0]?.count),
        q,
      ),
      date,
      totals: { valueCost: showCosts ? num(totals[0]?.value_cost) : null },
    };
  }

  /** Bloquer / débloquer un lot (rappel, doute qualité) — administrateur (lots.manage). */
  async setLotBlocked(lotId: string, blocked: boolean, reason: string, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const lots = await this.stock.lockLots(tx, [lotId]);
      const lot = lots.get(lotId);
      if (!lot) throw new AppError('NOT_FOUND');
      const product = await tx.product.findUniqueOrThrow({
        where: { id: lot.product_id },
        select: { name: true, internalCode: true },
      });
      if (blocked && lot.status === 'BLOCKED')
        throw new AppError('CONFLICT', undefined, { message: 'Ce lot est déjà bloqué.' });
      if (!blocked && lot.status !== 'BLOCKED' && lot.status !== 'QUARANTINE')
        throw new AppError('CONFLICT', undefined, { message: 'Ce lot n’est pas bloqué.' });
      const status = blocked ? 'BLOCKED' : lot.remaining_qty > 0 ? 'ACTIVE' : 'EXHAUSTED';
      await tx.lot.update({
        where: { id: lotId },
        data: { status, blockReason: blocked ? reason : null },
      });
      await this.audit.record(tx, {
        eventType: blocked ? 'LOT_BLOCKED' : 'LOT_UNBLOCKED',
        actor,
        entityType: 'lot',
        entityId: lotId,
        entityRef: `${product.internalCode} — ${product.name} — lot ${lot.lot_number}`,
        summary: `Lot ${lot.lot_number} de ${product.name} ${blocked ? 'bloqué' : 'débloqué'} (${lot.remaining_qty} unité(s) en stock)`,
        reason,
        before: { status: lot.status },
        after: { status },
      });
      return { id: lotId, status };
    });
  }
}
