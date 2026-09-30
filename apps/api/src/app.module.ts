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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SecurityGuard },
    { provide: APP_INTERCEPTOR, useClass: OverrideAuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
