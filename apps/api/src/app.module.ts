import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/exception.filter.js';
import { OverrideAuditInterceptor } from './common/override-audit.interceptor.js';
import { RequestContext } from './common/request-context.js';
import { SecurityGuard } from './common/security.guard.js';
import { loadConfig } from './config.js';
import { AttachmentsController } from './modules/attachments/attachments.controller.js';
import { AttachmentsService } from './modules/attachments/attachments.service.js';
import { AuditController } from './modules/audit/audit.controller.js';
import { CatalogImportService } from './modules/catalog/catalog-import.service.js';
import {
  CatalogReferencesController,
  ProductsController,
} from './modules/catalog/catalog.controller.js';
import { ProductsService } from './modules/catalog/products.service.js';
import { ReferencesService } from './modules/catalog/references.service.js';
import { ClientsController } from './modules/clients/clients.controller.js';
import { ClientsService } from './modules/clients/clients.service.js';
import { ReceiptsController } from './modules/receipts/receipts.controller.js';
import { ReceiptsService } from './modules/receipts/receipts.service.js';
import { StockQueriesService } from './modules/stock/stock-queries.service.js';
import { StockController } from './modules/stock/stock.controller.js';
import { StockService } from './modules/stock/stock.service.js';
import { SuppliersController } from './modules/suppliers/suppliers.controller.js';
import { SuppliersService } from './modules/suppliers/suppliers.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { CoreModule } from './modules/core.module.js';
import { DevicesController } from './modules/devices/devices.controller.js';
import { EventsModule } from './modules/events/events.module.js';
import { ExcelService } from './modules/exports/excel.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { RolesController } from './modules/roles/roles.controller.js';
import { RolesService } from './modules/roles/roles.service.js';
import { SettingsController } from './modules/settings/settings.controller.js';
import { UsersController } from './modules/users/users.controller.js';
import { UsersService } from './modules/users/users.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AccountsController } from './modules/accounts/accounts.controller.js';
import { LedgerService } from './modules/accounts/ledger.service.js';
import { CashController } from './modules/cash/cash.controller.js';
import { CashService } from './modules/cash/cash.service.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { EmailTemplatesService } from './modules/email/email-templates.service.js';
import { EmailController } from './modules/email/email.controller.js';
import { EmailOutboxService } from './modules/email/outbox.service.js';
import { SmtpService } from './modules/email/smtp.service.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { PaymentsController } from './modules/payments/payments.controller.js';
import { PaymentsCoreService } from './modules/payments/payments-core.service.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { ReturnsController } from './modules/returns/returns.controller.js';
import { ReturnsService } from './modules/returns/returns.service.js';
import { SalesQueriesService } from './modules/sales/sales-queries.service.js';
import { SalesController } from './modules/sales/sales.controller.js';
import { SalesService } from './modules/sales/sales.service.js';
import { DashboardController } from './modules/reports/dashboard.controller.js';
import { DashboardService } from './modules/reports/dashboard.service.js';
import { FinanceReportsService } from './modules/reports/finance-reports.service.js';
import { JournalsReportsService } from './modules/reports/journals-reports.service.js';
import { ReportExportService } from './modules/reports/report-export.service.js';
import { ReportsController } from './modules/reports/reports.controller.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { SalesReportsService } from './modules/reports/sales-reports.service.js';
import { StockReportsService } from './modules/reports/stock-reports.service.js';
import { JobsController } from './modules/jobs/jobs.controller.js';
import { JobsService } from './modules/jobs/jobs.service.js';
import { ActivityReportService } from './modules/notifications/activity-report.service.js';
import { DigestService } from './modules/notifications/digest.service.js';
import { PreferencesService } from './modules/notifications/preferences.service.js';
import { ReorderController } from './modules/stock/reorder.controller.js';
import { ReorderService } from './modules/stock/reorder.service.js';
import { AdjustmentsController } from './modules/adjustments/adjustments.controller.js';
import { AdjustmentsService } from './modules/adjustments/adjustments.service.js';
import { InventoryController } from './modules/inventory/inventory.controller.js';
import { InventoryService } from './modules/inventory/inventory.service.js';
import { RecallController } from './modules/stock/recall.controller.js';
import { RecallService } from './modules/stock/recall.service.js';
import { SupplierReturnsController } from './modules/supplier-returns/supplier-returns.controller.js';
import { SupplierReturnsService } from './modules/supplier-returns/supplier-returns.service.js';

const config = loadConfig();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.LOG_LEVEL,
        genReqId: () => RequestContext.get()?.requestId ?? 'n/a',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-device-token"]',
            'res.headers["set-cookie"]',
            '*.password',
            '*.pin',
            '*.newPassword',
            '*.currentPassword',
          ],
          censor: '[masqué]',
        },
        customProps: () => {
          const ctx = RequestContext.get();
          return { userCode: ctx?.user?.code, deviceId: ctx?.device?.id };
        },
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
        transport:
          config.isProduction || config.NODE_ENV === 'test'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
      skipIf: () => config.NODE_ENV === 'test',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    EventsModule,
    CoreModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    DevicesController,
    UsersController,
    RolesController,
    SettingsController,
    AuditController,
    AttachmentsController,
    ProductsController,
    CatalogReferencesController,
    SuppliersController,
    ClientsController,
    ReceiptsController,
    StockController,
    SalesController,
    CashController,
    EmailController,
    NotificationsController,
    ReturnsController,
    PaymentsController,
    AccountsController,
    InventoryController,
    AdjustmentsController,
    SupplierReturnsController,
    RecallController,
    ReorderController,
    JobsController,
    ReportsController,
    DashboardController,
  ],
  providers: [
    UsersService,
    RolesService,
    AttachmentsService,
    ExcelService,
    StockService,
    StockQueriesService,
    ProductsService,
    ReferencesService,
    CatalogImportService,
    SuppliersService,
    ClientsService,
    ReceiptsService,
    LedgerService,
    PaymentsCoreService,
    PaymentsService,
    ReturnsService,
    CashService,
    SalesService,
    SalesQueriesService,
    DocumentsService,
    SmtpService,
    EmailTemplatesService,
    EmailOutboxService,
    NotificationsService,
    InventoryService,
    AdjustmentsService,
    SupplierReturnsService,
    RecallService,
    ReorderService,
    ActivityReportService,
    PreferencesService,
    DigestService,
    JobsService,
    ReportsService,
    DashboardService,
    SalesReportsService,
    StockReportsService,
    FinanceReportsService,
    JournalsReportsService,
    ReportExportService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SecurityGuard },
    { provide: APP_INTERCEPTOR, useClass: OverrideAuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
