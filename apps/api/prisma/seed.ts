/**
 * Données de démonstration — UNIQUEMENT en développement / recette (§16).
 * Mots de passe de démonstration documentés dans le README (jamais en production).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { enableSeedClock } from '../src/common/clock.js';
import { installBigIntJson } from '../src/common/json.js';
import { loadConfig } from '../src/config.js';
import { seedDemo } from './seed/demo.js';

installBigIntJson();
enableSeedClock();
process.env.DISABLE_SCHEDULER = 'true';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.isProduction && process.env.SEED_DEMO !== 'true') {
    throw new Error(
      'Seed de démonstration refusé en production (définir SEED_DEMO=true uniquement en recette).',
    );
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await seedDemo(app);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
