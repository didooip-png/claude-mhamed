import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  cashMovementSchema,
  closeCashSessionSchema,
  openCashSessionSchema,
  paginationSchema,
  type CloseCashSessionInput,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import { paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CashService } from './cash.service.js';

const listSchema = paginationSchema.extend({ status: z.enum(['OPEN', 'CLOSED']).optional() });

@Controller('cash')
export class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly documents: DocumentsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Session ouverte sur ce poste (sans montant théorique : comptage à l'aveugle, RG-19). */
  @RequirePermission('sales.create')
  @Get('current')
  async current(@CurrentActor() actor: Actor) {
    const settings = await this.settings.all();
    const session = actor.deviceId ? await this.cash.currentSession(actor.deviceId) : null;
    const opener = session
      ? await this.prisma.user.findUnique({
          where: { id: session.userId },
          select: { code: true, fullName: true },
        })
      : null;
    return {
      session: session ? { ...session, openedBy: opener } : null,
      required: settings['cash.required_for_cash_payments'],
      denominations: settings['cash.denominations'],
      canViewExpected: actor.permissions.has('cash.view_expected'),
    };
  }

  @RequirePermission('cash.operate')
  @Post('open')
  open(
    @ZBody(openCashSessionSchema) body: z.output<typeof openCashSessionSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.cash.open(actor, body.openingFloat, body.notes);
  }

  /** Sortie (dépense), apport, retrait, ouverture du tiroir sans vente — motif obligatoire. */
  @RequirePermission('cash.expense')
  @Post('movements')
  @HttpCode(200)
  async movement(
    @ZBody(cashMovementSchema) body: z.output<typeof cashMovementSchema>,
    @CurrentActor() actor: Actor,
  ) {
    await this.cash.manualMovement(actor, body);
    return { ok: true };
  }

  @RequirePermission('cash.operate')
  @Post(':id/close')
  @HttpCode(200)
  close(
    @IdParam() id: string,
    @ZBody(closeCashSessionSchema) body: CloseCashSessionInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.cash.close(id, body, actor);
  }

  @RequirePermission('cash.view_expected')
  @Get('sessions')
  async list(@ZQuery(listSchema) q: z.infer<typeof listSchema>) {
    const [items, total] = await this.cash.list(q);
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              items.flatMap((s) => [s.userId, s.closedById]).filter((x): x is string => !!x),
            ),
          ],
        },
      },
      select: { id: true, code: true, fullName: true },
    });
    return paginated(
      items.map((s) => ({
        id: s.id,
        number: s.number,
        status: s.status,
        device: s.device.name,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
        openingFloat: s.openingFloat,
        expectedAmount: s.expectedAmount,
        countedAmount: s.countedAmount,
        difference: s.difference,
        openedBy: users.find((u) => u.id === s.userId) ?? null,
        closedBy: users.find((u) => u.id === s.closedById) ?? null,
      })),
      total,
      q,
    );
  }

  @RequirePermission('cash.view_expected')
  @Get(':id')
  async get(@IdParam() id: string) {
    const session = await this.prisma.cashSession.findUnique({
      where: { id },
      include: { device: { select: { name: true } }, movements: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new AppError('NOT_FOUND');
    const userIds = [
      session.userId,
      session.closedById,
      ...session.movements.map((m) => m.userId),
      ...session.movements.map((m) => m.authorizedById),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds.filter((x): x is string => !!x))] } },
      select: { id: true, code: true, fullName: true },
    });
    const u = (uid: string | null) => (uid ? (users.find((x) => x.id === uid) ?? null) : null);
    return {
      ...session,
      device: session.device.name,
      openedBy: u(session.userId),
      closedBy: u(session.closedById),
      movements: session.movements.map((m) => ({
        ...m,
        user: u(m.userId),
        authorizedBy: u(m.authorizedById),
      })),
      summary: await this.cash.summary(id),
    };
  }

  /** Rapport X (session ouverte) ou Z (session clôturée), format ticket 80 mm. */
  @RequirePermission('cash.view_expected')
  @Get(':id/report')
  async report(@IdParam() id: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const pdf = await this.documents.cashReportPdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="rapport-caisse-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }
}
