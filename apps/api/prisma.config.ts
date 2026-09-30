import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Charge apps/api/.env s'il existe (Node ≥ 22, sans dépendance à dotenv).
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import @swc-node/register/esm-register prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
