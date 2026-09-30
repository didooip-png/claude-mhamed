import { expect, type BrowserContext, type Page } from '@playwright/test';
import { newDevice, type Device } from './api.js';
import { USERS } from './env.js';

/** Poste déjà enregistré et approuvé dans le stockage local du navigateur. */
export async function withDevice(context: BrowserContext, name: string): Promise<Device> {
  const device = await newDevice(name);
  await context.addInitScript((d) => {
    localStorage.setItem('pharmastock.device', JSON.stringify(d));
    // La visite guidée du premier lancement masquerait la page pendant les parcours.
    localStorage.setItem('pharmastock.tour.disabled', '1');
  }, device);
  return device;
}

export async function login(page: Page, user: keyof typeof USERS): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Identifiant').fill(USERS[user].username);
  await page.getByLabel('Mot de passe').fill(USERS[user].password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText(/^Bonjour/)).toBeVisible();
}

/** Sélectionne la première suggestion d'un champ de recherche à liste déroulante. */
export async function pickFirst(
  page: Page,
  input: ReturnType<Page['getByPlaceholder']>,
  text: string,
) {
  await input.fill(text);
  await page.getByRole('listbox').getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
}
