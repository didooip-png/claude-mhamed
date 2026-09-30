/**
 * Générateur de la documentation utilisateur :
 *   pnpm docs:build                 tout (base de démonstration, captures, PDF)
 *   pnpm docs:build --shots-only    captures seulement
 *   pnpm docs:build --pdf-only      PDF seulement (à partir des captures en cache)
 *   pnpm docs:build --skip-stack    utilise une pile déjà lancée (DOCS_API_PORT, DOCS_WEB_PORT, DOCS_DATABASE_URL)
 *   pnpm docs:build --only=pos-cart,pos-payment   ne refait que ces scènes
 */
import { runShots } from './lib/shots.mjs';
import { buildScenes } from './lib/scenes.mjs';
import { prepareDatabase, startServers } from './lib/stack.mjs';
import { WEB_URL } from './lib/env.mjs';

const args = new Set(process.argv.slice(2));
const only = process.argv
  .slice(2)
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',')
  .filter(Boolean);

let failed = [];
if (!args.has('--pdf-only')) {
  let stop = () => {};
  if (!args.has('--skip-stack')) {
    await prepareDatabase();
    stop = await startServers();
  }
  try {
    const res = await runShots({ scenes: buildScenes(WEB_URL), only });
    failed = res.failed;
    console.log(`\nCaptures : ${res.done.length} réussies, ${res.failed.length} en échec`);
  } finally {
    stop();
  }
}
if (!args.has('--shots-only')) {
  const { renderAll } = await import('./lib/render.mjs');
  await renderAll({ strict: args.has('--strict') });
}
if (failed.length && args.has('--strict')) process.exit(1);
process.exit(0);
