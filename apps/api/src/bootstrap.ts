import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { contextMiddleware } from './common/context.middleware.js';
import { installBigIntJson } from './common/json.js';
import { loadConfig } from './config.js';

installBigIntJson();

/** Crée l'application Nest configurée (utilisé par main.ts et les tests d'intégration). */
export async function createApp(options: { logger?: boolean } = {}): Promise<INestApplication> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: options.logger === false ? false : undefined,
  });
  if (options.logger !== false) app.useLogger(app.get(Logger));
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(contextMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api/v1');
  const origins = config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Device-Id',
        'X-Device-Token',
        'Idempotency-Key',
        'X-Background',
        'X-Request-Id',
      ],
    });
  }
  app.enableShutdownHooks();
  return app;
}
