import { expect, test } from '@playwright/test';
import { Api, sql, uniq } from '../support/api.js';
import { createClient, createProduct, createRefs, inMonths, receive } from '../support/data.js';
import { openCash } from '../support/flows.js';
import { login, pickFirst, withDevice } from '../support/ui.js';

/**
 * Scénario 4 — Vente à crédit → règlement partiel lettré → règlement du reste → facture soldée.
 */
test('4 — vente à crédit, deux règlements lettrés, facture soldée', async ({ browser }) => {
  const admin = await Api.login('admin');
  const refs = await createRefs(admin);
  const product = await createProduct(admin, refs);
  await receive(admin, refs, [
    { productId: product.id, lotNumber: 'LOT-C1', expiryDate: inMonths(18), qty: 20 },
  ]);
  // Plafond de crédit 1 000 DT, échéance à 30 jours.
  const client = await createClient(admin, { creditLimit: 1_000_000, paymentTermsDays: 30 });
  const invoice = async (number: string) =>
    (
      await sql<{ payment_status: string; amount_paid: string; amount_due: string }>(
        `SELECT payment_status, amount_paid, amount_due FROM sales WHERE number = $1`,
        [number],
      )
    )[0]!;
  const balance = async () =>
    Number(
      (await sql<{ balance: string }>(`SELECT balance FROM clients WHERE id = $1`, [client.id]))[0]!
        .balance,
    );

  const context = await browser.newContext();
  await withDevice(context, `Comptoir 4 ${uniq('D')}`);
  const page = await context.newPage();
  await login(page, 'pre01');
  await openCash(page);

  // --- Vente à crédit : 2 boîtes = 4,700 DT, aucun règlement immédiat --------------------------
  await page.goto('/pos');
  await page.getByLabel('Rechercher un client').fill(client.name);
  await page.getByRole('listbox').getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
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
  await page.getByLabel('Retirer ce règlement').click();
  await expect(page.getByText('Reste à payer (sur le compte du client, à crédit)')).toBeVisible();
  await page.getByLabel('Document à imprimer').selectOption('NONE');
  await page.keyboard.press('F10');
  const link = page.getByRole('link', { name: /FAC-\d{4}-\d{6}/ }).first();
  await link.waitFor();
  const number = (await link.textContent())!.trim();
  expect(await invoice(number)).toEqual({
    payment_status: 'UNPAID',
    amount_paid: '0',
    amount_due: '4700',
  });
  expect(await balance()).toBe(4700);

  // --- Premier règlement partiel : 2,000 DT, lettrage automatique -----------------------------------
  const pay = async (amount: string) => {
    await page.goto('/payments');
    await page.getByRole('button', { name: /Nouveau règlement|Nouvel encaissement/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByPlaceholder(/client/i)
      .first()
      .fill(client.name);
    await page.getByRole('listbox').getByRole('option').first().click();
    await dialog.getByLabel('Montant reçu').fill(amount);
    await expect(dialog.getByText(number).first()).toBeVisible(); // la facture ouverte est proposée
    await dialog.getByRole('button', { name: 'Enregistrer le règlement' }).click();
    await page.waitForURL(/\/payments\/[0-9a-f-]{36}$/); // fiche du règlement créé
  };
  await pay('2');
  expect(await invoice(number)).toEqual({
    payment_status: 'PARTIALLY_PAID',
    amount_paid: '2000',
    amount_due: '2700',
  });
  expect(await balance()).toBe(2700);

  // --- Règlement du reste --------------------------------------------------------------------------------
  await pay('2,7');
  expect(await invoice(number)).toEqual({
    payment_status: 'PAID',
    amount_paid: '4700',
    amount_due: '0',
  });
  expect(await balance()).toBe(0);

  // La facture apparaît soldée dans l'historique.
  await page.goto('/sales');
  await page.getByText(number).first().click();
  await expect(page.getByText('Payée').first()).toBeVisible();
  await context.close();
});
