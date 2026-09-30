import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  formatDateTime,
  formatIsoDate,
  isoDateSchema,
  lotBlockSchema,
  movementQuerySchema,
  paginationSchema,
  STOCK_MOVEMENT_TYPES,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { SettingsService } from '../settings/settings.service.js';
import { ExcelService } from '../exports/excel.service.js';
import { StockQueriesService } from './stock-queries.service.js';

const stateSchema = paginationSchema.extend({
  categoryId: z.uuid().optional(),
  laboratoryId: z.uuid().optional(),
  location: z.string().max(60).optional(),
  status: z.enum(['OK', 'LOW', 'OUT']).optional(),
  onlyWithStock: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => v === '1'),
});

const lotsSchema = paginationSchema.extend({
  productId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'BLOCKED', 'QUARANTINE', 'EXHAUSTED', 'EXPIRED']).optional(),
  level: z.enum(['EXPIRED', 'CRITICAL', 'WARNING', 'OK']).optional(),
  supplierId: z.uuid().optional(),
  withStock: z
    .enum(['0', '1'])
    .default('1')
    .transform((v) => v === '1'),
});

@Controller('stock')
export class StockController {
  constructor(
    private readonly queries: StockQueriesService,
    private readonly excel: ExcelService,
    private readonly settings: SettingsService,
  ) {}

  /** Export Excel de la fiche de mouvement (toutes les lignes de la période). */
  @RequirePermission('stock.movements')
  @Get('movements/export')
  async exportMovements(
    @ZQuery(movementQuerySchema) q: z.infer<typeof movementQuerySchema>,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    const sheet = await this.queries.movements({ ...q, page: 1, pageSize: 100_000 }, actor);
    const tz = await this.settings.get('general.timezone');
    const p = sheet.product;
    const showCost = actor.permissions.has('catalog.view_costs');
    const buffer = await this.excel.build(
      {
        title: 'Fiche de mouvement',
        sheetName: 'Mouvements',
        subtitle: [
          `Produit : ${p.internalCode} — ${p.name}${p.dosage ? ` ${p.dosage}` : ''}`,
          `Période : du ${formatIsoDate(q.from)} au ${formatIsoDate(q.to ?? q.from)}`,
          `Stock initial : ${sheet.openingQty} · Entrées : ${sheet.totalIn} · Sorties : ${sheet.totalOut} · Stock final : ${sheet.closingQty}${p.sellByUnit ? ' (unités)' : ''}`,
        ],
        columns: [
          { key: 'date', header: 'Date et heure', width: 20 },
          { key: 'type', header: 'Type', width: 22 },
          { key: 'document', header: 'Document', width: 20 },
          { key: 'lot', header: 'Lot', width: 14 },
          { key: 'expiry', header: 'Péremption', width: 12 },
          { key: 'in', header: 'Entrée', type: 'qty' },
          { key: 'out', header: 'Sortie', type: 'qty' },
          { key: 'balance', header: 'Solde', type: 'qty' },
          { key: 'counterpart', header: 'Client / fournisseur', width: 26 },
          { key: 'price', header: 'Prix TTC', type: 'money' },
          ...(showCost ? [{ key: 'cost', header: 'Coût HT', type: 'money' as const }] : []),
          { key: 'user', header: 'Utilisateur', width: 24 },
          { key: 'authorized', header: 'Autorisé par', width: 12 },
          { key: 'device', header: 'Poste', width: 16 },
          { key: 'reason', header: 'Motif', width: 30 },
        ],
        rows: sheet.items.map((m) => ({
          date: formatDateTime(m.createdAt, tz),
          type: STOCK_MOVEMENT_TYPES[m.type],
          document: m.documentNumber ?? '',
          lot: m.lotNumber,
          expiry: m.expiryDate ? formatIsoDate(m.expiryDate) : '',
          in: m.qtyIn || null,
          out: m.qtyOut || null,
          balance: m.balanceAfter,
          counterpart: m.counterpartName ?? '',
          price: m.unitPriceTtc,
          cost: m.unitCostHt,
          user: m.user ? `${m.user.code} — ${m.user.fullName}` : '',
          authorized: m.authorizedBy?.code ?? '',
          device: m.device ?? '',
          reason: m.reason ?? '',
        })),
        totals: {
          date: 'Totaux',
          in: sheet.totalIn,
          out: sheet.totalOut,
          balance: sheet.closingQty,
        },
      },
      actor,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fiche-mouvement-${p.internalCode}.xlsx"`,
    );
    res.send(buffer);
  }

  @RequirePermission('stock.view')
  @Get('state')
  state(@ZQuery(stateSchema) q: z.infer<typeof stateSchema>, @CurrentActor() actor: Actor) {
    return this.queries.state(q, actor);
  }

  @RequirePermission('stock.view')
  @Get('lots')
  lots(@ZQuery(lotsSchema) q: z.infer<typeof lotsSchema>, @CurrentActor() actor: Actor) {
    return this.queries.lots(q, actor);
  }

  @RequirePermission('stock.view')
  @Get('expiries')
  expiries(
    @ZQuery(paginationSchema.extend({ days: z.coerce.number().int().min(0).max(730).default(90) }))
    q: z.infer<typeof paginationSchema> & { days: number },
    @CurrentActor() actor: Actor,
  ) {
    return this.queries.expiries(q.days, q, actor);
  }

  /** Fiche de mouvement d'un produit depuis une date choisie (§6.5). */
  @RequirePermission('stock.movements')
  @Get('movements')
  movements(
    @ZQuery(
      movementQuerySchema.extend({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(1000).default(200),
      }),
    )
    q: z.infer<typeof movementQuerySchema> & { page: number; pageSize: number },
    @CurrentActor() actor: Actor,
  ) {
    return this.queries.movements(q, actor);
  }

  @RequirePermission('stock.view')
  @Get('at-date')
  atDate(
    @ZQuery(paginationSchema.extend({ date: isoDateSchema }))
    q: z.infer<typeof paginationSchema> & { date: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.queries.atDate(q.date, q, actor);
  }

  @RequirePermission('lots.manage')
  @Post('lots/:id/block')
  @HttpCode(200)
  block(
    @IdParam() id: string,
    @ZBody(lotBlockSchema) body: { reason: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.queries.setLotBlocked(id, true, body.reason, actor);
  }

  @RequirePermission('lots.manage')
  @Post('lots/:id/unblock')
  @HttpCode(200)
  unblock(
    @IdParam() id: string,
    @ZBody(lotBlockSchema) body: { reason: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.queries.setLotBlocked(id, false, body.reason, actor);
  }
}
