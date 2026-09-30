import { expect, test } from '@playwright/test';
import { Api, sql, uniq } from '../support/api.js';
import { createProduct, createRefs, inMonths, receive } from '../support/data.js';
import { login, withDevice } from '../support/ui.js';

/**
 * Scénario 6 — Inventaire partiel (sélection de produits) → comptage → validation → ajustements
 * corrects : seuls les produits inventoriés sont corrigés, chaque écart devient un mouvement.
 */
test('6 — inventaire partiel, validation, ajustements exacts', async ({ browser }) => {
  const admin = await Api.login('admin');
  const refs = await createRefs(admin);
  const tag = uniq('I');
  const [a, b, c] = await Promise.all(
    ['Alpha', 'Bravo', 'Charlie'].map((n) =>
      createProduct(admin, refs, { name: `${n} ${tag} 500 mg`, dci: n }),
    ),
  );
  for (const [i, p] of [a!, b!, c!].entries()) {
    await receive(admin, refs, [
      { productId: p.id, lotNumber: `LOT-INV-${i}`, expiryDate: inMonths(12), qty: 10 },
    ]);
  }
  const stock = async (id: string) =>
    Number(
      (
        await sql<{ q: string }>(
          `SELECT COALESCE(SUM(remaining_qty), 0) q FROM lots WHERE product_id = $1`,
          [id],
        )
      )[0]!.q,
    );

  const context = await browser.newContext();
  await withDevice(context, `Réserve ${uniq('D')}`);
  const page = await context.newPage();
  await login(page, 'admin');

  // --- Ouverture : sélection de deux produits sur trois -----------------------------------------------
  await page.goto('/inventories');
  await page.getByRole('button', { name: 'Ouvrir un inventaire' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').first().selectOption({ label: 'Sélection de produits' });
  for (const p of [a!, b!]) {
    await dialog.getByPlaceholder('Rechercher un produit à ajouter…').fill(p.name);
    await dialog
      .getByRole('button', { name: new RegExp(p.name) })
      .first()
      .click();
  }
  await dialog.getByRole('button', { name: 'Ouvrir l’inventaire' }).click();
  await expect(page.getByRole('heading', { name: /Inventaire INV-/ })).toBeVisible();
  await expect(page.getByText(c!.name)).toHaveCount(0); // hors périmètre

  // --- Comptage à l'aveugle : Alpha 8 (−2), Bravo 13 (+3) ---------------------------------------------------
  const count = async (name: string, qty: string) => {
    const row = page.locator('tbody tr', { hasText: name });
    const input = row.getByPlaceholder('qté');
    await input.fill(qty);
    await input.press('Enter');
    await expect(input).toHaveValue(qty);
  };
  await count(a!.name, '8');
  await count(b!.name, '13');
  await expect(page.getByText('2 / 2 lignes comptées')).toBeVisible();
  await page.getByRole('button', { name: 'Terminer le comptage' }).click();

  // --- Validation ----------------------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Lots avec écart');
  await confirm.getByRole('button', { name: 'Valider et corriger le stock' }).click();
  await expect(page.getByText('Validé').first()).toBeVisible();

  expect(await stock(a!.id)).toBe(8);
  expect(await stock(b!.id)).toBe(13);
  expect(await stock(c!.id)).toBe(10); // hors périmètre : intact

  const moves = await sql<{ name: string; type: string; qty: number }>(
    `SELECT p.name, m.type, m.qty FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.type = 'INVENTORY_ADJUSTMENT' AND p.id = ANY($1::uuid[]) ORDER BY p.name`,
    [[a!.id, b!.id, c!.id]],
  );
  expect(moves).toEqual([
    { name: a!.name, type: 'INVENTORY_ADJUSTMENT', qty: -2 },
    { name: b!.name, type: 'INVENTORY_ADJUSTMENT', qty: 3 },
  ]);
  await context.close();
});
