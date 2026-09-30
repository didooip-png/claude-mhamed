/**
 * Crée une migration à partir de la différence base de développement → schema.prisma,
 * en conservant les objets gérés à la main (index trigramme, index uniques partiels) que
 * Prisma ne sait pas représenter. Usage : pnpm --filter @pharmastock/api db:make-migration <nom>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const name = (process.argv[2] ?? '').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
if (!name) {
  console.error('Usage : make-migration <nom>');
  process.exit(1);
}
const MANUAL = [
  '_search_trgm',
  'cash_sessions_one_open_per_device',
  'clients_single_walk_in',
  'tva_rates_single_default',
];
const sql = execFileSync(
  'npx',
  [
    'prisma',
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
  ],
  {
    encoding: 'utf8',
  },
);
const blocks = sql
  .split(/\n(?=-- )/)
  .map((b) => b.trim())
  .filter((b) => b && !b.startsWith('Loaded Prisma config'))
  .filter((b) => !(b.startsWith('-- DropIndex') && MANUAL.some((m) => b.includes(m))));
if (blocks.length === 0 || blocks.every((b) => !/;/.test(b))) {
  process.stdout.write('Aucune différence : pas de migration créée.\n');
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const dir = `prisma/migrations/${stamp}_${name}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/migration.sql`, `${blocks.join('\n\n')}\n`);
process.stdout.write(`Migration créée : ${dir}\n`);
