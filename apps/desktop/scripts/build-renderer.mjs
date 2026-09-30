/**
 * Construit le site (apps/web) et le copie dans `renderer/` : l'application de bureau charge ce build
 * LOCAL, jamais une adresse distante. Les appels d'API passent par le relais du processus principal.
 */
import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

execFileSync('pnpm', ['--filter', '@pharmastock/shared', 'build'], { cwd: root, stdio: 'inherit' });
execFileSync('pnpm', ['--filter', '@pharmastock/web', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

const target = resolve(here, '../renderer');
await rm(target, { recursive: true, force: true });
await cp(resolve(root, 'apps/web/dist'), target, { recursive: true });
console.log('Site copié dans apps/desktop/renderer');
