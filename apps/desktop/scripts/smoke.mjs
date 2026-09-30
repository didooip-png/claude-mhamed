/**
 * Vérification de bout en bout de l'application de bureau (sans l'installer) : lance Electron sur le
 * build local, enregistre le poste, ouvre une session, contrôle l'isolation et les réglages.
 *
 *   PHARMASTOCK_SERVER_URL=http://127.0.0.1:3000 SMOKE_USER=pre01 SMOKE_PASSWORD=Prep2026 pnpm --filter @pharmastock/desktop smoke
 *
 * Prérequis : `pnpm --filter @pharmastock/desktop build && … build:renderer`, un serveur PharmaStock joignable
 * avec le compte de démonstration. Sous Linux sans écran : préfixer par `xvfb-run -a`.
 */
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = process.env.PHARMASTOCK_SERVER_URL;
if (!server) throw new Error('Définir PHARMASTOCK_SERVER_URL (adresse du serveur de test).');
const user = process.env.SMOKE_USER ?? 'pre01';
const password = process.env.SMOKE_PASSWORD ?? 'Prep2026';
const bin = resolve(
  here,
  'node_modules/electron/dist',
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron',
);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(resolve(tmpdir(), 'pharmastock-smoke-'));
const app = await electron.launch({
  executablePath: bin,
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`, here],
  env: { ...process.env, PHARMASTOCK_SERVER_URL: server },
});
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Enregistrer ce poste' }).waitFor({ timeout: 30_000 });
  check(
    'le site local est chargé (app://pharmastock)',
    page.url().startsWith('app://pharmastock/'),
  );

  await page.getByLabel('Nom du poste').fill(`Smoke ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Enregistrer le poste' }).click();
  await page.getByLabel('Identifiant').fill(user);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByText(/^Bonjour/).waitFor({ timeout: 30_000 });
  check('connexion via le relais d’API', true);

  await page.reload();
  await page.getByText(/^Bonjour/).waitFor({ timeout: 30_000 });
  check('session conservée après rechargement (cookie de renouvellement relayé)', true);

  const iso = await page.evaluate(() => ({
    node: typeof require !== 'undefined' || typeof process !== 'undefined',
    bridge: Object.keys(window.pharmastockDesktop ?? {})
      .sort()
      .join(','),
    plainToken: localStorage.getItem('pharmastock.device'),
  }));
  check('aucun accès Node dans le site', !iso.node);
  check(
    'pont minimal exposé',
    iso.bridge === 'deviceStore,getDeviceInfo,openCashDrawer,openSettings,print,version',
    iso.bridge,
  );
  check('jeton du poste hors du stockage web', iso.plainToken === null);

  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(700);
  check('navigation externe bloquée', page.url().startsWith('app://pharmastock/'));
  const windows = app.windows().length;
  await page.evaluate(() => window.open('https://example.com/', '_blank'));
  await page.waitForTimeout(700);
  check('ouverture de fenêtre externe bloquée', app.windows().length === windows);

  await page.evaluate(() => window.pharmastockDesktop.openSettings());
  let settings;
  for (let i = 0; i < 40 && !settings; i++) {
    settings = app.windows().find((w) => w.url().includes('__desktop'));
    if (!settings) await new Promise((r) => setTimeout(r, 250));
  }
  check('fenêtre « Réglages du poste »', Boolean(settings));
  if (settings) {
    await settings.locator('#serverUrl').fill('http://pharmacie.exemple.tn');
    await settings.locator('#save').click();
    await settings.waitForTimeout(500);
    const msg = (await settings.locator('#message').textContent()) ?? '';
    check('adresse http:// sur Internet refusée', /https/.test(msg), msg);
  }
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
if (checks.some((ok) => !ok)) process.exit(1);
console.log('\nTout est bon.');
