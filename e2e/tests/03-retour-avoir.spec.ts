import { expect, test } from '@playwright/test';
import { Api, sql, uniq } from '../support/api.js';
import { createClient, createProduct, createRefs, inMonths, receive } from '../support/data.js';
import { openCash, sellCash } from '../support/flows.js';
import { login, pickFirst, withDevice } from '../support/ui.js';

/**
 * Scénario 3 — Retour client → avoir → nouvel achat payé avec l'avoir → solde client correct.
 * (Convention : solde > 0 = le client doit ; solde < 0 = crédit en sa faveur.)
 */
test('3 — retour client, avoir, achat payé avec l’avoir, solde exact', async ({ browser }) => {
  const admin = await Api.login('admin');
  const refs = await createRefs(admin);
  const product = await createProduct(admin, refs);
  await receive(admin, refs, [
    { productId: product.id, lotNumber: 'LOT-R1', expiryDate: inMonths(18), qty: 20 },
  ]);
  const client = await createClient(admin);
  const balance = async () =>
    Number(
      (await sql<{ balance: string }>(`SELECT balance FROM clients WHERE id = $1`, [client.id]))[0]!
        .balance,
    );

  const context = await browser.newContext();
  await withDevice(context, `Comptoir 3 ${uniq('D')}`);
  const page = await context.newPage();
  await login(page, 'pre01');
  await openCash(page);

  // Vente initiale : 2 boîtes à 2,350 DT = 4,700 DT payés en espèces.
  const original = await sellCash(page, {
    client: client.name,
    lines: [{ search: product.name, qty: 2 }],
  });
  expect(await balance()).toBe(0);

  // Retour d'une boîte, remboursée en avoir.
  await page.goto('/returns/new');
  await page.getByLabel('Rechercher la vente d’origine').fill(original);
  await page.getByRole('button', { name: new RegExp(original) }).click();
  await page.getByLabel(/^Quantité retournée, lot LOT-R1/).fill('1');
  await page.getByLabel('Motif du retour').fill('Produit non utilisé, emballage intact');
  await expect(page.getByTestId('return-total')).toContainText('2,350');
  await page.getByRole('button', { name: 'Enregistrer le retour' }).click();
  // Un retour client exige l'autorisation d'un administrateur (code, PIN et motif tracés au mouchard).
  await page.getByRole('heading', { name: /Autorisation administrateur/ }).waitFor();
  const override = page.getByRole('dialog');
  await override.getByLabel('Code administrateur').fill('ADM01');
  await override.getByLabel('PIN').fill('1234');
  await override.getByLabel('Motif').fill('Retour accepté : emballage intact');
  await override.getByRole('button', { name: 'Autoriser' }).click();
  await page.waitForURL(/\/returns\/[0-9a-f-]{36}$/); // fiche du retour créé
  await expect(page.getByText(/AV-\d{4}-\d{6}/).first()).toBeVisible();
  expect(await balance()).toBe(-2350); // 2,350 DT de crédit en faveur du client

  // Nouvel achat de 2 boîtes (4,700 DT) : 2,350 DT par l'avoir + 2,350 DT en espèces.
  await page.goto('/pos');
  await page.getByLabel('Rechercher un client').fill(client.name);
  await page.getByRole('listbox').getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Crédit disponible')).toBeVisible();
  await pickFirst(
    page,
    page.getByPlaceholder('Scanner ou rechercher un produit (F2)…'),
    product.name,
  );
  const qty = page.getByLabel(/^Quantité de /).first();
  await qty.fill('2');
  await Promise.all([
    page.waitForResponse(
      (r) => /\/sales\/[^/]+\/lines\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
    ),
    qty.press('Enter'),
  ]);
  await page.keyboard.press('F9');
  await page.getByRole('heading', { name: 'Paiement' }).waitFor();
  await page.getByLabel('Document à imprimer').selectOption('NONE');
  await page.getByLabel('Montant du crédit utilisé').fill('2,350');
  await page.getByLabel('Montant remis').fill('2,350');
  await page.keyboard.press('F10');
  const second = await page
    .getByRole('link', { name: /FAC-\d{4}-\d{6}/ })
    .first()
    .textContent();
  expect(second!.trim()).not.toBe(original);

  // Le crédit est entièrement consommé : solde nul, facture soldée.
  expect(await balance()).toBe(0);
  const sale = await sql<{ payment_status: string; amount_due: string }>(
    `SELECT payment_status, amount_due FROM sales WHERE number = $1`,
    [second!.trim()],
  );
  expect(sale[0]).toEqual({ payment_status: 'PAID', amount_due: '0' });

  // La fiche client affiche le même résultat.
  await page.goto(`/clients/${client.id}`);
  await expect(page.getByText(client.name).first()).toBeVisible();
  await context.close();
});
