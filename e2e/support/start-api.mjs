/**
 * Démarre l'API des tests E2E sur une base neuve : recrée `pharmastock_e2e`, applique les
 * migrations, amorce les comptes (ADM01, PRE01, PRE02), puis lance le serveur.
 */
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiDir = resolve(root, 'apps/api');
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://pharmastock:pharmastock@localhost:5432/pharmastock_e2e?schema=public';
const dbName = new URL(DATABASE_URL).pathname.slice(1);
if (!/e2e/i.test(dbName)) throw new Error(`Base E2E inattendue : ${dbName}`);

const admin = new pg.Client({
  connectionString: DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, '/postgres'),
});
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.end();

const env = {
  ...process.env,
  // « test » : mêmes comportements que le développement, sans limitation de débit (postes créés en rafale).
  NODE_ENV: 'test',
  DATABASE_URL,
  PORT: process.env.E2E_API_PORT ?? '3300',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef0123456789',
  APP_ENCRYPTION_KEY: '3'.repeat(64),
  APP_PUBLIC_URL: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? '5273'}`,
  STORAGE_DIR: resolve(apiDir, 'storage-e2e'),
  BACKUP_DIR: resolve(apiDir, 'storage-e2e/backups'),
  LOG_LEVEL: 'warn',
  DISABLE_SCHEDULER: 'false',
};
const run = (args, cwd = apiDir) =>
  execFileSync(args[0], args.slice(1), { cwd, env, stdio: 'inherit' });

run(['npx', 'prisma', 'migrate', 'deploy']);
run(['node', '--import', '@swc-node/register/esm-register', 'scripts/e2e-bootstrap.ts']);

const server = spawn('node', ['--import', '@swc-node/register/esm-register', 'src/main.ts'], {
  cwd: apiDir,
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
