import { expect, test } from '@playwright/test';
import { Api, mailbox, sql, uniq } from '../support/api.js';
import { createClient, createProduct, createRefs, inMonths, receive } from '../support/data.js';
import { openCash } from '../support/flows.js';
import { SMTP_PORT } from '../support/env.js';
import { login, pickFirst, withDevice } from '../support/ui.js';

/**
 * Scénario 7 — L'administrateur configure le SMTP (boîte de capture), envoie un e-mail de test,
 * s'abonne en « immédiat » aux remises hors plafond de PRE01 ; PRE01 vend à un client consentant
 * avec une remise hors plafond (code administrateur) → le client reçoit sa facture en PDF,
 * l'administrateur reçoit l'alerte, le rapport d'activité de PRE01 est exact. Puis même vente
 * avec le SMTP coupé : la vente est validée et l'e-mail part tout seul au rétablissement.
 */
test.describe.configure({ mode: 'serial' });

let admin: Api;
let refs: Awaited<ReturnType<typeof createRefs>>;
let product: { id: string; name: string };
let client: { id: string; name: string };
let clientEmail: string;

test.beforeAll(async () => {
  await mailbox.clear();
  admin = await Api.login('admin');
  refs = await createRefs(admin);
  product = await createProduct(admin, refs);
  await receive(admin, refs, [
    { productId: product.id, lotNumber: 'LOT-M1', expiryDate: inMonths(18), qty: 50 },
  ]);
  clientEmail = `${uniq('client').toLowerCase()}@example.com`;
  client = await createClient(admin, { email: clientEmail, emailConsent: true });
});

test.afterAll(async () => {
  await mailbox.smtp(true);
});

test('7a — SMTP, e-mail de test, abonnement, vente avec remise hors plafond, facture et alerte', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  // --- Administrateur : configuration SMTP + e-mail de test ---------------------------------------
  const adminContext = await browser.newContext();
  await withDevice(adminContext, `Bureau ${uniq('D')}`);
  const page = await adminContext.newPage();
  await login(page, 'admin');
  await page.goto('/admin/email');
  await page.getByLabel('Serveur (hôte)').fill('127.0.0.1');
  await page.getByLabel('Port').fill(SMTP_PORT);
  await page.getByLabel('Sécurité').selectOption('NONE');
  await page.getByLabel('Nom de l’expéditeur').fill('Pharmacie E2E');
  await page.getByLabel('Adresse de l’expéditeur').fill('factures@pharmacie.example.com');
  await page.getByRole('switch', { name: 'Envoi d’e-mails activé' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.getByRole('button', { name: 'Tester la connexion' }).click();
  await expect(page.getByText(/connexion.*(réussie|établie|ok)/i).first()).toBeVisible();
  await page.getByLabel('Destinataire du test').fill('admin@example.com');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  const test1 = await mailbox.waitFor((m) => m.to.includes('admin@example.com'));
  expect(test1.subject.length).toBeGreaterThan(0);

  // --- Abonnement « immédiat » aux remises hors plafond de PRE01 ---------------------------------
  await page.goto('/account/notifications');
  await page
    .getByLabel('Mode — Remise au-delà du plafond')
    .selectOption({ label: 'E-mail immédiat' });
  const row = page.locator('tbody tr', { hasText: 'Remise au-delà du plafond' });
  await row.getByRole('button', { name: /Tous les employés/ }).click();
  await page
    .getByRole('checkbox')
    .filter({ has: page.locator('xpath=..') })
    .first()
    .waitFor();
  await page.getByText('PRE01', { exact: false }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/enregistrées|enregistré/i).first()).toBeVisible();
  await mailbox.clear();

  // --- PRE01 vend avec une remise hors plafond (code administrateur) ----------------------------
  const prepContext = await browser.newContext();
  await withDevice(prepContext, `Comptoir 7 ${uniq('D')}`);
  const prep = await prepContext.newPage();
  await login(prep, 'pre01');
  await openCash(prep);
  await prep.goto('/pos');
  await prep.getByLabel('Rechercher un client').fill(client.name);
  await prep.getByRole('listbox').getByRole('option').first().waitFor();
  await prep.keyboard.press('Enter');
  await pickFirst(
    prep,
    prep.getByPlaceholder('Scanner ou rechercher un produit (F2)…'),
    product.name,
  );
  await prep.locator('tbody tr').first().locator('span.font-medium').first().click();
  await prep.keyboard.press('F4');
  await prep.getByRole('heading', { name: 'Remise et prix' }).waitFor();
  await prep.getByLabel('Remise en pourcentage').fill('15');
  await prep.getByRole('button', { name: 'Appliquer' }).click();
  await prep.getByRole('heading', { name: /Autorisation administrateur/ }).waitFor();
  await prep.getByLabel('Code administrateur').fill('ADM01');
  await prep.getByLabel('PIN').fill('1234');
  await prep.getByLabel('Motif').fill('Client fidèle, geste commercial');
  await prep.getByRole('button', { name: 'Autoriser' }).click();
  await expect(prep.getByText('🔑').first()).toBeVisible();
  await prep.keyboard.press('F9');
  await prep.getByRole('heading', { name: 'Paiement' }).waitFor();
  await prep.getByLabel('Document à imprimer').selectOption('NONE');
  await prep.getByLabel('Montant remis').fill('5');
  await prep.keyboard.press('F10');
  const link = prep.getByRole('link', { name: /FAC-\d{4}-\d{6}/ }).first();
  await link.waitFor();
  const number = (await link.textContent())!.trim();

  // Le client consentant reçoit sa facture en PDF ; le corps ne cite aucun médicament.
  const invoiceMail = await mailbox.waitFor((m) => m.to.includes(clientEmail));
  expect(invoiceMail.subject).toContain(number);
  expect(invoiceMail.attachments.some((a) => a.pdf)).toBe(true);
  expect(invoiceMail.text.toLowerCase()).not.toContain('amoxicilline');
  // L'administrateur reçoit l'alerte immédiate sur la remise hors plafond.
  const alert = await mailbox.waitFor(
    (m) => m.to.includes('admin@example.com') && /remise/i.test(m.subject + m.text),
  );
  expect(alert.text).toContain('PRE01');

  // --- Rapport d'activité quotidien de PRE01 ----------------------------------------------------------
  const report = await admin.get<{
    rows: {
      code: string;
      salesCount: number;
      salesTotal: number;
      discountOverLimit: number;
      adminCodesUsed: number;
    }[];
  }>('/notifications/activity-report');
  const pre01 = report.rows.find((r) => r.code === 'PRE01')!;
  expect(pre01.salesCount).toBeGreaterThanOrEqual(1);
  expect(pre01.discountOverLimit).toBeGreaterThanOrEqual(1);
  expect(pre01.adminCodesUsed).toBeGreaterThanOrEqual(1);
  const sale = await sql<{ total_ttc: string }>(`SELECT total_ttc FROM sales WHERE number = $1`, [
    number,
  ]);
  // 2,350 DT − 15 % ≈ 1,9975 DT : le montant exact suit les règles d'arrondi du module de prix (tests unitaires partagés).
  expect(Number(sale[0]!.total_ttc)).toBeGreaterThanOrEqual(1997);
  expect(Number(sale[0]!.total_ttc)).toBeLessThanOrEqual(1998);

  await adminContext.close();
  await prepContext.close();
});

test('7b — SMTP coupé : la vente est validée, l’e-mail part au rétablissement', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  await mailbox.clear();
  await mailbox.smtp(false);

  const prepContext = await browser.newContext();
  await withDevice(prepContext, `Comptoir 7b ${uniq('D')}`);
  const prep = await prepContext.newPage();
  await login(prep, 'pre01');
  await openCash(prep);
  await prep.goto('/pos');
  await prep.getByLabel('Rechercher un client').fill(client.name);
  await prep.getByRole('listbox').getByRole('option').first().waitFor();
  await prep.keyboard.press('Enter');
  await pickFirst(
    prep,
    prep.getByPlaceholder('Scanner ou rechercher un produit (F2)…'),
    product.name,
  );
  await prep.locator('tbody tr').first().waitFor(); // ligne ajoutée côté serveur
  await prep.keyboard.press('F9');
  await prep.getByRole('heading', { name: 'Paiement' }).waitFor();
  await prep.getByLabel('Document à imprimer').selectOption('NONE');
  await prep.getByLabel('Montant remis').fill('5');
  await prep.keyboard.press('F10');
  const link = prep.getByRole('link', { name: /FAC-\d{4}-\d{6}/ }).first();
  await link.waitFor(); // la vente est validée malgré la panne
  const number = (await link.textContent())!.trim();
  expect((await sql(`SELECT status FROM sales WHERE number = $1`, [number]))[0]).toEqual({
    status: 'VALIDATED',
  });
  expect((await mailbox.list()).filter((m) => m.to.includes(clientEmail))).toHaveLength(0);

  // Rétablissement : l'e-mail en file part automatiquement (reprise avec délai croissant).
  await mailbox.smtp(true);
  const mail = await mailbox.waitFor(
    (m) => m.to.includes(clientEmail) && m.subject.includes(number),
    180_000,
  );
  expect(mail.attachments.some((a) => a.pdf)).toBe(true);
  await prepContext.close();
});
