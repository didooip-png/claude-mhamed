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
  // Pièces jointes d'e-mails
  // =========================================================================

  async pdfFor(
    entityType: string,
    entityId: string,
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
    throw new AppError('NOT_FOUND', { entity: entityType });
  }

  /** Variables d'e-mail d'un document (aucun nom de médicament — confidentialité §6.19 C). */
  async emailVariables(entityType: string, entityId: string): Promise<Record<string, unknown>> {
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
    throw new AppError('NOT_FOUND', { entity: entityType });
  }

  /** Quantité affichée sur les documents. */
  qty(qtyBase: number, product: { unitsPerPack: number; sellByUnit: boolean }): string {
    return formatStockQty(qtyBase, product.unitsPerPack, product.sellByUnit);
  }
}
