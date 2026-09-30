import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { applyTestEnv, TEST_DATABASE_URL } from './env.js';

/** Recrée le schéma de la base de test et applique toutes les migrations. */
export default async function setup(): Promise<void> {
  applyTestEnv();
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
