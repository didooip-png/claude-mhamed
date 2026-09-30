/**
 * Compile l'application de bureau : processus principal, préchargements (CommonJS, obligatoire en
 * mode « sandbox ») et écran des réglages du poste, dans `dist/`.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  // Restent des dépendances d'exécution : electron-builder les embarque (pdf-to-printer contient SumatraPDF).
  external: ['electron', 'electron-updater', 'pdf-to-printer'],
});
for (const name of ['preload', 'settings-preload']) {
  await build({
    ...common,
    entryPoints: [`src/${name}.ts`],
    outfile: `dist/${name}.cjs`,
    external: ['electron'],
  });
}
await cp('src/desktop-ui', 'dist/desktop-ui', { recursive: true });
console.log('Application de bureau compilée dans dist/');
