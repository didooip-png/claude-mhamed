import { Injectable } from '@nestjs/common';
import {
  amountInWords,
  CASH_MOVEMENT_TYPES,
  formatBp,
  formatDate,
  formatDateTime,
  formatIsoDate,
  formatMoney,
  formatStockQty,
  PAYMENT_METHODS,
  CLIENT_LEDGER_ENTRY_TYPES,
  productLabel,
  type SettingsMap,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { num } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LedgerService } from '../accounts/ledger.service.js';
import { CashService } from '../cash/cash.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { renderPdf, TICKET_WIDTH, type DocDefinition } from './pdf.js';

export type DocumentFormat = 'A4' | 'TICKET';

interface Establishment {
  settings: SettingsMap;
  logo: string | null;
}

const PRIMARY = '#0f766e';

/**
 * Documents imprimables (§6.18), centralisés pour l'impression navigateur (PDF) et les
 * pièces jointes des e-mails : factures A4 et tickets 80 mm, rapport Z… Chaque document porte
 * numéro, date-heure, code utilisateur, « DUPLICATA » en réimpression, « ANNULÉ » si annulé.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
    private readonly ledger: LedgerService,
  ) {}

  private async establishment(): Promise<Establishment> {
    const settings = await this.settings.all();
    let logo: string | null = null;
    const logoId = settings['establishment.logo_attachment_id'];
    if (logoId) {
      try {
        const file = await this.attachments.read(logoId);
        if (file.mime === 'image/png' || file.mime === 'image/jpeg')
          logo = `data:${file.mime};base64,${file.data.toString('base64')}`;
      } catch {
        logo = null;
      }
    }
    return { settings, logo };
  }

  private money(v: number | bigint | null | undefined, s: SettingsMap, currency = true): string {
    return formatMoney(num(v ?? 0), {
      currency: currency ? s['general.currency_code'] : '',
      decimals: s['general.currency_decimals'],
    });
  }

  private headerA4(e: Establishment, title: string, number: string, meta: string[]): unknown[] {
    const s = e.settings;
    const lines = [
      s['establishment.address'],
      [s['establishment.phone'] && `Tél. ${s['establishment.phone']}`, s['establishment.email']]
        .filter(Boolean)
        .join(' · '),
      [
        s['establishment.tax_id'] && `MF ${s['establishment.tax_id']}`,
        s['establishment.trade_register'] && `RC ${s['establishment.trade_register']}`,
      ]
        .filter(Boolean)
        .join(' · '),
    ].filter(Boolean);
    return [
      {
        columns: [
          {
            width: '*',
            stack: [
              ...(e.logo ? [{ image: e.logo, fit: [120, 50], margin: [0, 0, 0, 4] }] : []),
              { text: s['establishment.name'], bold: true, fontSize: 13, color: PRIMARY },
              ...lines.map((l) => ({ text: l, fontSize: 8, color: '#444' })),
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: title, bold: true, fontSize: 16 },
              { text: number, bold: true, fontSize: 11, margin: [0, 2, 0, 2] },
              ...meta.map((m) => ({ text: m, fontSize: 8, color: '#444' })),
            ],
          },
        ],
        margin: [0, 0, 0, 12],
      },
    ];
  }

  private footer(s: SettingsMap) {
    return (page: number, pages: number) => ({
      margin: [36, 0, 36, 0],
      columns: [
        {
          text: s['establishment.legal_footer'] || s['establishment.name'],
          fontSize: 7,
          color: '#666',
        },
        {
          text: `Page ${page} / ${pages}`,
          alignment: 'right',
          fontSize: 7,
          color: '#666',
          width: 60,
        },
      ],
    });
  }

  private watermark(cancelled: boolean, duplicate: boolean) {
    if (cancelled) return { text: 'ANNULÉE', color: '#dc2626', opacity: 0.18, bold: true };
    if (duplicate) return { text: 'DUPLICATA', color: '#64748b', opacity: 0.12, bold: true };
    return undefined;
  }

  // =========================================================================
  // Vente : facture A4 / ticket 80 mm
  // =========================================================================

  private async loadSale(saleId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        client: true,
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: {
              select: {
                name: true,
                dosage: true,
                form: true,
                internalCode: true,
                unitsPerPack: true,
                sellByUnit: true,
              },
            },
            allocations: { include: { lot: { select: { lotNumber: true, expiryDate: true } } } },
          },
        },
        allocations: { where: { cancelledAt: null }, include: { payment: true } },
        creditAllocs: {
          where: { cancelledAt: null },
          include: { creditNote: { select: { number: true } } },
        },
      },
    });
    if (!sale || !sale.number) throw new AppError('NOT_FOUND');
    const users = await this.prisma.user.findMany({
      where: { id: { in: [sale.validatedById, sale.createdById].filter((x): x is string => !!x) } },
      select: { id: true, code: true, fullName: true },
    });
    return { sale, validatedBy: users.find((u) => u.id === sale.validatedById) ?? null };
  }

  async salePdf(saleId: string, format: DocumentFormat, duplicate: boolean): Promise<Buffer> {
    const { sale, validatedBy } = await this.loadSale(saleId);
    const e = await this.establishment();
    const s = e.settings;
    const tz = s['general.timezone'];
    const cancelled = sale.status === 'CANCELLED';
    const m = (v: number | bigint | null | undefined, c = true) => this.money(v, s, c);
    const taxes =
      (sale.taxBreakdown as
        { tvaBp: number; totalHt: number; totalTva: number; totalTtc: number }[] | null) ?? [];
    const payments = [
      ...sale.allocations.map((a) => ({
        label: `${PAYMENT_METHODS[a.payment.method]} ${a.payment.number}${a.payment.chequeNumber ? ` — chèque n° ${a.payment.chequeNumber}` : ''}`,
        amount: a.amount,
      })),
      ...sale.creditAllocs.map((a) => ({
        label: `Avoir ${a.creditNote.number}`,
        amount: a.amount,
      })),
    ];
    const userLabel = validatedBy ? `${validatedBy.code}` : '';
    const lotText = (l: (typeof sale.lines)[number]) =>
      l.allocations
        .map(
          (a) =>
            `Lot ${a.lot.lotNumber} (exp. ${formatIsoDate(a.lot.expiryDate.toISOString().slice(0, 10))})`,
        )
        .join(', ');
    const qtyText = (l: (typeof sale.lines)[number]) => `${l.qty}${l.unit === 'UNIT' ? ' u' : ''}`;

    if (format === 'TICKET') {
      const content: unknown[] = [
        ...(e.logo
          ? [{ image: e.logo, fit: [120, 40], alignment: 'center', margin: [0, 0, 0, 4] }]
          : []),
        { text: s['establishment.name'], bold: true, alignment: 'center', fontSize: 10 },
        ...[
          s['establishment.address'],
          s['establishment.phone'] && `Tél. ${s['establishment.phone']}`,
          s['establishment.tax_id'] && `MF ${s['establishment.tax_id']}`,
        ]
          .filter(Boolean)
          .map((t) => ({ text: t, alignment: 'center', fontSize: 7 })),
        {
          text: cancelled ? '*** ANNULÉE ***' : duplicate ? '*** DUPLICATA ***' : '',
          alignment: 'center',
          bold: true,
          fontSize: 9,
          margin: [0, 4, 0, 0],
        },
        { text: `Facture ${sale.number}`, bold: true, fontSize: 9, margin: [0, 4, 0, 0] },
        { text: `${formatDateTime(sale.validatedAt, tz)} · ${userLabel}`, fontSize: 7 },
        { text: `Client : ${sale.client?.name ?? ''}`, fontSize: 7, margin: [0, 0, 0, 4] },
        {
          table: {
            widths: ['*', 'auto'],
            body: sale.lines.map((l) => [
              {
                stack: [
                  {
                    text: productLabel(l.product),
                    fontSize: 7.5,
                  },
                  {
                    text: `${qtyText(l)} × ${m(l.unitPriceTtc, false)}${l.discountBp ? ` − ${formatBp(l.discountBp)}` : ''}`,
                    fontSize: 6.5,
                    color: '#444',
                  },
                ],
              },
              { text: m(l.lineTotalTtc, false), fontSize: 7.5, alignment: 'right' },
            ]),
          },
          layout: 'noBorders',
        },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 2,
              x2: TICKET_WIDTH - 20,
              y2: 2,
              lineWidth: 0.5,
              dash: { length: 2 },
            },
          ],
        },
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              ...(num(sale.totalDiscount) > 0
                ? [
                    [
                      { text: 'Remises', fontSize: 7 },
                      { text: `−${m(sale.totalDiscount, false)}`, fontSize: 7, alignment: 'right' },
                    ],
                  ]
                : []),
              ...(num(sale.stampDuty) > 0
                ? [
                    [
                      { text: 'Timbre fiscal', fontSize: 7 },
                      { text: m(sale.stampDuty, false), fontSize: 7, alignment: 'right' },
                    ],
                  ]
                : []),
              [
                { text: 'TOTAL TTC', bold: true, fontSize: 10 },
                { text: m(sale.totalTtc), bold: true, fontSize: 10, alignment: 'right' },
              ],
              ...payments.map((p) => [
                { text: p.label, fontSize: 7 },
                { text: m(p.amount, false), fontSize: 7, alignment: 'right' },
              ]),
              ...(sale.cashTendered
                ? [
                    [
                      { text: 'Espèces remises', fontSize: 7 },
                      { text: m(sale.cashTendered, false), fontSize: 7, alignment: 'right' },
                    ],
                  ]
                : []),
              ...(sale.changeGiven
                ? [
                    [
                      { text: 'Rendu', fontSize: 7, bold: true },
                      {
                        text: m(sale.changeGiven, false),
                        fontSize: 7,
                        bold: true,
                        alignment: 'right',
                      },
                    ],
                  ]
                : []),
              ...(num(sale.amountDue) > 0
                ? [
                    [
                      { text: 'Reste à payer', bold: true, fontSize: 8 },
                      { text: m(sale.amountDue), bold: true, fontSize: 8, alignment: 'right' },
                    ],
                  ]
                : []),
            ],
          },
          layout: 'noBorders',
          margin: [0, 2, 0, 4],
        },
        ...taxes.map((t) => ({
          text: `TVA ${formatBp(t.tvaBp)} : HT ${m(t.totalHt, false)} · TVA ${m(t.totalTva, false)}`,
          fontSize: 6.5,
          color: '#444',
        })),
        { text: 'Merci de votre visite', alignment: 'center', fontSize: 8, margin: [0, 6, 0, 0] },
        ...(s['establishment.legal_footer']
          ? [
              {
                text: s['establishment.legal_footer'],
                alignment: 'center',
                fontSize: 6,
                color: '#555',
                margin: [0, 2, 0, 0],
              },
            ]
          : []),
      ];
      return renderPdf({
        pageSize: { width: TICKET_WIDTH, height: 'auto' },
        pageMargins: [10, 10, 10, 14],
        defaultStyle: { font: 'Roboto', fontSize: 8 },
        info: { title: `Ticket ${sale.number}`, author: s['establishment.name'] },
        content,
      });
    }

    const client = sale.client;
    const doc: DocDefinition = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 48],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      info: { title: `Facture ${sale.number}`, author: s['establishment.name'] },
      watermark: this.watermark(cancelled, duplicate),
      footer: this.footer(s),
      content: [
        ...this.headerA4(e, cancelled ? 'FACTURE ANNULÉE' : 'FACTURE', sale.number!, [
          `Date : ${formatDateTime(sale.validatedAt, tz)}`,
          `Utilisateur : ${userLabel}`,
          ...(duplicate ? ['DUPLICATA'] : []),
        ]),
        {
          columns: [
            {
              width: '*',
              table: {
                widths: ['*'],
                body: [
                  [
                    {
                      stack: [
                        { text: 'Client', fontSize: 7, color: '#666' },
                        { text: client?.name ?? '', bold: true },
                        ...[
                          client?.address,
                          client?.phone && `Tél. ${client.phone}`,
                          client?.nationalIdOrTaxId &&
                            `${client.type === 'INDIVIDUAL' ? 'CIN' : 'MF'} ${client.nationalIdOrTaxId}`,
                          client && `Code client : ${client.code}`,
                        ]
                          .filter(Boolean)
                          .map((t) => ({ text: t, fontSize: 8 })),
                      ],
                      margin: [4, 4, 4, 4],
                    },
                  ],
                ],
              },
              layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' },
            },
            { width: 20, text: '' },
            {
              width: 200,
              stack: [
                ...(sale.prescriberName
                  ? [{ text: `Prescripteur : ${sale.prescriberName}`, fontSize: 8 }]
                  : []),
                ...(sale.prescriptionRef
                  ? [
                      {
                        text: `Ordonnance n° ${sale.prescriptionRef}${sale.prescriptionDate ? ` du ${formatDate(sale.prescriptionDate, 'UTC')}` : ''}`,
                        fontSize: 8,
                      },
                    ]
                  : []),
                ...(sale.dueDate && num(sale.amountDue) > 0
                  ? [
                      {
                        text: `Échéance : ${formatDate(sale.dueDate, 'UTC')}`,
                        fontSize: 8,
                        bold: true,
                      },
                    ]
                  : []),
              ],
            },
          ],
          margin: [0, 0, 0, 12],
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', 32, 60, 40, 32, 64],
            body: [
              ['Désignation', 'Qté', 'PU TTC', 'Remise', 'TVA', 'Total TTC'].map((h, i) => ({
                text: h,
                bold: true,
                fontSize: 8,
                fillColor: '#e6f2f1',
                alignment: i === 0 ? 'left' : 'right',
              })),
              ...sale.lines.map((l) => [
                {
                  stack: [
                    {
                      text: productLabel(l.product),
                      fontSize: 8.5,
                    },
                    {
                      text: [l.product.internalCode, lotText(l)].filter(Boolean).join(' · '),
                      fontSize: 6.5,
                      color: '#666',
                    },
                  ],
                },
                { text: qtyText(l), alignment: 'right' },
                { text: m(l.unitPriceTtc, false), alignment: 'right' },
                { text: l.discountBp ? formatBp(l.discountBp) : '', alignment: 'right' },
                { text: formatBp(l.tvaRateBp), alignment: 'right' },
                { text: m(l.lineTotalTtc, false), alignment: 'right' },
              ]),
            ],
          },
          layout: {
            hLineColor: () => '#e5e7eb',
            vLineWidth: () => 0,
            paddingTop: () => 3,
            paddingBottom: () => 3,
          },
        },
        {
          columns: [
            {
              width: '*',
              stack: [
                {
                  table: {
                    widths: [50, 70, 60, 70],
                    body: [
                      ['Taux TVA', 'Base HT', 'TVA', 'TTC'].map((h) => ({
                        text: h,
                        bold: true,
                        fontSize: 7.5,
                        fillColor: '#f3f4f6',
                      })),
                      ...taxes.map((t) =>
                        [
                          formatBp(t.tvaBp),
                          m(t.totalHt, false),
                          m(t.totalTva, false),
                          m(t.totalTtc, false),
                        ].map((v) => ({ text: v, fontSize: 7.5 })),
                      ),
                    ],
                  },
                  layout: 'lightHorizontalLines',
                  margin: [0, 10, 0, 6],
                },
                {
                  text: `Arrêtée la présente facture à la somme de : ${amountInWords(num(sale.totalTtc), s['general.currency_name'])}.`,
                  fontSize: 8,
                  italics: true,
                },
              ],
            },
            {
              width: 200,
              table: {
                widths: ['*', 'auto'],
                body: [
                  ['Total HT', m(sale.subtotalHt)],
                  ['TVA', m(sale.totalTva)],
                  ...(num(sale.totalDiscount) > 0 ? [['Dont remises', m(sale.totalDiscount)]] : []),
                  ...(num(sale.stampDuty) > 0 ? [['Timbre fiscal', m(sale.stampDuty)]] : []),
                  [
                    { text: 'Total TTC', bold: true, fontSize: 11 },
                    { text: m(sale.totalTtc), bold: true, fontSize: 11 },
                  ],
                  ...payments.map((p) => [
                    { text: p.label, fontSize: 7.5 },
                    { text: m(p.amount), fontSize: 7.5 },
                  ]),
                  ['Déjà payé', m(sale.amountPaid)],
                  [
                    { text: 'Reste à payer', bold: true },
                    {
                      text: m(cancelled ? 0 : sale.amountDue),
                      bold: true,
                      color: num(sale.amountDue) > 0 && !cancelled ? '#b91c1c' : '#111',
                    },
                  ],
                ].map((row) =>
                  row.map((c, i) =>
                    typeof c === 'string'
                      ? { text: c, alignment: i === 1 ? 'right' : 'left' }
                      : { ...c, alignment: i === 1 ? 'right' : 'left' },
                  ),
                ),
              },
              layout: 'lightHorizontalLines',
              margin: [0, 10, 0, 0],
            },
          ],
        },
        ...(cancelled && sale.cancelReason
          ? [
              {
                text: `Facture annulée le ${formatDateTime(sale.cancelledAt, tz)} — motif : ${sale.cancelReason}`,
                color: '#b91c1c',
                margin: [0, 12, 0, 0],
              },
            ]
          : []),
      ],
    };
    return renderPdf(doc);
  }

  /** Impression / réimpression d'une facture : à partir de la 2e, « DUPLICATA » et trace au mouchard. */
  async printSale(saleId: string, format: DocumentFormat, actor: Actor): Promise<Buffer> {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: { number: true, printCount: true, status: true },
    });
    if (!sale?.number) throw new AppError('NOT_FOUND');
    const duplicate = sale.printCount > 0;
    if (duplicate && !actor.permissions.has('sales.reprint'))
      throw new AppError('FORBIDDEN', { permissions: ['sales.reprint'] });
    const pdf = await this.salePdf(saleId, format, duplicate);
    await this.prisma.tx(async (tx) => {
      await tx.sale.update({ where: { id: saleId }, data: { printCount: { increment: 1 } } });
      if (duplicate) {
        await this.audit.record(tx, {
          eventType: 'DOCUMENT_REPRINTED',
          actor,
          entityType: 'sale',
          entityId: saleId,
          entityRef: sale.number,
          summary: `Réimpression de la facture ${sale.number} (${format === 'TICKET' ? 'ticket' : 'A4'}) — ${sale.printCount + 1}e impression`,
        });
      }
    });
    return pdf;
  }

  // =========================================================================
  // Rapport de caisse (X / Z)
  // =========================================================================

  async cashReportPdf(sessionId: string, actor: Actor): Promise<Buffer> {
    const session = await this.prisma.cashSession.findUnique({
      where: { id: sessionId },
      include: { device: { select: { name: true } }, movements: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new AppError('NOT_FOUND');
    const summary = await this.cash.summary(sessionId);
    const e = await this.establishment();
    const s = e.settings;
    const tz = s['general.timezone'];
    const m = (v: number | bigint | null | undefined) => this.money(v, s);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [session.userId, session.closedById].filter((x): x is string => !!x) } },
      select: { id: true, code: true, fullName: true },
    });
    const opener = users.find((u) => u.id === session.userId);
    const closer = users.find((u) => u.id === session.closedById);
    const isZ = session.status === 'CLOSED';
    const rows: [string, string][] = [
      ['Poste', session.device.name],
      ['Ouverte le', `${formatDateTime(session.openedAt, tz)} par ${opener?.code ?? ''}`],
      ...(isZ
        ? ([
            ['Clôturée le', `${formatDateTime(session.closedAt, tz)} par ${closer?.code ?? ''}`],
          ] as [string, string][])
        : []),
      ['Ventes (nombre)', String(summary.salesCount)],
      ['Ventes (total TTC)', m(summary.salesTotal)],
      ['Ventes annulées', String(summary.cancelledCount)],
      ...summary.byMethod.map(
        (b) =>
          [
            `Encaissements ${PAYMENT_METHODS[b.method as keyof typeof PAYMENT_METHODS] ?? b.method} (${b.count})`,
            m(b.amount),
          ] as [string, string],
      ),
      ['Fond de caisse', m(summary.openingFloat)],
      ['Remboursements', m(summary.refunds)],
      ['Sorties (dépenses)', m(summary.expenses)],
      ['Apports', m(summary.deposits)],
      ['Retraits', m(summary.withdrawals)],
      ['Ouvertures du tiroir sans vente', String(summary.drawerOpenings)],
      ['Espèces théoriques', m(summary.expected)],
      ...(isZ
        ? ([
            ['Espèces comptées', m(session.countedAmount)],
            ['Écart', m(session.difference)],
          ] as [string, string][])
        : []),
    ];
    return renderPdf({
      pageSize: { width: TICKET_WIDTH, height: 'auto' },
      pageMargins: [10, 10, 10, 14],
      defaultStyle: { font: 'Roboto', fontSize: 8 },
      info: { title: `Rapport ${isZ ? 'Z' : 'X'} ${session.number}` },
      content: [
        { text: s['establishment.name'], bold: true, alignment: 'center' },
        {
          text: `RAPPORT ${isZ ? 'Z (clôture)' : 'X (intermédiaire)'}`,
          bold: true,
          alignment: 'center',
          margin: [0, 4, 0, 0],
        },
        { text: session.number, alignment: 'center', margin: [0, 0, 0, 6] },
        {
          table: {
            widths: ['*', 'auto'],
            body: rows.map(([a, b]) => [
              { text: a, fontSize: 7.5 },
              { text: b, fontSize: 7.5, alignment: 'right' },
            ]),
          },
          layout: 'lightHorizontalLines',
        },
        ...(isZ && Array.isArray(session.denominations)
          ? [
              { text: 'Détail du comptage', bold: true, margin: [0, 6, 0, 2] },
              {
                table: {
                  widths: ['*', 'auto', 'auto'],
                  body: (session.denominations as { value: number; count: number }[]).map((d) => [
                    { text: m(d.value), fontSize: 7 },
                    { text: `× ${d.count}`, fontSize: 7, alignment: 'right' },
                    { text: m(d.value * d.count), fontSize: 7, alignment: 'right' },
                  ]),
                },
                layout: 'noBorders',
              },
            ]
          : []),
        { text: 'Mouvements manuels', bold: true, margin: [0, 6, 0, 2] },
        ...session.movements
          .filter((mv) => ['EXPENSE', 'DEPOSIT', 'WITHDRAWAL', 'DRAWER_OPEN'].includes(mv.type))
          .map((mv) => ({
            text: `${formatDateTime(mv.createdAt, tz)} · ${CASH_MOVEMENT_TYPES[mv.type]} ${mv.type === 'DRAWER_OPEN' ? '' : m(mv.amount)} — ${mv.reason ?? ''}`,
            fontSize: 6.5,
          })),
        {
          text: `Édité le ${formatDateTime(now(), tz)} par ${actor.userCode}`,
          fontSize: 6.5,
          color: '#555',
          margin: [0, 8, 0, 0],
        },
      ],
    });
  }

  // =========================================================================
  // Rapports tabulaires (exports PDF : mouchard, états…)
  // =========================================================================

  /**
   * Document A4 générique du stock (bon de retour fournisseur, procès-verbal de destruction,
   * rapport d'inventaire…) : en-tête de l'établissement, informations, tableau, totaux,
   * remarques et cadres de signature.
   */
  async formPdf(
    doc: {
      title: string;
      number: string;
      meta: string[];
      info?: { label: string; value: string }[];
      columns: {
        key: string;
        header: string;
        width?: number | '*' | 'auto';
        align?: 'left' | 'right';
      }[];
      rows: Record<string, string | number | null>[];
      totals?: { label: string; value: string }[];
      notes?: string[];
      signatures?: string[];
      landscape?: boolean;
    },
    actor: Actor | null,
  ): Promise<Buffer> {
    const e = await this.establishment();
    const s = e.settings;
    const content: unknown[] = [
      ...this.headerA4(e, doc.title, doc.number, doc.meta),
      ...(doc.info && doc.info.length > 0
        ? [
            {
              table: {
                widths: [110, '*'],
                body: doc.info.map((i) => [
                  { text: i.label, bold: true, color: '#444' },
                  { text: i.value },
                ]),
              },
              layout: 'noBorders',
              margin: [0, 0, 0, 10],
            },
          ]
        : []),
      {
        table: {
          headerRows: 1,
          widths: doc.columns.map((c) => c.width ?? 'auto'),
          body: [
            doc.columns.map((c) => ({
              text: c.header,
              bold: true,
              fillColor: '#e6f2f1',
              alignment: c.align ?? 'left',
            })),
            ...doc.rows.map((r) =>
              doc.columns.map((c) => ({
                text: r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]),
                alignment: c.align ?? 'left',
              })),
            ),
          ],
        },
        layout: 'lightHorizontalLines',
      },
    ];
    if (doc.totals && doc.totals.length > 0) {
      content.push({
        table: {
          widths: ['*', 110],
          body: doc.totals.map((t) => [
            { text: t.label, alignment: 'right', bold: true },
            { text: t.value, alignment: 'right', bold: true },
          ]),
        },
        layout: 'noBorders',
        margin: [0, 8, 0, 0],
      });
    }
    for (const note of doc.notes ?? []) {
      content.push({ text: note, fontSize: 8, color: '#444', margin: [0, 8, 0, 0] });
    }
    if (doc.signatures && doc.signatures.length > 0) {
      content.push({
        columns: doc.signatures.map((label) => ({
          stack: [
            { text: label, bold: true, fontSize: 8 },
            { canvas: [{ type: 'rect', x: 0, y: 4, w: 150, h: 50, lineWidth: 0.5 }] },
          ],
        })),
        margin: [0, 24, 0, 0],
        unbreakable: true,
      });
    }
    content.push({
      text: `Édité le ${formatDateTime(now(), s['general.timezone'])}${actor ? ` par ${actor.userCode} — ${actor.userName}` : ''}`,
      fontSize: 7,
      color: '#666',
      margin: [0, 12, 0, 0],
    });
    return renderPdf({
      pageSize: 'A4',
      pageOrientation: doc.landscape ? 'landscape' : 'portrait',
      pageMargins: [36, 36, 36, 44],
      defaultStyle: { font: 'Roboto', fontSize: 8.5 },
      info: { title: `${doc.title} ${doc.number}`, author: s['establishment.name'] },
      footer: this.footer(s),
      content,
    });
  }

  /** Bon de commande fournisseur (A4). */
  async purchaseOrderPdf(orderId: string, actor: Actor | null): Promise<Buffer> {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: {
        supplier: true,
        lines: { orderBy: { lineNo: 'asc' }, include: { product: true } },
      },
    });
    if (!order) throw new AppError('NOT_FOUND');
    const creator = await this.prisma.user.findUnique({
      where: { id: order.createdById },
      select: { code: true },
    });
    const s = await this.settings.all();
    const m = (v: number | bigint) => this.money(v, s);
    return this.formPdf(
      {
        title: 'Bon de commande',
        number: order.number ?? 'BROUILLON',
        meta: [
          `Le ${formatDateTime(order.sentAt ?? order.createdAt, s['general.timezone'])} par ${creator?.code ?? ''}`,
          ...(order.status === 'CANCELLED' ? ['ANNULÉ'] : order.number ? [] : ['Non envoyé']),
        ],
        info: [
          { label: 'Fournisseur', value: `${order.supplier.name} (${order.supplier.code})` },
          ...(order.supplier.phone ? [{ label: 'Téléphone', value: order.supplier.phone }] : []),
          ...(order.supplier.email ? [{ label: 'E-mail', value: order.supplier.email }] : []),
          ...(order.expectedDate
            ? [
                {
                  label: 'Livraison souhaitée',
                  value: formatIsoDate(order.expectedDate.toISOString().slice(0, 10)),
                },
              ]
            : []),
          ...(order.notes ? [{ label: 'Remarques', value: order.notes }] : []),
        ],
        columns: [
          { key: 'code', header: 'Code', width: 50 },
          { key: 'product', header: 'Désignation', width: '*' },
          { key: 'qty', header: 'Quantité', align: 'right' },
          { key: 'unit', header: 'Prix HT estimé', align: 'right' },
          { key: 'total', header: 'Total HT', align: 'right' },
        ],
        rows: order.lines.map((l) => ({
          code: l.product.internalCode,
          product: productLabel(l.product),
          qty: l.qty,
          unit: m(l.unitPriceHt),
          total: m(l.lineTotalHt),
        })),
        totals: [{ label: 'Total HT estimé', value: m(order.totalHt) }],
        notes: ['Prix indicatifs : la facture du fournisseur fait foi à la réception.'],
        signatures: ['Pharmacie', 'Fournisseur (accusé de réception)'],
      },
      actor,
    );
  }

  /** Tableau A4 paysage avec en-tête de l'établissement ; l'export est tracé (DATA_EXPORTED). */
  async tablePdf(
    report: {
      title: string;
      subtitle?: string[];
      columns: {
        key: string;
        header: string;
        width?: number | '*' | 'auto';
        align?: 'left' | 'right';
      }[];
      rows: Record<string, string | number | null>[];
    },
    actor: Actor,
  ): Promise<Buffer> {
    const e = await this.establishment();
    const s = e.settings;
    const pdf = await renderPdf({
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [28, 28, 28, 36],
      defaultStyle: { font: 'Roboto', fontSize: 7.5 },
      info: { title: report.title, author: s['establishment.name'] },
      footer: this.footer(s),
      content: [
        { text: s['establishment.name'], bold: true, fontSize: 11, color: PRIMARY },
        { text: report.title, bold: true, fontSize: 13, margin: [0, 2, 0, 2] },
        ...(report.subtitle ?? []).map((t) => ({ text: t, fontSize: 8, color: '#444' })),
        {
          text: `Édité le ${formatDateTime(now(), s['general.timezone'])} par ${actor.userCode} — ${actor.userName}`,
          fontSize: 7,
          color: '#666',
          margin: [0, 0, 0, 8],
        },
        {
          table: {
            headerRows: 1,
            widths: report.columns.map((c) => c.width ?? 'auto'),
            body: [
              report.columns.map((c) => ({
                text: c.header,
                bold: true,
                fillColor: '#e6f2f1',
                alignment: c.align ?? 'left',
              })),
              ...report.rows.map((r) =>
                report.columns.map((c) => ({
                  text: r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]),
                  alignment: c.align ?? 'left',
                })),
              ),
            ],
          },
          layout: 'lightHorizontalLines',
        },
      ],
    });
    await this.audit.recordStandalone({
      eventType: 'DATA_EXPORTED',
      actor,
      entityType: 'export',
      summary: `Export PDF : ${report.title}${report.subtitle?.length ? ` (${report.subtitle.join(' ; ')})` : ''} — ${report.rows.length} ligne(s)`,
      notify: false,
    });
    return pdf;
  }

  // =========================================================================
  // Avoir / bon de retour, reçu de règlement, relevé de compte (§6.18)
  // =========================================================================

  private async loadReturn(returnId: string) {
    const ret = await this.prisma.customerReturn.findUnique({
      where: { id: returnId },
      include: {
        client: true,
        sale: { select: { id: true, number: true } },
        creditNote: {
          include: {
            allocations: {
              where: { cancelledAt: null },
              include: { sale: { select: { number: true } } },
            },
          },
        },
        lines: true,
      },
    });
    if (!ret) throw new AppError('NOT_FOUND');
    const products = await this.prisma.product.findMany({
      where: { id: { in: ret.lines.map((l) => l.productId) } },
      select: { id: true, name: true, dosage: true, unitsPerPack: true, sellByUnit: true },
    });
    const lots = await this.prisma.lot.findMany({
      where: { id: { in: ret.lines.map((l) => l.lotId) } },
      select: { id: true, lotNumber: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: ret.createdById },
      select: { code: true },
    });
    return { ret, products, lots, userCode: user?.code ?? '' };
  }

  /** Avoir `AV-` (ou bon de retour `RT-` pour le client comptoir), en A4 ou en ticket 80 mm. */
  async returnPdf(returnId: string, format: DocumentFormat, duplicate: boolean): Promise<Buffer> {
    const { ret, products, lots, userCode } = await this.loadReturn(returnId);
    const e = await this.establishment();
    const s = e.settings;
    const tz = s['general.timezone'];
    const m = (v: number | bigint | null | undefined, c = true) => this.money(v, s, c);
    const note = ret.creditNote;
    const title = note ? 'AVOIR' : 'BON DE RETOUR';
    const number = note?.number ?? ret.number;
    const applied = note?.allocations ?? [];
    const remaining = note ? num(note.remainingAmount) : 0;
    const cashRefund = ret.refundMode === 'CASH';
    const lineRows = ret.lines.map((l) => {
      const p = products.find((x) => x.id === l.productId);
      return {
        name: p ? productLabel(p) : '',
        lot: lots.find((x) => x.id === l.lotId)?.lotNumber ?? '',
        qty: p ? formatStockQty(l.qtyBase, p.unitsPerPack, p.sellByUnit) : String(l.qtyBase),
        state: l.resellable
          ? 'Revendable'
          : l.destination === 'DESTRUCTION'
            ? 'Détruit'
            : 'Quarantaine',
        amount: num(l.amount),
      };
    });
    const summary = [
      ...applied.map((a) => `Imputé sur la facture ${a.sale.number} : ${m(a.amount)}`),
      ...(cashRefund
        ? [`Remboursé en espèces`]
        : remaining > 0
          ? [`Crédit disponible sur le compte : ${m(remaining)}`]
          : []),
    ];

    if (format === 'TICKET') {
      return renderPdf({
        pageSize: { width: TICKET_WIDTH, height: 'auto' },
        pageMargins: [10, 10, 10, 14],
        defaultStyle: { font: 'Roboto', fontSize: 8 },
        info: { title: `${title} ${number}`, author: s['establishment.name'] },
        content: [
          { text: s['establishment.name'], bold: true, alignment: 'center', fontSize: 10 },
          {
            text: duplicate ? `*** DUPLICATA ***` : '',
            alignment: 'center',
            bold: true,
            fontSize: 9,
          },
          { text: `${title} ${number}`, bold: true, fontSize: 9, margin: [0, 4, 0, 0] },
          { text: `${formatDateTime(ret.createdAt, tz)} · ${userCode}`, fontSize: 7 },
          { text: `Client : ${ret.client.name}`, fontSize: 7 },
          ...(ret.sale
            ? [
                {
                  text: `Facture d’origine : ${ret.sale.number}`,
                  fontSize: 7,
                  margin: [0, 0, 0, 4],
                },
              ]
            : []),
          {
            table: {
              widths: ['*', 'auto'],
              body: lineRows.map((r) => [
                {
                  stack: [
                    { text: r.name, fontSize: 7.5 },
                    { text: `${r.qty} · lot ${r.lot} · ${r.state}`, fontSize: 6.5, color: '#444' },
                  ],
                },
                { text: m(r.amount, false), fontSize: 7.5, alignment: 'right' },
              ]),
            },
            layout: 'noBorders',
          },
          {
            canvas: [
              {
                type: 'line',
                x1: 0,
                y1: 2,
                x2: TICKET_WIDTH - 20,
                y2: 2,
                lineWidth: 0.5,
                dash: { length: 2 },
              },
            ],
          },
          {
            columns: [
              { text: `TOTAL ${note ? 'AVOIR' : 'REMBOURSÉ'}`, bold: true, fontSize: 10 },
              { text: m(ret.totalTtc), bold: true, fontSize: 10, alignment: 'right' },
            ],
            margin: [0, 2, 0, 2],
          },
          ...summary.map((t) => ({ text: t, fontSize: 7 })),
          { text: `Motif : ${ret.reason}`, fontSize: 6.5, color: '#444', margin: [0, 4, 0, 0] },
        ],
      });
    }

    return renderPdf({
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 48],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      info: { title: `${title} ${number}`, author: s['establishment.name'] },
      watermark: this.watermark(false, duplicate),
      footer: this.footer(s),
      content: [
        ...this.headerA4(e, title, number, [
          `Date : ${formatDateTime(ret.createdAt, tz)}`,
          `Utilisateur : ${userCode}`,
          ...(ret.sale ? [`Facture d’origine : ${ret.sale.number}`] : []),
          ...(duplicate ? ['DUPLICATA'] : []),
        ]),
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: [
                    { text: 'Client', fontSize: 7, color: '#666' },
                    { text: ret.client.name, bold: true },
                    ...[
                      ret.client.address,
                      ret.client.phone && `Tél. ${ret.client.phone}`,
                      `Code client : ${ret.client.code}`,
                    ]
                      .filter(Boolean)
                      .map((t) => ({ text: t, fontSize: 8 })),
                  ],
                  margin: [4, 4, 4, 4],
                },
              ],
            ],
          },
          layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' },
          margin: [0, 0, 0, 12],
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', 70, 50, 80, 70],
            body: [
              ['Désignation', 'Lot', 'Qté', 'État', 'Montant TTC'].map((h, i) => ({
                text: h,
                bold: true,
                fontSize: 8,
                fillColor: '#e6f2f1',
                alignment: i >= 2 && i !== 3 ? 'right' : 'left',
              })),
              ...lineRows.map((r) => [
                { text: r.name },
                { text: r.lot },
                { text: r.qty, alignment: 'right' },
                { text: r.state },
                { text: m(r.amount, false), alignment: 'right' },
              ]),
            ],
          },
          layout: {
            hLineColor: () => '#e5e7eb',
            vLineWidth: () => 0,
            paddingTop: () => 3,
            paddingBottom: () => 3,
          },
        },
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: `Motif du retour : ${ret.reason}`, fontSize: 8, margin: [0, 10, 0, 4] },
                {
                  text: `Arrêté le présent ${note ? 'avoir' : 'bon'} à la somme de : ${amountInWords(num(ret.totalTtc), s['general.currency_name'])}.`,
                  fontSize: 8,
                  italics: true,
                },
              ],
            },
            {
              width: 220,
              table: {
                widths: ['*', 'auto'],
                body: [
                  [
                    {
                      text: `Total ${note ? 'de l’avoir' : 'remboursé'}`,
                      bold: true,
                      fontSize: 11,
                    },
                    { text: m(ret.totalTtc), bold: true, fontSize: 11, alignment: 'right' },
                  ],
                  ...summary.map((t) => [{ text: t, fontSize: 8, colSpan: 2 }, {}]),
                ],
              },
              layout: 'lightHorizontalLines',
              margin: [0, 10, 0, 0],
            },
          ],
        },
      ],
    });
  }

  /** Impression / réimpression de l'avoir : DUPLICATA dès la 2e impression, tracé. */
  async printReturn(returnId: string, format: DocumentFormat, actor: Actor): Promise<Buffer> {
    const ret = await this.prisma.customerReturn.findUnique({
      where: { id: returnId },
      include: { creditNote: { select: { id: true, number: true, printCount: true } } },
    });
    if (!ret) throw new AppError('NOT_FOUND');
    const count = ret.creditNote?.printCount ?? 0;
    const duplicate = count > 0;
    if (duplicate && !actor.permissions.has('sales.reprint'))
      throw new AppError('FORBIDDEN', { permissions: ['sales.reprint'] });
    const pdf = await this.returnPdf(returnId, format, duplicate);
    await this.prisma.tx(async (tx) => {
      if (ret.creditNote)
        await tx.creditNote.update({
          where: { id: ret.creditNote.id },
          data: { printCount: { increment: 1 } },
        });
      if (duplicate) {
        await this.audit.record(tx, {
          eventType: 'DOCUMENT_REPRINTED',
          actor,
          entityType: 'return',
          entityId: returnId,
          entityRef: ret.creditNote?.number ?? ret.number,
          summary: `Réimpression de l’avoir ${ret.creditNote?.number ?? ret.number} (${format === 'TICKET' ? 'ticket' : 'A4'})`,
        });
      }
    });
    return pdf;
  }

  /** Reçu de règlement `REG-` : montant, mode, factures réglées, acompte. */
  async receiptPdf(paymentId: string, format: DocumentFormat, duplicate: boolean): Promise<Buffer> {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        client: true,
        allocations: {
          where: { cancelledAt: null },
          include: { sale: { select: { number: true } } },
        },
      },
    });
    if (!p) throw new AppError('NOT_FOUND');
    const user = await this.prisma.user.findUnique({
      where: { id: p.createdById },
      select: { code: true },
    });
    const e = await this.establishment();
    const s = e.settings;
    const tz = s['general.timezone'];
    const m = (v: number | bigint | null | undefined, c = true) => this.money(v, s, c);
    const allocated = p.allocations.reduce((a, x) => a + num(x.amount), 0);
    const unallocated = num(p.amount) - num(p.refundedAmount) - allocated;
    const cancelled = p.status !== 'VALID';
    const mode = [
      PAYMENT_METHODS[p.method],
      p.chequeNumber && `n° ${p.chequeNumber}`,
      p.bank,
      p.reference && `réf. ${p.reference}`,
      p.dueDate && `échéance ${formatIsoDate(p.dueDate.toISOString().slice(0, 10))}`,
    ]
      .filter(Boolean)
      .join(' · ');
    const rows: [string, string][] = [
      ['Client', p.client.name],
      ['Mode de règlement', mode],
      ...p.allocations.map((a) => [`Facture ${a.sale.number}`, m(a.amount)] as [string, string]),
      ...(unallocated > 0
        ? ([['Acompte (crédit sur le compte)', m(unallocated)]] as [string, string][])
        : []),
    ];
    const title = 'REÇU DE RÈGLEMENT';
    if (format === 'TICKET') {
      return renderPdf({
        pageSize: { width: TICKET_WIDTH, height: 'auto' },
        pageMargins: [10, 10, 10, 14],
        defaultStyle: { font: 'Roboto', fontSize: 8 },
        info: { title: `${title} ${p.number}`, author: s['establishment.name'] },
        content: [
          { text: s['establishment.name'], bold: true, alignment: 'center', fontSize: 10 },
          {
            text: cancelled ? '*** ANNULÉ ***' : duplicate ? '*** DUPLICATA ***' : '',
            alignment: 'center',
            bold: true,
            fontSize: 9,
          },
          { text: `${title} ${p.number}`, bold: true, fontSize: 9, margin: [0, 4, 0, 0] },
          {
            text: `${formatDateTime(p.paidAt, tz)} · ${user?.code ?? ''}`,
            fontSize: 7,
            margin: [0, 0, 0, 4],
          },
          {
            table: {
              widths: ['*', 'auto'],
              body: rows.map(([a, b]) => [
                { text: a, fontSize: 7.5 },
                { text: b, fontSize: 7.5, alignment: 'right' },
              ]),
            },
            layout: 'noBorders',
          },
          {
            columns: [
              { text: 'MONTANT REÇU', bold: true, fontSize: 10 },
              { text: m(p.amount), bold: true, fontSize: 10, alignment: 'right' },
            ],
            margin: [0, 4, 0, 2],
          },
          { text: `Solde du compte : ${m(p.client.balance)}`, fontSize: 7 },
        ],
      });
    }
    return renderPdf({
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 48],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      info: { title: `${title} ${p.number}`, author: s['establishment.name'] },
      watermark: this.watermark(cancelled, duplicate),
      footer: this.footer(s),
      content: [
        ...this.headerA4(e, cancelled ? 'REÇU ANNULÉ' : title, p.number, [
          `Date : ${formatDateTime(p.paidAt, tz)}`,
          `Utilisateur : ${user?.code ?? ''}`,
          ...(duplicate ? ['DUPLICATA'] : []),
        ]),
        {
          table: {
            widths: [180, '*'],
            body: rows.map(([a, b]) => [
              { text: a, color: '#555' },
              { text: b, bold: a.startsWith('Facture') === false && a === 'Client' },
            ]),
          },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 12],
        },
        {
          columns: [
            {
              text: `Arrêté le présent reçu à la somme de : ${amountInWords(num(p.amount), s['general.currency_name'])}.`,
              italics: true,
              fontSize: 8,
              width: '*',
            },
            {
              text: `Montant reçu : ${m(p.amount)}`,
              bold: true,
              fontSize: 13,
              alignment: 'right',
              width: 220,
            },
          ],
        },
        {
          text: `Solde du compte après ce règlement : ${m(p.client.balance)}${num(p.client.balance) < 0 ? ' (crédit en votre faveur)' : ''}`,
          margin: [0, 12, 0, 0],
          fontSize: 9,
        },
        ...(cancelled && p.cancelReason
          ? [
              {
                text: `Règlement annulé le ${formatDateTime(p.cancelledAt, tz)} — motif : ${p.cancelReason}`,
                color: '#b91c1c',
                margin: [0, 10, 0, 0],
              },
            ]
          : []),
      ],
    });
  }

  async printReceipt(paymentId: string, format: DocumentFormat, actor: Actor): Promise<Buffer> {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { number: true, printCount: true },
    });
    if (!p) throw new AppError('NOT_FOUND');
    const duplicate = p.printCount > 0;
    if (duplicate && !actor.permissions.has('sales.reprint'))
      throw new AppError('FORBIDDEN', { permissions: ['sales.reprint'] });
    const pdf = await this.receiptPdf(paymentId, format, duplicate);
    await this.prisma.tx(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { printCount: { increment: 1 } } });
      if (duplicate) {
        await this.audit.record(tx, {
          eventType: 'DOCUMENT_REPRINTED',
          actor,
          entityType: 'payment',
          entityId: paymentId,
          entityRef: p.number,
          summary: `Réimpression du reçu de règlement ${p.number} (${format === 'TICKET' ? 'ticket' : 'A4'})`,
        });
      }
    });
    return pdf;
  }

  /** Relevé de compte (A4) : solde d'ouverture, mouvements, solde de clôture, factures ouvertes. */
  async statementPdf(clientId: string, from: string, to: string): Promise<Buffer> {
    const st = await this.ledger.statement(clientId, from, to);
    const e = await this.establishment();
    const s = e.settings;
    const tz = s['general.timezone'];
    const m = (v: number | bigint | null | undefined, c = true) => this.money(v, s, c);
    const open = await this.prisma.sale.findMany({
      where: { clientId, status: 'VALIDATED', amountDue: { gt: 0 } },
      orderBy: [{ validatedAt: 'asc' }],
      select: { number: true, validatedAt: true, dueDate: true, totalTtc: true, amountDue: true },
    });
    const right = (t: string, extra: Record<string, unknown> = {}) => ({
      text: t,
      alignment: 'right',
      ...extra,
    });
    return renderPdf({
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 48],
      defaultStyle: { font: 'Roboto', fontSize: 8.5 },
      info: { title: `Relevé de compte ${st.client.code}`, author: s['establishment.name'] },
      footer: this.footer(s),
      content: [
        ...this.headerA4(e, 'RELEVÉ DE COMPTE', st.client.code, [
          `Période : du ${formatIsoDate(from)} au ${formatIsoDate(to)}`,
          `Édité le ${formatDateTime(now(), tz)}`,
        ]),
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: [
                    { text: 'Client', fontSize: 7, color: '#666' },
                    { text: st.client.name, bold: true, fontSize: 10 },
                    ...[
                      st.client.address,
                      st.client.phone && `Tél. ${st.client.phone}`,
                      st.client.nationalIdOrTaxId && `CIN / MF ${st.client.nationalIdOrTaxId}`,
                    ]
                      .filter(Boolean)
                      .map((t) => ({ text: t, fontSize: 8 })),
                  ],
                  margin: [4, 4, 4, 4],
                },
              ],
            ],
          },
          layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' },
          margin: [0, 0, 0, 10],
        },
        {
          table: {
            headerRows: 1,
            widths: [52, 70, '*', 58, 58, 64],
            body: [
              ['Date', 'Pièce', 'Libellé', 'Débit', 'Crédit', 'Solde'].map((h, i) => ({
                text: h,
                bold: true,
                fillColor: '#e6f2f1',
                alignment: i >= 3 ? 'right' : 'left',
              })),
              [
                { text: '' },
                { text: '' },
                { text: 'Solde d’ouverture', italics: true },
                right(''),
                right(''),
                right(m(st.opening, false), { bold: true }),
              ],
              ...st.rows.map((r) => [
                { text: formatDate(r.date, tz) },
                { text: r.documentNumber ?? '' },
                { text: r.description ?? CLIENT_LEDGER_ENTRY_TYPES[r.entryType] },
                right(r.debit ? m(r.debit, false) : ''),
                right(r.credit ? m(r.credit, false) : ''),
                right(m(r.balance, false)),
              ]),
              [
                { text: '' },
                { text: '' },
                { text: 'Totaux de la période', bold: true },
                right(m(st.totalDebit, false), { bold: true }),
                right(m(st.totalCredit, false), { bold: true }),
                right(''),
              ],
              [
                { text: '' },
                { text: '' },
                { text: 'Solde de clôture', bold: true },
                right(''),
                right(''),
                right(m(st.closing, false), { bold: true, fontSize: 10 }),
              ],
            ],
          },
          layout: {
            hLineColor: () => '#e5e7eb',
            vLineWidth: () => 0,
            paddingTop: () => 2,
            paddingBottom: () => 2,
          },
        },
        {
          text:
            st.closing > 0
              ? `Solde à payer : ${m(st.closing)}`
              : st.closing < 0
                ? `Crédit en votre faveur : ${m(-st.closing)}`
                : 'Compte soldé',
          bold: true,
          fontSize: 11,
          margin: [0, 10, 0, 6],
          color: st.closing > 0 ? '#b91c1c' : '#111',
        },
        ...(open.length > 0
          ? [
              { text: 'Factures restant dues', bold: true, margin: [0, 6, 0, 3] },
              {
                table: {
                  headerRows: 1,
                  widths: ['*', 60, 60, 70, 70],
                  body: [
                    ['Facture', 'Date', 'Échéance', 'Total', 'Reste dû'].map((h, i) => ({
                      text: h,
                      bold: true,
                      fillColor: '#f3f4f6',
                      alignment: i >= 3 ? 'right' : 'left',
                    })),
                    ...open.map((o) => [
                      { text: o.number ?? '' },
                      { text: formatDate(o.validatedAt, tz) },
                      {
                        text: o.dueDate ? formatIsoDate(o.dueDate.toISOString().slice(0, 10)) : '',
                      },
                      right(m(o.totalTtc, false)),
                      right(m(o.amountDue, false)),
                    ]),
                  ],
                },
                layout: 'lightHorizontalLines',
              },
            ]
          : []),
      ],
    });
  }

  // =========================================================================
  // Pièces jointes d'e-mails
  // =========================================================================

  async pdfFor(
    entityType: string,
    entityId: string,
    params?: Record<string, unknown>,
  ): Promise<{ filename: string; content: Buffer }> {
    if (entityType === 'sale') {
      const sale = await this.prisma.sale.findUnique({
        where: { id: entityId },
        select: { number: true },
      });
      return {
        filename: `${sale?.number ?? 'facture'}.pdf`,
        content: await this.salePdf(entityId, 'A4', false),
      };
    }
    if (entityType === 'credit_note') {
      const note = await this.prisma.creditNote.findUnique({
        where: { id: entityId },
        select: { number: true, returnId: true },
      });
      if (!note?.returnId) throw new AppError('NOT_FOUND');
      return {
        filename: `${note.number}.pdf`,
        content: await this.returnPdf(note.returnId, 'A4', false),
      };
    }
    if (entityType === 'payment') {
      const payment = await this.prisma.payment.findUnique({
        where: { id: entityId },
        select: { number: true },
      });
      return {
        filename: `${payment?.number ?? 'recu'}.pdf`,
        content: await this.receiptPdf(entityId, 'A4', false),
      };
    }
    if (entityType === 'statement') {
      const from = String(params?.from ?? '');
      const to = String(params?.to ?? '');
      const client = await this.prisma.client.findUnique({
        where: { id: entityId },
        select: { code: true },
      });
      return {
        filename: `Releve-${client?.code ?? 'client'}-${from}-${to}.pdf`,
        content: await this.statementPdf(entityId, from, to),
      };
    }
    if (entityType === 'purchase_order') {
      const order = await this.prisma.purchaseOrder.findUnique({
        where: { id: entityId },
        select: { number: true },
      });
      return {
        filename: `${order?.number ?? 'bon-de-commande'}.pdf`,
        content: await this.purchaseOrderPdf(entityId, null),
      };
    }
    throw new AppError('NOT_FOUND', { entity: entityType });
  }

  /** Variables d'e-mail d'un document (aucun nom de médicament — confidentialité §6.19 C). */
  async emailVariables(
    entityType: string,
    entityId: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const s = await this.settings.all();
    const tz = s['general.timezone'];
    if (entityType === 'sale') {
      const sale = await this.prisma.sale.findUnique({
        where: { id: entityId },
        include: { client: true },
      });
      if (!sale) throw new AppError('NOT_FOUND');
      return {
        client: { nom: sale.client?.name ?? '' },
        document: {
          numero: sale.number,
          date: formatDate(sale.validatedAt, tz),
          montant: this.money(sale.totalTtc, s),
          reste_a_payer: this.money(sale.status === 'CANCELLED' ? 0 : sale.amountDue, s),
        },
      };
    }
    if (entityType === 'credit_note') {
      const note = await this.prisma.creditNote.findUnique({
        where: { id: entityId },
        include: { client: true },
      });
      if (!note) throw new AppError('NOT_FOUND');
      return {
        client: { nom: note.client.name },
        document: {
          numero: note.number,
          date: formatDate(note.createdAt, tz),
          montant: this.money(note.amount, s),
          reste_a_payer: this.money(note.remainingAmount, s),
        },
      };
    }
    if (entityType === 'payment') {
      const p = await this.prisma.payment.findUnique({
        where: { id: entityId },
        include: { client: true },
      });
      if (!p) throw new AppError('NOT_FOUND');
      return {
        client: { nom: p.client.name },
        document: {
          numero: p.number,
          date: formatDate(p.paidAt, tz),
          montant: this.money(p.amount, s),
          reste_a_payer: this.money(Math.max(0, num(p.client.balance)), s),
        },
      };
    }
    if (entityType === 'statement') {
      const from = String(params?.from ?? '');
      const to = String(params?.to ?? '');
      const st = await this.ledger.statement(entityId, from, to);
      return {
        client: { nom: st.client.name },
        document: {
          numero: `du ${formatIsoDate(from)} au ${formatIsoDate(to)}`,
          date: formatIsoDate(to),
          montant: this.money(st.closing, s),
          reste_a_payer: this.money(Math.max(0, st.closing), s),
        },
      };
    }
    if (entityType === 'purchase_order') {
      const order = await this.prisma.purchaseOrder.findUnique({
        where: { id: entityId },
        include: { supplier: true },
      });
      if (!order) throw new AppError('NOT_FOUND');
      return {
        client: { nom: order.supplier.name },
        document: {
          numero: order.number ?? '',
          date: formatDate(order.sentAt ?? order.createdAt, tz),
          montant: this.money(order.totalHt, s),
          reste_a_payer: '',
        },
      };
    }
    throw new AppError('NOT_FOUND', { entity: entityType });
  }

  /** Quantité affichée sur les documents. */
  qty(qtyBase: number, product: { unitsPerPack: number; sellByUnit: boolean }): string {
    return formatStockQty(qtyBase, product.unitsPerPack, product.sellByUnit);
  }
}
