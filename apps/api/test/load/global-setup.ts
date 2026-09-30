import { execFileSync } from 'node:child_process';
import pg from 'pg';

const LOAD_DATABASE_URL = process.env.TEST_DATABASE_URL!;

/** Crée (si besoin) et remet à zéro la base de charge, puis applique les migrations. */
export default async function setup(): Promise<void> {
  const url = new URL(LOAD_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/load/i.test(dbName)) throw new Error(`Base de charge inattendue : ${dbName}`);
  const admin = new pg.Client({
    connectionString: LOAD_DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, '/postgres'),
  });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const client = new pg.Client({ connectionString: LOAD_DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  // LOAD_REUSE=1 : conserve les données générées d'une exécution à l'autre (mise au point des index).
  const reuse = process.env.LOAD_REUSE === '1';
  if (!reuse) {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  }
  await client.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: LOAD_DATABASE_URL },
    stdio: 'pipe',
  });
}
