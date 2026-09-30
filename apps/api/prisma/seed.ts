/**
 * Données de démonstration — UNIQUEMENT en développement / recette (§16).
 * Mots de passe de démonstration documentés dans le README (jamais en production).
 */
import 'reflect-metadata';

// Les tâches planifiées (envoi d'e-mails, notifications) ne doivent pas tourner pendant le seed :
// la variable est positionnée AVANT le chargement des modules (les imports statiques sont hissés).
process.env.DISABLE_SCHEDULER = 'true';

const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../src/app.module.js');
const { enableSeedClock } = await import('../src/common/clock.js');
const { installBigIntJson } = await import('../src/common/json.js');
const { loadConfig } = await import('../src/config.js');
const { seedDemo } = await import('./seed/demo.js');

installBigIntJson();
enableSeedClock();

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
