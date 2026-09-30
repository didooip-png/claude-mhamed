/**
 * Génère les icônes de l'application (PWA, iOS, favicon) à partir de `public/icon.svg`
 * avec Chromium (aucune dépendance graphique supplémentaire).
 *   node scripts/make-icons.mjs          (variable CHROMIUM_PATH pour un Chromium précis)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public');
mkdirSync(out, { recursive: true });

const TEAL = '#0f766e';
const CROSS = 'M27 14h10v13h13v10H37v13H27V37H14V27h13z';

/** Icône « any » : coins arrondis, fond transparent autour. */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${TEAL}"/><path d="${CROSS}" fill="#fff"/></svg>`;
/** Icône « maskable » / iOS : fond plein (le système applique son propre masque), croix dans la zone sûre. */
const full = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${TEAL}"/><path transform="translate(32 32) scale(${scale}) translate(-32 -32)" d="${CROSS}" fill="#fff"/></svg>`;

const targets = [
  { file: 'icon-192.png', size: 192, svg: rounded, transparent: true },
  { file: 'icon-512.png', size: 512, svg: rounded, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, svg: full(0.85), transparent: false },
  { file: 'apple-touch-icon.png', size: 180, svg: full(1), transparent: false },
  { file: 'favicon-32.png', size: 32, svg: rounded, transparent: true },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${t.svg}`,
    );
    await page.screenshot({ path: resolve(out, t.file), omitBackground: t.transparent });
    await page.close();
    process.stdout.write(`✓ ${t.file}\n`);
  }
} finally {
  await browser.close();
}
