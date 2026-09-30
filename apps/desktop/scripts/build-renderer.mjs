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

// Sous Windows, « pnpm » est un script .cmd : il faut passer par un interpréteur de commandes.
const pnpm = (...args) =>
  execFileSync('pnpm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

pnpm('--filter', '@pharmastock/shared', 'build');
pnpm('--filter', '@pharmastock/web', 'build');

const target = resolve(here, '../renderer');
await rm(target, { recursive: true, force: true });
await cp(resolve(root, 'apps/web/dist'), target, { recursive: true });
console.log('Site copié dans apps/desktop/renderer');
