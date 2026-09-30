/**
 * Scènes de capture. Chaque scène porte l'identifiant `shot` d'une fiche d'aide
 * (packages/shared/src/help) : l'image obtenue illustre cette fiche dans les manuels.
 * `roles` : rôles pour lesquels la capture est prise (défaut : administrateur).
 * L'ordre compte : la passe « préparateur » ouvre la caisse et prépare les données que
 * les écrans suivants affichent.
 */
import { SMTP_SINK_PORT } from './env.mjs';
import { settle } from './shots.mjs';

const P = ['PREPARER'];
const A = ['ADMIN'];
const BOTH = ['PREPARER', 'ADMIN'];

const pickProduct = async (page, text) => {
  const picker = page.getByPlaceholder('Scanner ou rechercher un produit (F2)…');
  await picker.fill(text);
  await page.getByRole('listbox').getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
};

const pickClient = async (page, text) => {
  const search = page.getByLabel('Rechercher un client');
  if (
    await search
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await search.fill(text);
    await page.getByRole('listbox').getByRole('option').first().waitFor();
    await page.keyboard.press('Enter');
  }
};

const firstRow = (page) => page.locator('tbody tr').first();

/** Serveur SMTP de démonstration : la boîte de capture locale (aucun e-mail ne sort de la machine). */
async function ensureSmtp(c) {
  await c.api.put('/email/smtp', {
    enabled: true,
    host: '127.0.0.1',
    port: Number(SMTP_SINK_PORT),
    security: 'NONE',
    username: '',
    fromName: 'Pharmacie Ennasr',
    fromEmail: 'factures@pharmacie-ennasr.tn',
    replyTo: '',
    bccArchive: '',
    hourlyLimit: 200,
  });
  await c.api.post('/email/smtp/test-connection').catch(() => {});
}

export function buildScenes(base) {
  return [
    // ------------------------------------------------------------------ Avant connexion
    {
      id: 'login',
      roles: P,
      anonymous: true,
      run: async (c) => {
        await c.goto('/', (p) => p.getByLabel('Identifiant').waitFor());
        await c.shot('login', { clip: { x: 340, y: 120, width: 600, height: 540 } });
      },
    },
    // ------------------------------------------------------------------ Premiers pas
    {
      id: 'dashboard',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/', (p) => p.getByText(/^Bonjour/).waitFor(), 1500);
        await c.shot('dashboard');
      },
    },
    {
      id: 'navigation',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/', (p) => p.getByText(/^Bonjour/).waitFor(), 800);
        await c.shot('navigation', {
          marks: [
            { target: c.page.getByRole('navigation', { name: 'Navigation principale' }), n: 1 },
            { target: c.page.getByRole('button', { name: 'Rechercher' }), n: 2, at: 'tr' },
            { target: c.page.getByRole('button', { name: /^Notifications/ }), n: 3 },
            { target: c.page.getByRole('button', { name: 'Aide sur cet écran' }), n: 4 },
          ],
        });
      },
    },
    {
      id: 'lock-screen',
      roles: P,
      run: async (c) => {
        await c.goto('/', (p) => p.getByText(/^Bonjour/).waitFor());
        await c.page.locator('[data-tour="user"]').click();
        await c.page.getByRole('menuitem', { name: /Verrouiller l’écran/ }).click();
        await c.page.getByLabel(/PIN/i).first().waitFor();
        await settle(c.page, 400);
        await c.shot('lock-screen', { clip: { x: 340, y: 120, width: 600, height: 540 } });
        await c.page.getByLabel(/PIN/i).first().fill('1111');
        await c.page.keyboard.press('Enter');
        await c.page.getByText(/^Bonjour/).waitFor();
      },
    },
    // ------------------------------------------------------------------ Caisse
    {
      id: 'cash',
      roles: BOTH,
      run: async (c) => {
        await c.page.goto(base + '/cash');
        await c.page.getByRole('heading', { name: 'Caisse de ce poste' }).waitFor();
        await settle(c.page);
        const open = c.page.getByRole('button', { name: 'Ouvrir la caisse' });
        if (await open.isVisible().catch(() => false)) {
          await c.page.getByLabel('Fond de caisse').fill('100');
          await c.shot('cash', {
            marks: [
              { target: c.page.getByLabel('Fond de caisse'), n: 1 },
              { target: open, n: 2, at: 'tr' },
            ],
          });
          await open.click();
          await c.page.getByRole('button', { name: 'Clôturer' }).waitFor();
        } else {
          await c.shot('cash');
        }
      },
    },
    {
      id: 'pos-cart',
      roles: P,
      run: async (c) => {
        await c.goto('/pos', (p) =>
          p.getByPlaceholder('Scanner ou rechercher un produit (F2)…').waitFor(),
        );
        await pickClient(c.page, 'ben');
        await pickProduct(c.page, 'paracetamol 500');
        await c.page.locator('tbody tr').first().waitFor();
        await pickProduct(c.page, 'ibuprof');
        await c.page.waitForFunction(() => document.querySelectorAll('tbody tr').length >= 2);
        const qty = c.page.getByLabel(/^Quantité de /).first();
        await qty.fill('3');
        await qty.press('Enter');
        await settle(c.page, 800);
        await c.shot('pos-cart', {
          marks: [
            { target: c.page.getByRole('button', { name: /Changer/ }), n: 2, at: 'tr' },
            { target: c.page.getByPlaceholder('Scanner ou rechercher un produit (F2)…'), n: 3 },
            { target: qty, n: 4, at: 'tr' },
            { target: c.page.getByRole('button', { name: /^Paiement/ }), n: 5, at: 'tr' },
          ],
        });
      },
    },
    {
      id: 'pos-payment',
      roles: P,
      run: async (c) => {
        await c.page.keyboard.press('F9');
        await c.page.getByRole('heading', { name: 'Paiement' }).waitFor();
        await c.page.getByLabel('Montant remis').first().fill('50');
        await settle(c.page, 400);
        await c.shot('pos-payment', { element: c.page.getByRole('dialog') });
        await c.page.keyboard.press('Escape');
      },
    },
    {
      id: 'override',
      roles: P,
      run: async (c) => {
        // Remise de 40 % sur la ligne sélectionnée : au-delà du plafond, le logiciel demande un administrateur.
        await c.page.locator('tbody tr').first().locator('td').nth(1).click();
        await c.page.keyboard.press('F4');
        const dialog = c.page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.getByLabel('Remise en pourcentage').fill('40');
        await dialog.getByRole('button', { name: 'Appliquer' }).click();
        await c.page.getByText('Autorisation administrateur').waitFor();
        await settle(c.page, 400);
        await c.shot('override', { element: c.page.getByRole('dialog').last() });
        await c.page.keyboard.press('Escape');
        await c.page.keyboard.press('Escape');
      },
    },
    {
      id: 'pos-prescription',
      roles: P,
      run: async (c) => {
        await pickProduct(c.page, 'amoxicilline');
        const prescriber = c.page.locator('#rx-prescriber');
        await prescriber.waitFor();
        await prescriber.fill('Dr Mansour');
        await settle(c.page, 500);
        const card = prescriber.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
        await c.shot('pos-prescription', { marks: [{ target: card, n: 2 }] });
      },
    },
    {
      id: 'sales-on-hold',
      roles: P,
      run: async (c) => {
        await c.page.keyboard.press('F8');
        await settle(c.page, 600);
        await c.goto('/sales/on-hold', (p) =>
          p.getByRole('heading', { name: /attente/i }).waitFor(),
        );
        await c.shot('sales-on-hold');
      },
    },
    // ------------------------------------------------------------------ Ventes, retours
    {
      id: 'sales',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/sales', (p) => firstRow(p).waitFor());
        await c.shot('sales');
      },
    },
    {
      id: 'sale-detail',
      roles: P,
      run: async (c) => {
        await c.goto('/sales', (p) => firstRow(p).waitFor());
        await firstRow(c.page).click();
        await c.page.getByText('Règlements').first().waitFor();
        await settle(c.page, 800);
        await c.shot('sale-detail');
      },
    },
    {
      id: 'sale-cancel',
      roles: A,
      run: async (c) => {
        await c.goto('/sales', (p) => firstRow(p).waitFor());
        await firstRow(c.page).click();
        await c.page.getByText('Règlements').first().waitFor();
        await c.page.getByRole('button', { name: /Annuler la vente/ }).click();
        const dialog = c.page.getByRole('dialog');
        await dialog.waitFor();
        await settle(c.page, 400);
        await c.shot('sale-cancel', { element: dialog });
        await c.page.keyboard.press('Escape');
      },
    },
    {
      id: 'returns',
      roles: P,
      run: async (c) => {
        await c.goto('/returns', (p) =>
          p
            .getByRole('heading', { name: /Retours/ })
            .first()
            .waitFor(),
        );
        await c.shot('returns');
      },
    },
    {
      id: 'return-new',
      roles: P,
      run: async (c) => {
        await c.goto('/returns/new', (p) =>
          p.getByLabel('Rechercher la vente d’origine').waitFor(),
        );
        await c.page.getByLabel('Rechercher la vente d’origine').fill('FAC-');
        await c.page.locator('ul li button').first().click();
        await c.page
          .getByLabel(/^Quantité retournée/)
          .first()
          .fill('1');
        await c.page.getByLabel('Motif du retour').fill('Produit non utilisé, emballage intact');
        await settle(c.page, 500);
        await c.shot('return-new');
      },
    },
    // ------------------------------------------------------------------ Clients et règlements
    {
      id: 'clients',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/clients', (p) => firstRow(p).waitFor());
        await c.shot('clients');
      },
    },
    {
      id: 'client-detail',
      roles: P,
      run: async (c) => {
        await c.goto('/clients', (p) => firstRow(p).waitFor());
        // Un client qui a des factures ouvertes illustre mieux la fiche que le premier venu.
        const debtor = c.page.locator('tbody tr', { hasText: /Clinique El Manar/ }).first();
        await ((await debtor.count()) ? debtor : c.page.locator('tbody tr').nth(2)).click();
        await settle(c.page, 1200);
        await c.shot('client-detail');
      },
    },
    {
      id: 'payments',
      roles: P,
      run: async (c) => {
        await c.goto('/payments', (p) =>
          p.getByRole('heading', { name: 'Encaissements' }).waitFor(),
        );
        await c.shot('payments');
      },
    },
    {
      id: 'payment-new',
      roles: P,
      run: async (c) => {
        await c.goto('/payments', (p) =>
          p.getByRole('heading', { name: 'Encaissements' }).waitFor(),
        );
        await c.page.getByRole('button', { name: /Nouvel encaissement/ }).click();
        const d = c.page.getByRole('dialog');
        await d
          .getByPlaceholder(/client/i)
          .first()
          .fill('Clinique');
        await c.page.getByRole('listbox').getByRole('option').first().click();
        await d.getByLabel('Montant reçu').fill('500');
        await settle(c.page, 500);
        await c.shot('payment-new', { element: d });
        await c.page.keyboard.press('Escape');
      },
    },
    {
      id: 'cheques',
      roles: P,
      run: async (c) => {
        await c.goto('/payments/cheques', (p) =>
          p.getByRole('heading', { name: /Chèques/ }).waitFor(),
        );
        await c.shot('cheques');
      },
    },
    {
      id: 'aging',
      roles: P,
      run: async (c) => {
        await c.goto(
          '/payments/aging',
          (p) => p.getByRole('heading', { name: 'Balance âgée' }).waitFor(),
          800,
        );
        await c.shot('aging');
      },
    },
    // ------------------------------------------------------------------ Stock
    {
      id: 'stock',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/stock', (p) => firstRow(p).waitFor());
        await c.shot('stock');
      },
    },
    {
      id: 'lots',
      roles: P,
      run: async (c) => {
        await c.goto('/stock/lots', (p) => firstRow(p).waitFor());
        await c.shot('lots');
      },
    },
    {
      id: 'expiries',
      roles: P,
      run: async (c) => {
        await c.goto(
          '/stock/expiries',
          (p) =>
            p
              .getByRole('heading', { name: /Péremptions/ })
              .first()
              .waitFor(),
          800,
        );
        await c.shot('expiries');
      },
    },
    {
      id: 'movements',
      roles: P,
      run: async (c) => {
        await c.goto('/stock/movements');
        await c.page.getByPlaceholder('Nom, DCI, code ou code-barres…').fill('paracetamol');
        await c.page.getByRole('listbox').getByRole('option').first().waitFor();
        await c.page.keyboard.press('Enter');
        await c.page.getByText('Stock initial au').waitFor();
        const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        await c.page.getByLabel('Du', { exact: true }).fill(from);
        await settle(c.page, 1500);
        await c.shot('movements');
      },
    },
    {
      id: 'at-date',
      roles: P,
      run: async (c) => {
        await c.goto(
          '/stock/at-date',
          (p) => p.getByRole('heading', { name: /Stock à une date/ }).waitFor(),
          1000,
        );
        await c.shot('at-date');
      },
    },
    {
      id: 'recall',
      roles: A,
      run: async (c) => {
        const lots = await c.api.get('/stock/lots?pageSize=1&withStock=1');
        const lotNumber = lots.items[0].lotNumber;
        await c.goto(
          '/stock/recall',
          (p) => p.getByRole('heading', { name: /Rappel/ }).waitFor(),
          400,
        );
        await c.page.getByPlaceholder('Numéro inscrit sur la boîte').fill(lotNumber);
        await c.page.locator('main').getByRole('button', { name: 'Rechercher' }).click();
        await settle(c.page, 1200);
        await c.shot('recall');
      },
    },
    // ------------------------------------------------------------------ Achats
    {
      id: 'receipts',
      roles: P,
      run: async (c) => {
        await c.goto('/receipts', (p) => firstRow(p).waitFor());
        await c.shot('receipts');
      },
    },
    {
      id: 'receipt-new',
      roles: P,
      run: async (c) => {
        await c.goto('/receipts/new', (p) =>
          p.getByPlaceholder('Scanner ou rechercher un produit à ajouter…').waitFor(),
        );
        await c.page.locator('select').first().selectOption('SUPPLIER');
        await c.page.locator('select').nth(1).selectOption({ index: 1 });
        const picker = c.page.getByPlaceholder('Scanner ou rechercher un produit à ajouter…');
        await picker.fill('ibuprof');
        await c.page.getByRole('listbox').getByRole('option').first().waitFor();
        await c.page.keyboard.press('Enter');
        await c.page.getByLabel('Numéro de lot').first().fill('IBU2026A');
        await c.page.getByLabel('Péremption').first().fill('06/2028');
        await c.page.getByLabel('Quantité').first().fill('24');
        await c.page.waitForTimeout(400);
        await picker.fill('amoxicilline 1 g');
        await c.page.getByRole('listbox').getByRole('option').first().waitFor();
        await c.page.keyboard.press('Enter');
        await c.page.getByLabel('Numéro de lot').nth(1).fill('AMX777');
        await c.page.getByLabel('Péremption').nth(1).fill('3/2027');
        await c.page.getByLabel('Quantité').nth(1).fill('10');
        await c.shot('receipt-new');
      },
    },
    {
      id: 'suppliers',
      roles: P,
      run: async (c) => {
        await c.goto('/suppliers', (p) => firstRow(p).waitFor());
        await c.shot('suppliers');
      },
    },
    {
      id: 'reorder',
      roles: P,
      run: async (c) => {
        await c.goto(
          '/reorder',
          (p) => p.getByRole('heading', { name: /Réapprovisionnement/ }).waitFor(),
          1000,
        );
        await c.shot('reorder');
      },
    },
    {
      id: 'purchase-orders',
      roles: P,
      run: async (c) => {
        await c.goto('/purchase-orders', (p) =>
          p
            .getByRole('heading', { name: /Commandes/ })
            .first()
            .waitFor(),
        );
        await c.shot('purchase-orders');
      },
    },
    {
      id: 'supplier-returns',
      roles: A,
      run: async (c) => {
        await c.goto('/supplier-returns', (p) =>
          p
            .getByRole('heading', { name: /Retours fournisseurs/ })
            .first()
            .waitFor(),
        );
        await c.shot('supplier-returns');
      },
    },
    // ------------------------------------------------------------------ Inventaires, ajustements
    {
      id: 'inventories',
      roles: P,
      run: async (c) => {
        await c.goto('/inventories', (p) =>
          p
            .getByRole('heading', { name: /Inventaires/ })
            .first()
            .waitFor(),
        );
        await c.shot('inventories');
      },
    },
    {
      id: 'inventory-detail',
      roles: P,
      run: async (c) => {
        await c.goto('/inventories', (p) =>
          p
            .getByRole('heading', { name: /Inventaires/ })
            .first()
            .waitFor(),
        );
        await c.page
          .locator('tbody tr', { hasText: /Comptage en cours/ })
          .first()
          .click();
        await c.page.getByText('Avancement').waitFor();
        await settle(c.page, 600);
        await c.shot('inventory-detail');
      },
    },
    {
      id: 'adjustments',
      roles: P,
      run: async (c) => {
        await c.goto('/adjustments', (p) =>
          p
            .getByRole('heading', { name: /Ajustements/ })
            .first()
            .waitFor(),
        );
        await c.shot('adjustments');
      },
    },
    // ------------------------------------------------------------------ Clôture de caisse
    {
      id: 'cash-close',
      roles: P,
      run: async (c) => {
        await c.page.setViewportSize({ width: 1280, height: 1100 });
        await c.page.goto(base + '/cash');
        await c.page.getByRole('button', { name: 'Clôturer' }).click();
        const d = c.page.getByRole('dialog');
        await d.waitFor();
        const first = d.locator('input[type=number], input[inputmode=numeric]').first();
        if (await first.isVisible().catch(() => false)) await first.fill('5');
        await settle(c.page, 500);
        await c.shot('cash-close', { element: d });
        await c.page.keyboard.press('Escape');
        await c.page.setViewportSize({ width: 1280, height: 800 });
      },
    },
    {
      id: 'cash-session',
      roles: A,
      run: async (c) => {
        await c.goto('/cash', (p) =>
          p
            .getByRole('heading', { name: /Caisse/ })
            .first()
            .waitFor(),
        );
        const closed = c.page.locator('tbody tr', { hasText: /Clôturée|Fermée/ }).first();
        const row = (await closed.count()) ? closed : c.page.locator('tbody tr').first();
        await row.click();
        await settle(c.page, 800);
        await c.shot('cash-session');
      },
    },
    // ------------------------------------------------------------------ Catalogue
    {
      id: 'products',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/products', (p) => firstRow(p).waitFor());
        await c.shot('products');
      },
    },
    {
      id: 'product-detail',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/products', (p) => firstRow(p).waitFor());
        await firstRow(c.page).click();
        await settle(c.page, 1000);
        await c.shot('product-detail');
      },
    },
    {
      id: 'references',
      roles: A,
      run: async (c) => {
        await c.goto('/catalog/references', (p) =>
          p
            .getByRole('heading', { name: /Référentiels/ })
            .first()
            .waitFor(),
        );
        await c.shot('references');
      },
    },
    // ------------------------------------------------------------------ Rapports, mouchard
    {
      id: 'reports',
      roles: A,
      run: async (c) => {
        await c.goto(
          '/reports',
          (p) =>
            p
              .getByRole('heading', { name: /Statistiques/ })
              .first()
              .waitFor(),
          800,
        );
        await c.shot('reports');
      },
    },
    {
      id: 'report-detail',
      roles: A,
      run: async (c) => {
        await c.goto(
          '/reports/sales-summary',
          (p) =>
            p
              .getByRole('heading', { name: /Statistiques/ })
              .first()
              .waitFor(),
          1800,
        );
        await c.shot('report-detail');
      },
    },
    {
      id: 'audit',
      roles: A,
      run: async (c) => {
        await c.goto('/audit', (p) => p.getByText('Journal infalsifiable').waitFor());
        await c.shot('audit');
      },
    },
    // ------------------------------------------------------------------ Administration
    {
      id: 'users',
      roles: A,
      run: async (c) => {
        await c.goto('/admin/users', (p) => firstRow(p).waitFor());
        await c.shot('users');
      },
    },
    {
      id: 'roles',
      roles: A,
      run: async (c) => {
        await c.goto(
          '/admin/roles',
          (p) => p.getByRole('heading', { name: /Rôles/ }).first().waitFor(),
          800,
        );
        await c.shot('roles');
      },
    },
    {
      id: 'devices',
      roles: A,
      run: async (c) => {
        await c.goto('/admin/devices', (p) => firstRow(p).waitFor());
        await c.shot('devices');
      },
    },
    {
      id: 'sessions',
      roles: A,
      run: async (c) => {
        await c.goto('/admin/sessions', (p) => firstRow(p).waitFor());
        await c.shot('sessions');
      },
    },
    {
      id: 'settings',
      roles: A,
      run: async (c) => {
        await c.goto(
          '/admin/settings',
          (p) => p.getByRole('heading', { name: 'Paramètres' }).waitFor(),
          800,
        );
        await c.shot('settings');
      },
    },
    {
      id: 'email',
      roles: A,
      run: async (c) => {
        await c.goto('/admin/email', (p) => p.getByLabel('Serveur (hôte)').waitFor());
        // Valeurs d'exemple (non enregistrées) : le manuel montre un réglage plausible, pas celui de la démonstration.
        await c.page.getByLabel('Serveur (hôte)').fill('smtp.pharmacie-ennasr.tn');
        await c.page.locator('#smtp-security').selectOption('STARTTLS');
        await c.page.getByLabel('Identifiant').fill('factures@pharmacie-ennasr.tn');
        await c.page.getByLabel('Nom de l’expéditeur').fill('Pharmacie Ennasr');
        await c.page.getByLabel('Adresse de l’expéditeur').fill('factures@pharmacie-ennasr.tn');
        await c.page.getByLabel('Destinataire du test').fill('vous@pharmacie-ennasr.tn');
        await c.shot('email', {
          marks: [
            { target: c.page.getByLabel('Serveur (hôte)'), n: 1 },
            { target: c.page.getByLabel('Adresse de l’expéditeur'), n: 2 },
            { target: c.page.getByLabel('Destinataire du test'), n: 3, at: 'tr' },
            { target: c.page.getByLabel('Envoi d’e-mails activé'), n: 4 },
            { target: c.page.getByRole('tab', { name: 'Modèles d’e-mails' }), n: 5 },
          ],
        });
        await ensureSmtp(c);
      },
    },
    {
      id: 'email-log',
      roles: A,
      run: async (c) => {
        await ensureSmtp(c);
        // Trois factures envoyées par e-mail (boîte de capture locale) : le journal a un contenu réel.
        const list = await c.api.get('/sales?pageSize=40&status=VALIDATED');
        let sent = 0;
        for (const row of list.items) {
          if (sent >= 3) break;
          const sale = await c.api.get(`/sales/${row.id}`);
          const to = sale.client?.email;
          if (!to || sale.client?.isWalkIn) continue;
          await c.api.post(`/sales/${row.id}/email`, { to: [to], confirmNoConsent: true });
          sent++;
        }
        for (let i = 0; i < 30; i++) {
          const log = await c.api.get('/email/log?pageSize=20');
          if (log.items.some((e) => e.status === 'SENT')) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        await c.goto(
          '/admin/email-log',
          (p) => p.getByRole('heading', { name: 'Journal des e-mails' }).waitFor(),
          800,
        );
        await c.shot('email-log');
      },
    },
    {
      id: 'jobs',
      roles: A,
      run: async (c) => {
        await c.goto('/admin/jobs', (p) =>
          p.getByRole('heading', { name: 'Tâches planifiées' }).waitFor(),
        );
        const run = c.page.getByRole('button', { name: 'Lancer' });
        for (let i = 0; i < Math.min(3, await run.count()); i++) {
          await run.nth(i).click();
          await c.page.waitForTimeout(600);
        }
        await settle(c.page, 800);
        await c.shot('jobs');
      },
    },
    {
      id: 'backups',
      roles: A,
      run: async (c) => {
        await c.goto('/admin/backups', (p) =>
          p.getByRole('heading', { name: 'Sauvegardes' }).waitFor(),
        );
        await c.page.getByRole('button', { name: 'Sauvegarder maintenant' }).click();
        await c.page.getByText('Réussie').first().waitFor({ timeout: 90_000 });
        await settle(c.page, 500);
        await c.shot('backups');
      },
    },
    // ------------------------------------------------------------------ Compte
    {
      id: 'account',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/account', (p) => p.getByRole('heading', { name: 'Mon compte' }).waitFor());
        await c.shot('account');
      },
    },
    {
      id: 'my-notifications',
      roles: A,
      run: async (c) => {
        await c.goto(
          '/account/notifications',
          (p) => p.getByRole('heading', { name: 'Mes notifications' }).waitFor(),
          800,
        );
        await c.shot('my-notifications');
      },
    },
    {
      id: 'notifications',
      roles: P,
      run: async (c) => {
        await c.goto('/', (p) => p.getByText(/^Bonjour/).waitFor());
        await c.page.getByRole('button', { name: /^Notifications/ }).click();
        await settle(c.page, 700);
        await c.shot('notifications');
        await c.page.keyboard.press('Escape');
      },
    },
    {
      id: 'help',
      roles: BOTH,
      run: async (c) => {
        await c.goto('/help', (p) => p.getByRole('heading', { name: 'Aide' }).waitFor());
        await c.shot('help');
      },
    },
    {
      id: 'install',
      roles: P,
      mobile: true,
      run: async (c) => {
        await c.page.getByRole('button', { name: 'Installer' }).first().tap();
        const d = c.page.getByRole('dialog');
        await d.waitFor();
        await settle(c.page, 500);
        await c.shot('install');
      },
    },
  ];
}
