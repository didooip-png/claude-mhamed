import { expect, type Page } from '@playwright/test';
import { pickFirst } from './ui.js';

/** Ouvre la caisse du poste si elle ne l'est pas (fond de caisse en dinars). */
export async function openCash(page: Page, float = '100'): Promise<void> {
  await page.goto('/cash');
  await page.getByRole('heading', { name: 'Caisse de ce poste' }).waitFor();
  if (await page.getByRole('button', { name: 'Ouvrir la caisse' }).isVisible()) {
    await page.getByLabel('Fond de caisse').fill(float);
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await expect(page.getByRole('button', { name: 'Clôturer' })).toBeVisible();
  }
}

export interface SaleOptions {
  client: string;
  lines: { search: string; qty: number }[];
  /** Montant remis en dinars (espèces). Par défaut : 500. */
  tendered?: string;
}

/** Vente comptoir en espèces, sans document imprimé. Retourne le numéro de facture. */
export async function sellCash(page: Page, options: SaleOptions): Promise<string> {
  await page.goto('/pos');
  const clientSearch = page.getByLabel('Rechercher un client');
  await clientSearch.fill(options.client);
  await page.getByRole('listbox').getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
  const productSearch = page.getByPlaceholder('Scanner ou rechercher un produit (F2)…');
  for (const [i, line] of options.lines.entries()) {
    await pickFirst(page, productSearch, line.search);
    await page.waitForFunction((n) => document.querySelectorAll('tbody tr').length >= n, i + 1);
    if (line.qty !== 1) {
      const qty = page.getByLabel(/^Quantité de /).nth(i);
      await qty.fill(String(line.qty));
      // Le panier vit côté serveur : on attend la mise à jour de la ligne avant de payer.
      await Promise.all([
        page.waitForResponse(
          (r) => /\/sales\/[^/]+\/lines\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
        ),
        qty.press('Enter'),
      ]);
    }
  }
  await page.keyboard.press('F9');
  await page.getByRole('heading', { name: 'Paiement' }).waitFor();
  await page.getByLabel('Document à imprimer').selectOption('NONE');
  await page.getByLabel('Montant remis').fill(options.tendered ?? '500');
  await page.keyboard.press('F10');
  const link = page.getByRole('link', { name: /FAC-\d{4}-\d{6}/ }).first();
  await link.waitFor();
  return (await link.textContent())!.trim();
}
