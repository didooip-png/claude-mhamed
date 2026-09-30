import { Injectable } from '@nestjs/common';
import { type ReportId, type ReportQuery, type ReportResult } from '@pharmastock/shared';
import { SettingsService } from '../settings/settings.service.js';
import { FinanceReportsService } from './finance-reports.service.js';
import { JournalsReportsService } from './journals-reports.service.js';
import { buildContext } from './report-helpers.js';
import { SalesReportsService } from './sales-reports.service.js';
import { StockReportsService } from './stock-reports.service.js';

/** Point d'entrée des rapports : choisit le calcul selon l'identifiant. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly sales: SalesReportsService,
    private readonly stock: StockReportsService,
    private readonly finance: FinanceReportsService,
    private readonly journals: JournalsReportsService,
  ) {}

  async run(id: ReportId, query: ReportQuery): Promise<ReportResult> {
    const ctx = buildContext(await this.settings.all(), query);
    switch (id) {
      case 'sales-summary':
        return this.sales.summary(ctx);
      case 'sales-by-user':
        return this.sales.breakdown(id, ctx, 'user', { order: 'ttc', limit: 100 });
      case 'sales-by-client':
        return this.sales.breakdown(id, ctx, 'client', { order: 'ttc', limit: 100 });
      case 'sales-by-category':
        return this.sales.breakdown(id, ctx, 'category', { order: 'ttc', limit: 100 });
      case 'sales-by-laboratory':
        return this.sales.breakdown(id, ctx, 'laboratory', { order: 'ttc', limit: 100 });
      case 'sales-by-payment':
        return this.sales.byPayment(ctx);
      case 'sales-heatmap':
        return this.sales.heatmap(ctx);
      case 'top-products':
        return this.sales.breakdown(id, ctx, 'product', { order: 'qty', limit: 50 });
      case 'abc':
        return this.sales.abc(ctx);
      case 'margins-by-product':
        return this.sales.breakdown(id, ctx, 'product', { order: 'margin', limit: 200 });
      case 'margins-by-category':
        return this.sales.breakdown(id, ctx, 'category', { order: 'margin', limit: 100 });
      case 'stock-valuation':
        return this.stock.valuation(ctx);
      case 'stock-rotation':
        return this.stock.rotation(ctx);
      case 'stock-dormant':
        return this.stock.dormant(ctx);
      case 'expiry-value':
        return this.stock.expiryValue(ctx);
      case 'stock-losses':
        return this.stock.losses(ctx);
      case 'purchases-by-supplier':
        return this.stock.purchasesBySupplier(ctx);
      case 'purchases-by-product':
        return this.stock.purchasesByProduct(ctx);
      case 'purchase-prices':
        return this.stock.purchasePrices(ctx);
      case 'returns-by-reason':
        return this.finance.returnsBy(ctx, 'reason');
      case 'returns-by-user':
        return this.finance.returnsBy(ctx, 'user');
      case 'returns-by-product':
        return this.finance.returnsBy(ctx, 'product');
      case 'cancellations-by-user':
        return this.finance.cancellationsByUser(ctx);
      case 'receivables-aging':
        return this.finance.aging(ctx);
      case 'top-debtors':
        return this.finance.topDebtors(ctx);
      case 'collections':
        return this.finance.collections(ctx);
      case 'cash-variances':
        return this.finance.cashVariances(ctx);
      case 'journal-sales':
        return this.journals.salesJournal(ctx);
      case 'journal-purchases':
        return this.journals.purchasesJournal(ctx);
      case 'journal-payments':
        return this.journals.paymentsJournal(ctx);
      case 'vat-summary':
        return this.journals.vatSummary(ctx);
      case 'controlled-register':
        return this.journals.controlledRegister(ctx);
      case 'lot-trace':
        return this.journals.lotTrace(ctx);
    }
  }
}
