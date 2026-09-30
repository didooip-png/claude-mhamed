import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  CLIENT_LEDGER_ENTRY_TYPES,
  formatDate,
  formatIsoDate,
  ledgerQuerySchema,
  sendStatementSchema,
  settleSchema,
  statementQuerySchema,
  type SettleData,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EmailOutboxService } from '../email/outbox.service.js';
import { ExcelService } from '../exports/excel.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { LedgerService } from './ledger.service.js';

/** Compte client (§6.9) : synthèse, grand livre, factures ouvertes, relevé, lettrage. */
@Controller('clients/:id')
export class AccountsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly documents: DocumentsService,
    private readonly excel: ExcelService,
    private readonly outbox: EmailOutboxService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermission('clients.view')
  @Get('account')
  account(@IdParam() id: string) {
    return this.ledger.account(id);
  }

  @RequirePermission('clients.view')
  @Get('open-invoices')
  openInvoices(@IdParam() id: string) {
    return this.payments.openInvoicesOf(id);
  }

  @RequirePermission('clients.view')
  @Get('ledger')
  ledgerPage(
    @IdParam() id: string,
    @ZQuery(ledgerQuerySchema) q: z.output<typeof ledgerQuerySchema>,
  ) {
    return this.ledger.ledgerPage(id, q);
  }

  /** Historique des e-mails envoyés à ce client (visible sur la fiche, §6.9). */
  @RequirePermission('clients.view')
  @Get('emails')
  async emails(
    @IdParam() id: string,
    @ZQuery(ledgerQuerySchema) q: z.output<typeof ledgerQuerySchema>,
  ) {
    const where = { clientId: id };
    const [items, total] = await Promise.all([
      this.prisma.emailOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        select: {
          id: true,
          kind: true,
          to: true,
          status: true,
          attempts: true,
          lastError: true,
          sentAt: true,
          createdAt: true,
          relatedEntityType: true,
          relatedEntityId: true,
        },
      }),
      this.prisma.emailOutbox.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  /** Relevé de compte sur une période, en PDF ou en Excel. */
  @RequirePermission('clients.view')
  @Get('statement')
  async statement(
    @IdParam() id: string,
    @ZQuery(statementQuerySchema) q: z.output<typeof statementQuerySchema>,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    if (q.format === 'pdf') {
      const pdf = await this.documents.statementPdf(id, q.from, q.to);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="releve-${q.from}-${q.to}.pdf"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(pdf);
      return;
    }
    const st = await this.ledger.statement(id, q.from, q.to);
    const tz = await this.settings.get('general.timezone');
    const buffer = await this.excel.build(
      {
        title: 'Relevé de compte',
        sheetName: 'Relevé',
        subtitle: [
          `Client : ${st.client.code} — ${st.client.name}`,
          `Période : du ${formatIsoDate(q.from)} au ${formatIsoDate(q.to)}`,
          `Solde d’ouverture : ${(st.opening / 1000).toFixed(3)} · Solde de clôture : ${(st.closing / 1000).toFixed(3)}`,
        ],
        columns: [
          { key: 'date', header: 'Date', width: 12 },
          { key: 'doc', header: 'Pièce', width: 20 },
          { key: 'type', header: 'Nature', width: 24 },
          { key: 'label', header: 'Libellé', width: 44 },
          { key: 'debit', header: 'Débit', type: 'money' },
          { key: 'credit', header: 'Crédit', type: 'money' },
          { key: 'balance', header: 'Solde', type: 'money' },
        ],
        rows: st.rows.map((r) => ({
          date: formatDate(r.date, tz),
          doc: r.documentNumber ?? '',
          type: CLIENT_LEDGER_ENTRY_TYPES[r.entryType],
          label: r.description ?? '',
          debit: r.debit || null,
          credit: r.credit || null,
          balance: r.balance,
        })),
        totals: {
          label: 'Totaux de la période',
          debit: st.totalDebit,
          credit: st.totalCredit,
          balance: st.closing,
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
      `attachment; filename="releve-${st.client.code}-${q.from}-${q.to}.xlsx"`,
    );
    res.send(buffer);
  }

  @RequirePermission('email.send_documents')
  @Post('statement/email')
  @HttpCode(200)
  async sendStatement(
    @IdParam() id: string,
    @ZBody(sendStatementSchema) body: z.output<typeof sendStatementSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.outbox.sendDocument(
      {
        entityType: 'statement',
        entityId: id,
        params: { from: body.from, to: body.to },
        to: body.recipients,
        cc: body.cc,
        message: body.message ?? null,
        confirmNoConsent: body.confirmNoConsent,
      },
      actor,
    );
  }

  /** Lettrage d'avoirs et d'acomptes existants sur des factures (sans nouvel encaissement). */
  @RequirePermission('payments.create')
  @Post('settle')
  @HttpCode(200)
  settle(
    @IdParam() id: string,
    @ZBody(settleSchema) body: SettleData,
    @CurrentActor() actor: Actor,
  ) {
    return this.payments.settle(id, body, actor);
  }
}
