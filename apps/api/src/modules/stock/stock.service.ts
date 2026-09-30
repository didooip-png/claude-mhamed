import { Injectable } from '@nestjs/common';
import { addDaysIso, todayIso } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import type { Actor } from '../../common/request-context.js';
import type {
  CounterpartType,
  LotStatus,
  StockMovementType,
} from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface LockedLot {
  id: string;
  product_id: string;
  site_id: string;
  lot_number: string;
  expiry_date: Date;
  received_at: Date;
  remaining_qty: number;
  initial_qty: number;
  unit_cost_ht: bigint;
  status: LotStatus;
}

export interface MovementInput {
  lot: Pick<LockedLot, 'id' | 'product_id' | 'site_id'>;
  type: StockMovementType;
  /** Quantité signée en unité de base : positive = entrée, négative = sortie. */
  qty: number;
  unitCostHt: bigint | number;
  unitPriceTtc?: bigint | number | null;
  documentType: string;
  documentId: string;
  documentNumber?: string | null;
  counterpartType?: CounterpartType;
  counterpartId?: string | null;
  counterpartName?: string | null;
  reason?: string | null;
  actor: Actor;
  authorizedById?: string | null;
  at?: Date;
}

/**
 * Noyau des mouvements de stock (ajout seul). Règles :
 * - toute écriture se fait dans une transaction, après verrouillage des produits concernés
 *   (ordre déterministe par id, RG-05.3) puis des lots (FOR UPDATE) ;
 * - chaque mouvement est rattaché à un lot et à un document source (§4.4) ;
 * - le stock n'est jamais négatif (contrôle ici + CHECK en base, RG-03).
 */
@Injectable()
export class StockService {
  constructor(private readonly settings: SettingsService) {}

  /** Verrouille les produits dans un ordre déterministe (évite les interblocages entre postes). */
  async lockProducts(tx: Tx, productIds: string[]): Promise<void> {
    const ids = [...new Set(productIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw`SELECT id FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
  }

  async lockLots(tx: Tx, lotIds: string[]): Promise<Map<string, LockedLot>> {
    const ids = [...new Set(lotIds)].sort();
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<LockedLot[]>`
      SELECT id, product_id, site_id, lot_number, expiry_date, received_at, remaining_qty, initial_qty, unit_cost_ht, status
      FROM lots WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    return new Map(rows.map((r) => [r.id, r]));
  }

  async productBalance(tx: Tx, productId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ total: bigint | null }[]>`
      SELECT COALESCE(SUM(remaining_qty), 0)::bigint AS total FROM lots WHERE product_id = ${productId}::uuid`;
    return Number(rows[0]?.total ?? 0);
  }

  /** Date limite (exclusive) de vendabilité : péremption > aujourd'hui + N jours (RG-04). */
  async sellableFrom(tx?: Tx): Promise<string> {
    const settings = await this.settings.all(tx);
    return addDaysIso(
      todayIso(settings['general.timezone'], now()),
      settings['stock.sale_block_days'],
    );
  }

  /** Applique un mouvement : met à jour le lot, calcule les soldes, écrit la ligne de mouvement. */
  async move(
    tx: Tx,
    input: MovementInput,
  ): Promise<{ lotBalanceAfter: number; productBalanceAfter: number }> {
    if (!Number.isInteger(input.qty) || input.qty === 0)
      throw new AppError('VALIDATION_ERROR', { qty: input.qty });
    const updated = await tx.$queryRaw<{ remaining_qty: number; status: LotStatus }[]>`
      UPDATE lots SET
        remaining_qty = remaining_qty + ${input.qty},
        status = CASE
          WHEN status = 'ACTIVE' AND remaining_qty + ${input.qty} = 0 THEN 'EXHAUSTED'::"LotStatus"
          WHEN status = 'EXHAUSTED' AND remaining_qty + ${input.qty} > 0 THEN 'ACTIVE'::"LotStatus"
          ELSE status END,
        updated_at = now()
      WHERE id = ${input.lot.id}::uuid AND remaining_qty + ${input.qty} >= 0
      RETURNING remaining_qty, status`;
    const lot = updated[0];
    if (!lot)
      throw new AppError('STOCK_INSUFFICIENT', { lotId: input.lot.id, requested: -input.qty });
    const productBalanceAfter = await this.productBalance(tx, input.lot.product_id);
    await tx.stockMovement.create({
      data: {
        siteId: input.lot.site_id,
        productId: input.lot.product_id,
        lotId: input.lot.id,
        type: input.type,
        qty: input.qty,
        unitCostHt: BigInt(input.unitCostHt),
        unitPriceTtc:
          input.unitPriceTtc === null || input.unitPriceTtc === undefined
            ? null
            : BigInt(input.unitPriceTtc),
        productBalanceAfter,
        lotBalanceAfter: lot.remaining_qty,
        documentType: input.documentType,
        documentId: input.documentId,
        documentNumber: input.documentNumber ?? null,
        counterpartType: input.counterpartType ?? 'NONE',
        counterpartId: input.counterpartId ?? null,
        counterpartName: input.counterpartName ?? null,
        reason: input.reason ?? null,
        userId: input.actor.userId,
        authorizedById: input.authorizedById ?? null,
        deviceId: input.actor.deviceId,
        createdAt: input.at ?? now(),
      },
    });
    return { lotBalanceAfter: lot.remaining_qty, productBalanceAfter };
  }
}
