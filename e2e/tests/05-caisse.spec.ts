import { expect, test } from '@playwright/test';
import { Api, sql, uniq } from '../support/api.js';
import { createClient, createProduct, createRefs, inMonths, receive } from '../support/data.js';
import { openCash, sellCash } from '../support/flows.js';
import { login, withDevice } from '../support/ui.js';

/**
 * Scénario 5 — Ouverture de caisse → ventes en espèces → clôture à l'aveugle → écart calculé.
 */
test('5 — caisse : ouverture, ventes en espèces, clôture à l’aveugle, écart', async ({
  browser,
}) => {
  const admin = await Api.login('admin');
  const refs = await createRefs(admin);
  const product = await createProduct(admin, refs);
  await receive(admin, refs, [
    { productId: product.id, lotNumber: 'LOT-K1', expiryDate: inMonths(18), qty: 30 },
  ]);
  const client = await createClient(admin);

  const deviceName = `Comptoir 5 ${uniq('D')}`;
  const context = await browser.newContext();
  await withDevice(context, deviceName);
  const page = await context.newPage();
  await login(page, 'pre01');

  // Ouverture avec un fond de caisse de 100 DT, puis deux ventes en espèces : 2,350 + 7,050 DT.
  await openCash(page, '100');
  await sellCash(page, {
    client: client.name,
    lines: [{ search: product.name, qty: 1 }],
    tendered: '5',
  });
  await sellCash(page, {
    client: client.name,
    lines: [{ search: product.name, qty: 3 }],
    tendered: '10',
  });

  // Clôture à l'aveugle : le préparateur compte 109,200 DT sans jamais voir le montant théorique.
  await page.goto('/cash');
  await expect(page.getByText('Rapport X')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clôturer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toContainText('109,400'); // le montant attendu n'est jamais montré
  await dialog.getByLabel('Nombre de Billet 50 DT').fill('2');
  await dialog.getByLabel('Nombre de Billet / pièce 5 DT').fill('1');
  await dialog.getByLabel('Nombre de Pièce 2 DT').fill('2');
  await dialog.getByLabel('Nombre de Pièce 200 millimes').fill('1');
  await expect(dialog).toContainText('109,200');
  await dialog.getByRole('button', { name: 'Clôturer' }).click();
  await dialog.getByRole('button', { name: /Confirmer la clôture/ }).click();
  await expect(page.getByText(/clôturée\. Montant compté/)).toBeVisible();
  // Toujours à l'aveugle après la clôture : ni théorique ni écart pour le préparateur.
  await expect(page.getByText(/écart/i)).toHaveCount(0);

  // Le serveur a calculé l'écart : 109,200 compté − (100 + 2,350 + 7,050 = 109,400) attendu.
  const [session] = await sql<{
    expected_amount: string;
    counted_amount: string;
    difference: string;
    status: string;
  }>(
    `SELECT s.expected_amount, s.counted_amount, s.difference, s.status
       FROM cash_sessions s JOIN devices d ON d.id = s.device_id WHERE d.name = $1`,
    [deviceName],
  );
  expect(session).toEqual({
    status: 'CLOSED',
    expected_amount: '109400',
    counted_amount: '109200',
    difference: '-200',
  });

  // L'administrateur voit l'écart dans l'historique des sessions.
  const adminContext = await browser.newContext();
  await withDevice(adminContext, `Bureau ${uniq('D')}`);
  const adminPage = await adminContext.newPage();
  await login(adminPage, 'admin');
  await adminPage.goto('/cash');
  await adminPage.getByText('Historique des sessions').waitFor();
  const row = adminPage.locator('tbody tr', { hasText: deviceName }).first();
  await expect(row).toContainText('0,200');
  await context.close();
  await adminContext.close();
});
