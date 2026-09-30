/**
 * Exécute les scènes de capture : chaque scène pilote le vrai site comme le ferait un utilisateur
 * (préparateur ou administrateur) sur les données de démonstration, puis enregistre une image JPEG.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { Api, newDevice } from './client.mjs';
import { chromiumPath, SHOTS_DIR, USERS, WEB_URL } from './env.mjs';

const VIEWPORT = { width: 1280, height: 800 };
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

/** Attend que la page ait fini de charger ses données (plus de squelette, réseau calme). */
export async function settle(page, extra = 500) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page
    .waitForFunction(() => !document.querySelector('.animate-pulse'), null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(extra);
}

/** Pastilles numérotées (correspondant aux étapes du manuel) et cadres posés sur la page avant la capture. */
export async function mark(page, items) {
  for (const { target, n, box = true, at = 'tl' } of items) {
    const loc = typeof target === 'string' ? page.locator(target).first() : target.first();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const r = await loc.boundingBox().catch(() => null);
    if (!r) continue;
    await page.evaluate(
      ({ r, n, box, at }) => {
        const layer = document.body;
        if (box) {
          const b = document.createElement('div');
          b.className = '__docs-mark';
          Object.assign(b.style, {
            position: 'fixed',
            left: `${r.x - 4}px`,
            top: `${r.y - 4}px`,
            width: `${r.width + 8}px`,
            height: `${r.height + 8}px`,
            border: '2.5px solid #e11d48',
            borderRadius: '8px',
            zIndex: '99998',
            pointerEvents: 'none',
          });
          layer.appendChild(b);
        }
        if (n !== undefined) {
          const d = document.createElement('div');
          d.className = '__docs-mark';
          d.textContent = String(n);
          const x = at.includes('r') ? r.x + r.width - 4 : r.x - 14;
          const y = at.includes('b') ? r.y + r.height - 4 : r.y - 14;
          Object.assign(d.style, {
            position: 'fixed',
            left: `${Math.max(2, x)}px`,
            top: `${Math.max(2, y)}px`,
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: '#e11d48',
            color: '#fff',
            font: '700 14px/26px Inter Variable, system-ui, sans-serif',
            textAlign: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,.35)',
            zIndex: '99999',
            pointerEvents: 'none',
          });
          layer.appendChild(d);
        }
      },
      { r, n, box, at },
    );
  }
}

export const unmark = (page) =>
  page.evaluate(() => document.querySelectorAll('.__docs-mark').forEach((e) => e.remove()));

async function newPage(browser, role, { mobile = false, name } = {}) {
  const device = await newDevice(
    name ?? (mobile ? 'Téléphone de Karim' : role === 'ADMIN' ? 'Bureau' : 'Comptoir 1'),
  );
  const context = await browser.newContext({
    ...(mobile ? IPHONE : { viewport: VIEWPORT }),
    locale: 'fr-FR',
    timezoneId: 'Africa/Tunis',
  });
  await context.addInitScript((d) => {
    localStorage.setItem('pharmastock.device', JSON.stringify(d));
    // Pas de visite guidée ni de bandeau d'installation dans les captures (sauf scène dédiée).
    localStorage.setItem('pharmastock.tour.disabled', '1');
    localStorage.setItem('pharmastock.install-banner', String(Date.now() + 1e10));
  }, device);
  const page = await context.newPage();
  return { context, page, device };
}

export async function loginUi(page, role) {
  const u = USERS[role];
  await page.goto(WEB_URL + '/');
  await page.getByLabel('Identifiant').fill(u.username);
  await page.getByLabel('Mot de passe').fill(u.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByText(/^Bonjour/).waitFor();
  await settle(page, 300);
}

/**
 * @param {{ scenes: any[]; only?: string[] }} opts
 * @returns {Promise<{ done: string[]; failed: [string, string][] }>}
 */
export async function runShots({ scenes, only }) {
  await mkdir(SHOTS_DIR, { recursive: true });
  if (!only?.length) {
    for (const f of await readdir(SHOTS_DIR)) await rm(resolve(SHOTS_DIR, f));
  }
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ['--lang=fr-FR'],
  });
  const done = [];
  const failed = [];
  try {
    for (const role of ['PREPARER', 'ADMIN']) {
      const mine = scenes.filter(
        (s) => (s.roles ?? ['ADMIN']).includes(role) && (!only?.length || only.includes(s.id)),
      );
      if (mine.length === 0) continue;
      console.log(`\n== Rôle ${role} (${mine.length} scènes)`);
      const { context, page } = await newPage(browser, role);
      const api = await Api.login(role, role === 'ADMIN' ? 'Bureau 2' : 'Réserve');
      let loggedIn = false;
      /** Contexte d'une scène : la page pilotée, l'API du rôle et l'enregistrement des captures. */
      const makeCtx = (scene, pageOfScene) => ({
        role,
        page: pageOfScene,
        api,
        goto: async (path, ready, extra) => {
          await pageOfScene.goto(WEB_URL + path);
          if (ready) await ready(pageOfScene);
          await settle(pageOfScene, extra);
        },
        async shot(name = scene.id, opts = {}) {
          const target = opts.page ?? pageOfScene;
          await unmark(target);
          if (opts.marks) await mark(target, opts.marks);
          const file = resolve(SHOTS_DIR, `${name}.${role}.jpg`);
          const options = { type: 'jpeg', quality: 74, path: file };
          if (opts.element) await opts.element.screenshot(options);
          else await target.screenshot({ ...options, ...(opts.clip ? { clip: opts.clip } : {}) });
          await unmark(target);
          done.push(`${name}.${role}`);
        },
      });
      for (const scene of mine) {
        try {
          if (scene.anonymous || scene.mobile) {
            const extra = await newPage(browser, role, {
              mobile: Boolean(scene.mobile),
              name: scene.anonymous ? 'Comptoir 2' : undefined,
            });
            try {
              if (scene.mobile) await loginUi(extra.page, role);
              await scene.run(makeCtx(scene, extra.page));
            } finally {
              await extra.context.close();
            }
          } else {
            if (!loggedIn) {
              await loginUi(page, role);
              loggedIn = true;
            }
            await scene.run(makeCtx(scene, page));
          }
          console.log(`  ✓ ${scene.id}`);
        } catch (e) {
          const msg = String(e?.message ?? e)
            .split('\n')[0]
            .slice(0, 200);
          failed.push([`${scene.id}.${role}`, msg]);
          console.log(`  ✗ ${scene.id} — ${msg}`);
          await writeFile(
            resolve(SHOTS_DIR, `_fail-${scene.id}.${role}.txt`),
            String(e?.stack ?? e),
          );
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { done, failed };
}
