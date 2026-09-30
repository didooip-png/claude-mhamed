/**
 * Pile de démonstration dédiée aux captures : base `pharmastock_docs` recréée puis amorcée avec les
 * données de démonstration, API et site lancés sur des ports à part. Jamais la base de développement.
 */
import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  API_PORT,
  API_URL,
  DATABASE_URL,
  ROOT,
  SINK_HTTP_PORT,
  SMTP_SINK_PORT,
  WEB_PORT,
  WEB_URL,
} from './env.mjs';

const apiDir = resolve(ROOT, 'apps/api');
const dbName = new URL(DATABASE_URL).pathname.slice(1);

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL,
  PORT: API_PORT,
  JWT_ACCESS_SECRET: 'docs-access-secret-0123456789abcdef0123456789',
  APP_ENCRYPTION_KEY: '5'.repeat(64),
  APP_PUBLIC_URL: WEB_URL,
  STORAGE_DIR: resolve(apiDir, 'storage-docs'),
  BACKUP_DIR: resolve(apiDir, 'storage-docs/backups'),
  LOG_LEVEL: 'warn',
  // Le seed pose lui-même DISABLE_SCHEDULER ; l'API, elle, exécute la file d'e-mails.
  DISABLE_SCHEDULER: 'false',
};

async function waitFor(url, label, timeoutMs = 240_000) {
  const start = Date.now();
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* pas encore prêt */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`${label} ne répond pas (${url})`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function recreateDatabase() {
  if (!/docs/i.test(dbName)) throw new Error(`Base de captures inattendue : ${dbName}`);
  const admin = new pg.Client({
    connectionString: DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, '/postgres'),
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
}

/** Recrée la base, applique les migrations, charge les données de démonstration. */
export async function prepareDatabase() {
  console.log('• Base de démonstration : recréation, migrations, données');
  await recreateDatabase();
  const run = (args) =>
    execFileSync(args[0], args.slice(1), { cwd: apiDir, env, stdio: 'inherit' });
  run(['npx', 'prisma', 'migrate', 'deploy']);
  run(['node', '--import', '@swc-node/register/esm-register', 'prisma/seed.ts']);
}

/** Lance l'API et le site ; renvoie une fonction d'arrêt. */
export async function startServers() {
  console.log('• Démarrage de l’API et du site');
  const api = spawn('node', ['--import', '@swc-node/register/esm-register', 'src/main.ts'], {
    cwd: apiDir,
    env,
    stdio: 'inherit',
  });
  const web = spawn(
    'pnpm',
    [
      '--filter',
      '@pharmastock/web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      WEB_PORT,
      '--strictPort',
    ],
    {
      cwd: ROOT,
      env: { ...env, VITE_API_PROXY: `http://127.0.0.1:${API_PORT}` },
      stdio: 'inherit',
    },
  );
  // Boîte de capture d'e-mails (rôle de Mailpit) : l'écran « Journal des e-mails » a ainsi du contenu réel.
  const sink = spawn('node', ['support/mail-sink.mjs'], {
    cwd: resolve(ROOT, 'e2e'),
    env: { ...process.env, SMTP_PORT: SMTP_SINK_PORT, HTTP_PORT: SINK_HTTP_PORT },
    stdio: 'inherit',
  });
  const stop = () => {
    for (const p of [api, web, sink]) if (!p.killed) p.kill('SIGTERM');
  };
  process.on('exit', stop);
  await waitFor(`${API_URL}/health`, 'API');
  await waitFor(WEB_URL, 'Site');
  await waitFor(`http://127.0.0.1:${SINK_HTTP_PORT}/health`, 'Boîte e-mail');
  return stop;
}
