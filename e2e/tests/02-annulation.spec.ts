import { expect, test } from '@playwright/test';
import { Api, sql, uniq } from '../support/api.js';
import { createClient, createProduct, createRefs, inMonths, receive } from '../support/data.js';
import { openCash, sellCash } from '../support/flows.js';
import { login, withDevice } from '../support/ui.js';

/**
 * Scénario 2 — Préparateur : vente → tentative d'annulation refusée → l'administrateur annule →
 * l'entrée est visible au mouchard et le stock est réintégré dans les lots d'origine.
 */
test('2 — vente du préparateur, annulation refusée puis faite par l’administrateur', async ({
  browser,
}) => {
  const admin = await Api.login('admin');
  const refs = await createRefs(admin);
  const product = await createProduct(admin, refs);
  await receive(admin, refs, [
    { productId: product.id, lotNumber: 'LOT-A', expiryDate: inMonths(10), qty: 4 },
    { productId: product.id, lotNumber: 'LOT-B', expiryDate: inMonths(20), qty: 10 },
  ]);
  const client = await createClient(admin);
  const remaining = () =>
    sql<{ lot_number: string; remaining_qty: number }>(
      `SELECT lot_number, remaining_qty FROM lots WHERE product_id = $1 ORDER BY lot_number`,
      [product.id],
    );

  // --- Le préparateur vend 6 boîtes (4 du lot A puis 2 du lot B) --------------------------
  const prepContext = await browser.newContext();
  await withDevice(prepContext, `Comptoir 2 ${uniq('D')}`);
  const prep = await prepContext.newPage();
  await login(prep, 'pre01');
  await openCash(prep);
  const number = await sellCash(prep, {
    client: client.name,
    lines: [{ search: product.name, qty: 6 }],
  });
  expect(await remaining()).toEqual([
    { lot_number: 'LOT-A', remaining_qty: 0 },
    { lot_number: 'LOT-B', remaining_qty: 8 },
  ]);

  // --- Annulation refusée au préparateur -------------------------------------------------
  await prep.goto('/sales');
  await prep.getByText(number).first().click();
  await expect(prep.getByRole('heading', { name: new RegExp(number) })).toBeVisible();
  await expect(prep.getByRole('button', { name: 'Annuler la vente' })).toHaveCount(0);
  // Même en contournant l'interface : l'API refuse (403) et rien ne change.
  const prepApi = await Api.login('pre01');
  const sale = await sql<{ id: string }>(`SELECT id FROM sales WHERE number = $1`, [number]);
  await expect(
    prepApi.post(`/sales/${sale[0]!.id}/cancel`, {
      reasonCode: 'CUSTOMER_REQUEST',
      reason: 'Tentative du préparateur',
      refundMode: 'CREDIT',
    }),
  ).rejects.toThrow(/403/);
  expect((await sql(`SELECT status FROM sales WHERE number = $1`, [number]))[0]).toEqual({
    status: 'VALIDATED',
  });

  // --- L'administrateur annule ---------------------------------------------------------------
  const adminContext = await browser.newContext();
  await withDevice(adminContext, `Bureau ${uniq('D')}`);
  const page = await adminContext.newPage();
  await login(page, 'admin');
  await page.goto('/sales');
  await page.getByText(number).first().click();
  await page.getByRole('button', { name: 'Annuler la vente' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motif', { exact: true }).selectOption({ index: 0 });
  await dialog.getByLabel('Précisions sur le motif').fill('Erreur de saisie de la quantité');
  await dialog.getByRole('button', { name: 'Annuler la vente' }).click();
  await expect(page.getByText('Vente annulée').first()).toBeVisible();

  // Stock réintégré dans les lots d'origine.
  expect(await remaining()).toEqual([
    { lot_number: 'LOT-A', remaining_qty: 4 },
    { lot_number: 'LOT-B', remaining_qty: 10 },
  ]);

  // --- Visible au mouchard ----------------------------------------------------------------------
  await page.goto('/audit');
  await expect(page.getByText('Journal infalsifiable')).toBeVisible();
  await page
    .getByPlaceholder(/Rechercher/)
    .first()
    .fill(number)
    .catch(() => undefined);
  await expect(
    page.getByText(new RegExp(`Vente ${number}.*annulée|${number}`)).first(),
  ).toBeVisible();
  const events = await sql<{ event_type: string; user_code: string }>(
    `SELECT event_type, user_code FROM audit_logs WHERE entity_ref = $1 ORDER BY id`,
    [number],
  );
  expect(events.map((e) => e.event_type)).toContain('SALE_CANCELLED');
  expect(events.find((e) => e.event_type === 'SALE_CANCELLED')!.user_code).toBe('ADM01');

  await prepContext.close();
  await adminContext.close();
});
