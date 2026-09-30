import { expect, test } from '@playwright/test';
import { Api, sql, uniq } from '../support/api.js';
import { login, pickFirst, withDevice } from '../support/ui.js';

/**
 * Scénario 1 — Connexion admin → création d'un produit → réception de 2 lots (péremptions
 * différentes) → vente consommant les deux lots dans le bon ordre (FEFO) → fiche de mouvement.
 */
test('1 — produit, réception de deux lots, vente FEFO, fiche de mouvement', async ({ browser }) => {
  const admin = await Api.login('admin');
  const suffix = uniq('P');
  const category = await admin.post('/catalog/categories', {
    name: `Médicaments ${suffix}`,
    kind: 'MEDICINE',
  });
  const supplier = await admin.post('/suppliers', {
    name: `Grossiste ${suffix}`,
    paymentTermsDays: 30,
  });
  const client = await admin.post('/clients', {
    type: 'INDIVIDUAL',
    name: `Client ${suffix}`,
    phone: '71 000 000',
  });
  const productName = `Amoxicilline ${suffix} 1 g`;

  const context = await browser.newContext();
  await withDevice(context, `Comptoir 1 ${suffix}`);
  const page = await context.newPage();
  await login(page, 'admin');

  // --- Création du produit ---------------------------------------------------
  await page.goto('/products');
  await page.getByRole('button', { name: /Nouveau produit/ }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nom commercial').fill(productName);
  await form.getByLabel('Catégorie').selectOption({ label: category.name });
  await form.getByLabel('DCI (molécule)').fill('Amoxicilline');
  await form.getByLabel('Dosage').fill('1 g');
  await form.getByLabel('TVA').selectOption({ label: 'TVA 7 %' });
  await form.getByLabel('Prix d’achat de référence HT').fill('1,500');
  await form.getByLabel('Prix de vente TTC (boîte)').fill('2,350');
  await form.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(productName).first()).toBeVisible();

  // --- Réception de deux lots ------------------------------------------------
  await page.goto('/receipts/new');
  await expect(page.getByRole('heading', { name: 'Nouvelle réception' })).toBeVisible();
  await page.locator('select').first().selectOption('SUPPLIER');
  await page.locator('select').nth(1).selectOption({ label: supplier.name });
  const picker = page.getByPlaceholder('Scanner ou rechercher un produit à ajouter…');
  await pickFirst(page, picker, productName);
  // Le champ « N° de lot » de la nouvelle ligne prend le focus : on l'attend avant d'ajouter la suivante.
  await expect(page.getByLabel('Numéro de lot').nth(0)).toBeFocused();
  await pickFirst(page, picker, productName);
  await expect(page.getByLabel('Numéro de lot').nth(1)).toBeFocused();
  await page.getByLabel('Numéro de lot').nth(0).fill('LOT-TARDIF');
  await page.getByLabel('Péremption').nth(0).fill('06/2028');
  await page.getByLabel('Quantité').nth(0).fill('5');
  await page.getByLabel('Numéro de lot').nth(1).fill('LOT-PROCHE');
  await page.getByLabel('Péremption').nth(1).fill('03/2027');
  await page.getByLabel('Quantité').nth(1).fill('3');
  await page.getByRole('button', { name: 'Valider la réception' }).click();
  await page.getByRole('heading', { name: 'Valider la réception ?' }).waitFor();
  await page.getByRole('button', { name: /Valider$|Confirmer et valider/ }).click();
  await expect(page.getByText(/Réception REC-\d{4}-\d{6}/).first()).toBeVisible();

  // --- Caisse + vente de 6 boîtes --------------------------------------------
  await page.goto('/cash');
  await page.getByRole('heading', { name: 'Caisse de ce poste' }).waitFor();
  if (await page.getByRole('button', { name: 'Ouvrir la caisse' }).isVisible()) {
    await page.getByLabel('Fond de caisse').fill('100');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await expect(page.getByRole('button', { name: 'Clôturer' })).toBeVisible();
  }
  await page.goto('/pos');
  const clientSearch = page.getByLabel('Rechercher un client');
  await clientSearch.fill(client.name);
  await page.getByRole('listbox').getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
  const productSearch = page.getByPlaceholder('Scanner ou rechercher un produit (F2)…');
  await pickFirst(page, productSearch, productName);
  const qty = page.getByLabel(/^Quantité de /).first();
  await qty.fill('6');
  await Promise.all([
    page.waitForResponse(
      (r) => /\/sales\/[^/]+\/lines\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
    ),
    qty.press('Enter'),
  ]);
  // Aperçu FEFO : le lot le plus proche de la péremption est sorti en premier.
  await expect(page.locator('tbody')).toContainText('LOT-PROCHE');
  await expect(page.locator('tbody')).toContainText('LOT-TARDIF');
  await page.keyboard.press('F9');
  await page.getByRole('heading', { name: 'Paiement' }).waitFor();
  await page.getByLabel('Document à imprimer').selectOption('NONE');
  await page.getByLabel('Montant remis').fill('20');
  await page.keyboard.press('F10');
  const saleNumber = (await page
    .getByRole('link', { name: /FAC-\d{4}-\d{6}/ })
    .first()
    .textContent())!.trim();

  // --- Fiche de mouvement ----------------------------------------------------
  await page.goto('/stock/movements');
  await pickFirst(page, page.getByPlaceholder('Nom, DCI, code ou code-barres…'), productName);
  await page.getByText('Stock initial au').waitFor();
  const from = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Du', { exact: true }).fill(from);
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(4); // 2 entrées + 2 sorties (une par lot)
  const text = (await rows.allTextContents()).join('\n');
  expect(text).toContain(saleNumber);
  // Les sorties : d'abord le lot proche (3), puis le lot tardif (3).
  const outs = (await rows.allTextContents()).filter((r) => r.includes(saleNumber));
  expect(outs[0]).toContain('LOT-PROCHE');
  expect(outs[1]).toContain('LOT-TARDIF');

  // Base : 2 boîtes restantes sur le lot tardif, lot proche épuisé.
  const lots = await sql<{ lot_number: string; remaining_qty: number }>(
    `SELECT l.lot_number, l.remaining_qty FROM lots l JOIN products p ON p.id = l.product_id WHERE p.name = $1 ORDER BY l.lot_number`,
    [productName],
  );
  expect(lots).toEqual([
    { lot_number: 'LOT-PROCHE', remaining_qty: 0 },
    { lot_number: 'LOT-TARDIF', remaining_qty: 2 },
  ]);
  await context.close();
});
