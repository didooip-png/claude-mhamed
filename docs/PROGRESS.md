# Avancement

Légende : ✅ fait · 🔄 en cours · ⏳ reste à faire

## Phase 0 — Fondations ✅

**Fait**

- Monorepo pnpm (ESM, TypeScript 6 strict), ESLint + Prettier, CI GitHub Actions (lint, format, typecheck, tests, build).
- `packages/shared` : module `money` (millimes, arrondi half-up, montant en toutes lettres), calculs de vente/réception,
  permissions (matrice §5.2), paramètres métier, codes d'erreur FR, événements d'audit, dates (Africa/Tunis). 21 tests.
- Schéma de données complet §7 (toutes phases) + migration d'intégrité : CHECK (stock ≥ 0, montants), triggers
  « ajout seul » (UPDATE/DELETE/TRUNCATE interdits), index trigramme, index uniques partiels, droits du rôle applicatif.
- Authentification : mot de passe + PIN Argon2id, JWT 15 min + refresh token httpOnly avec rotation et détection de
  réutilisation, verrouillage du compte après 5 échecs, TOTP optionnel, verrouillage d'écran (manuel et inactivité)
  appliqué côté serveur, changement rapide d'utilisateur par PIN (y compris depuis l'écran verrouillé).
- Postes de travail : enregistrement, approbation / révocation / renommage, amorçage du premier poste.
- Utilisateurs (jamais supprimés : désactivés), rôles système + rôles personnalisés, sessions actives et déconnexion forcée.
- Paramètres métier validés et tracés (`SETTING_CHANGED` avant / après).
- Journal d'audit infalsifiable (chaîne SHA-256, vérification d'intégrité), numérotation sans trou (`document_sequences`).
- Autorisation par code administrateur (🔑) : mécanisme générique, tracé (`ADMIN_OVERRIDE` / `OVERRIDE_FAILED`).
- Interface : connexion, enregistrement du poste, changement de mot de passe obligatoire, coquille (menu filtré par
  permissions, palette Ctrl+K, indicateur et bandeau de connexion, mode sombre), écran de verrouillage, Mon compte
  (mot de passe, PIN, TOTP), Utilisateurs, Rôles et permissions, Postes, Sessions actives, Paramètres, Mouchard
  (filtres, détail avant/après, vérification d'intégrité).
- CLI d'exploitation (`setup`, `devices`, `approve-device`, `unlock-user`, `verify-audit`), seed des utilisateurs de démonstration.

**Démonstration (critère de phase)** : `admin` et `pre01` se connectent ; le préparateur ne voit pas l'administration
et l'API lui répond 403 ; chaque connexion apparaît au mouchard. Tests d'intégration : `pnpm --filter @pharmastock/api test`
(connexion, verrouillage, rotation du refresh token, poste en attente, PIN, écran verrouillé, mot de passe obligatoire,
matrice de permissions, paramètres tracés, détection d'altération du journal).

## Phase 1 — Catalogue, tiers, réceptions, stock ✅

**Fait**

- Catalogue : produits (codes-barres multiples, DCI, dosage, forme, présentation, laboratoire, catégorie, famille, TVA,
  prix d'achat HT / vente TTC, marge calculée, vente à l'unité, ordonnance, tableau A/B/C, chaîne du froid, retour autorisé,
  emplacement, seuils), code interne automatique, contrôle de version, historique des prix (qui, quand, ancien → nouveau),
  archivage (suppression seulement sans historique), équivalents (même DCI + dosage + forme, avec stock).
- Recherche instantanée tolérante (accents, fautes légères en repli trigramme), code-barres exact prioritaire (scanner).
- Import Excel / CSV avec simulation et rapport d'erreurs ligne par ligne ; export Excel au même format.
- Référentiels : catégories, laboratoires, familles thérapeutiques, taux de TVA (un taux utilisé ne change pas de valeur).
- Fournisseurs ; clients (création rapide, consentement e-mail daté avec son auteur, plafond / remise réservés à l'administrateur).
- Réceptions : brouillon → validation (numéro REC-AAAA-NNNNNN, un lot par ligne, coût unitaire avec unités gratuites,
  conversion boîtes → unités, péremption MM/AAAA, contrôle bloquant « péremption passée », avertissements « péremption
  proche » et « écart de prix » à confirmer, mise à jour optionnelle du prix de référence, scan de facture joint)
  → annulation administrateur (RG-15) avec contre-mouvements. Numérotation sans trou vérifiée sous concurrence.
- Stock : état du stock (vendable / bloqué / périmé, valeur au coût et au prix de vente), lots avec code couleur,
  blocage / déblocage tracé, péremptions à N jours, **fiche de mouvement** (stock initial calculé, mouvements avec
  utilisateur / date / heure / poste / lot / document, solde, totaux par type, export Excel), stock à une date passée.
- Données de démonstration : 156 produits génériques, 7 laboratoires, 5 fournisseurs, 30 clients, stock initial avec
  lots périmés et proches de la péremption, 3 mois de réapprovisionnements (plusieurs utilisateurs et postes).

**Démonstration (critère de phase)** : une réception crée les bons lots ; la fiche de mouvement affiche le stock initial,
les mouvements avec utilisateur / date / heure et le solde exact. Tests d'intégration : `test/catalog-stock.test.ts`
(15 tests : coût avec UG, péremptions, unités, annulation, numérotation concurrente, fiche de mouvement, blocage de lot,
péremptions, stock à date, import, clients). Parcours vérifié dans le navigateur (Playwright).

## Phase 2 — Ventes et mouchard ✅

**Fait**

- **Écran de caisse** (`/pos`, F12) au clavier et au scanner : acheteur obligatoire (recherche nom / code / téléphone / CIN,
  création rapide, solde, crédit disponible, plafond restant, factures échues), ajout par code-barres ou recherche, aperçu
  des lots qui seront sortis (FEFO / FIFO), boîte ou unité, remise ligne ou globale, prix modifiable, lot forcé,
  équivalents en cas de rupture, ordonnance (prescripteur, numéro, date), vente en attente / reprise depuis tout poste,
  paiements multiples (espèces avec rendu, carte, chèque, virement, traite, avoir / crédit client, reste à crédit),
  validation idempotente, impression du ticket 80 mm ou de la facture A4, envoi de la facture par e-mail.
  Raccourcis F1, F2, F3, F4, F6, F8, F9, F10, Suppr, Échap. Panier persisté côté serveur (reprise après coupure).
- **Autorisation administrateur 🔑** réutilisable dans toute l'interface (remise, prix, lot forcé, crédit, modification).
- **Validation transactionnelle** : verrous ordonnés, allocation des lots, mouvements `SALE_OUT`, numéro `FAC-AAAA-NNNNNN`,
  règlements `REG-…`, écriture au compte client, mouvement de caisse, audit. Deux ventes simultanées sur le dernier article :
  une seule réussit.
- **Annulation et modification administrateur** (RG-11 à RG-13) : stock réintégré dans les lots d'origine, règlements
  remboursés par leur mode d'origine ou convertis en crédit, `SALE_CANCELLED` / `SALE_MODIFIED` (critique) avec l'état
  complet avant / après, notification immédiate de l'administrateur.
- **Historique des ventes** (recherche, filtres, totaux), détail complet (lots, règlements, e-mails, historique au mouchard),
  ventes en attente.
- **Sessions de caisse** : ouverture avec fond, mouvements (sortie, apport, retrait, tiroir sans vente), clôture par
  comptage à l'aveugle, écart calculé par le serveur, rapports X / Z (ticket PDF), alerte d'écart.
- **Documents PDF** : facture A4 (HT, TVA par taux, timbre, TTC, montant en toutes lettres, reste à payer, lots),
  ticket 80 mm, « DUPLICATA » / « ANNULÉE ».
- **E-mail** : configuration SMTP (mot de passe chiffré, test de connexion et d'envoi, erreurs en français), modèles MJML
  modifiables avec aperçu et restauration, file d'envoi transactionnelle avec reprises, quota horaire et journal (renvoyer,
  annuler), envoi automatique de la facture aux clients consentants, envoi manuel avec confirmation.
- **Notifications** : cloche, page des notifications, moteur d'abonnements (modes, employés suivis, seuils, hors horaires,
  anti-rafale), alertes « trop d'annulations / de retraits de lignes ».
- **Mouchard** : onglets Journal, **Ventes annulées** (avec total annulé), **Indicateurs par utilisateur**, historique d'un
  document, export Excel / PDF (tracé).
- **Démonstration** : 3 mois de ventes (plusieurs utilisateurs et postes), annulations, modifications, paniers abandonnés,
  retraits de lignes, remises hors plafond, ventes à crédit, sessions de caisse avec écarts.

**Démonstration (critère de phase)** : scénarios 1 et 2 (vente sur deux lots dans le bon ordre ; préparateur → annulation
refusée → administrateur annule → entrée au mouchard, stock réintégré) ; deux ventes simultanées sur le dernier article ;
facture PDF reçue par le serveur SMTP de test ; vente validée même SMTP coupé, e-mail réessayé puis envoyé au rétablissement
(`test/sales.test.ts`, 17 tests). Parcours vérifié dans le navigateur (Playwright).

## Phase 3 — Retours, avoirs, comptes clients, règlements ✅

- **Retours clients** (RG-14) : assistant en 3 étapes (facture d'origine → lignes et lots → remboursement), contrôle des
  quantités déjà retournées par ligne et par lot, arrondi proportionnel cumulé, timbre non remboursé. Destination selon
  l'état : remise en stock, **quarantaine** (lot `<lot>-RET`) ou destruction (entrée puis perte) ; lot périmé toujours
  non revendable. 🔑 requis pour un retour tardif, un produit non retournable ou l'approbation administrateur.
- **Avoirs** `AV-…` : imputés d'abord sur la facture ouverte, l'excédent devient un crédit client ; remboursement en
  espèces (administrateur, session de caisse ouverte) limité à cet excédent ; pas d'avoir pour le client comptoir.
- **Règlements** (RG-16) `REG-…` : imputation automatique (FIFO), manuelle ou acompte, règlement d'avoirs sans
  encaissement, annulation (contre-écriture en caisse), **chèques** (en portefeuille → déposé → encaissé / impayé),
  balance âgée, relevé de compte, reçus A4 / ticket avec « DUPLICATA ».
- **Fiche client** : onglets Ventes, Compte (mouvements et solde courant), Règlements, Avoirs, Relevé PDF / e-mail.
- **Interface** : pages Retours (liste, fiche, assistant), Règlements (liste, chèques, balance âgée), boîte d'envoi par
  e-mail réutilisable.
- **Démonstration** : retours (avoirs imputés ou crédit), règlements partiels, chèques dont un impayé, usage du crédit.

**Démonstration (critère de phase)** : scénarios 3 et 4 (retour partiel sur lot périmé puis quarantaine, avoir imputé ;
règlements multiples, chèque impayé) et 14 autres cas (`test/returns-payments.test.ts`, 16 tests).

## Phase 4 — Caisse, inventaire, ajustements, retours fournisseurs, alertes ✅

- **Sessions de caisse** : livrées en phase 2 (ouverture, comptage à l'aveugle, rapports X / Z, écart et alerte).
- **Inventaire** (§6.12) : complet ou partiel (catégorie, laboratoire, emplacement, sélection de produits),
  photographie du stock par lot, comptage à l'aveugle sur plusieurs postes en parallèle (scan ou saisie, boîtes +
  unités), écart calculé sur le théorique **au moment du comptage** de la ligne, ajout d'un lot absent, recomptage
  tracé, fin de comptage qui prévient l'administrateur, validation par corrections relatives
  (`INVENTORY_ADJUSTMENT`), annulation, rapport des écarts Excel et PDF, un seul inventaire ouvert par produit.
- **Ajustements** : perte, casse, destruction de périmés, correction ; déclaration par un préparateur (en attente),
  validation ou rejet par l'administrateur (numéro `AJ-…`), procès-verbal de destruction imprimable.
- **Retours fournisseurs** `RF-…` : sortie des lots, bon de retour imprimable, suivi de l'avoir fournisseur (attendu /
  reçu), annulation avec réintégration.
- **Rappel de lot** : recherche par numéro de lot, blocage à la vente, liste des clients concernés (nets des retours),
  retour fournisseur prérempli.
- **Mes notifications** : modes par événement (désactivé, cloche, e-mail immédiat, résumé quotidien / hebdomadaire),
  employés suivis, seuils, hors horaires, heures d'envoi ; règle des alertes critiques (au moins un administrateur
  reste abonné par e-mail).
- **Résumés et rapport d'activité** : résumé quotidien / hebdomadaire sans doublon, rapport d'activité quotidien par
  employé (e-mail et onglet « Activité du jour » du mouchard).
- **Réapprovisionnement** : suggestions (stock maximum, consommation moyenne, délai fournisseur), alertes de rupture et
  de passage sous le seuil à chaque franchissement.
- **Tâches planifiées** : cohérence du stock (RG-22), intégrité du journal (RG-20), péremptions, factures échues avec
  **relances** progressives, relevés mensuels ; une exécution par période, page d'administration avec lancement manuel.

**Démonstration (critère de phase)** : scénario 6 (inventaire partiel → comptage → ajustements corrects, y compris un
mouvement pendant le comptage) et scénario 7 (remise hors plafond : facture PDF reçue par le client, notification par
e-mail à l'administrateur, rapport d'activité exact) — `test/stock-ops.test.ts` (7 tests) et
`test/alerts-jobs.test.ts` (10 tests). La démonstration contient un inventaire validé, un inventaire en cours, des
ajustements, des retours fournisseurs et une première passe des tâches planifiées.

## Phase 5 — Statistiques, rapports, exports ✅

- **Tableau de bord** (§6.1) : administrateur — CA du jour / de la semaine / du mois (TTC, HT, ventes, panier moyen, marge
  et taux) avec comparaison à la période précédente, ventes des 30 derniers jours, encaissements du jour par mode, créances
  et factures échues, valeur du stock au coût et au prix de vente, alertes (ruptures, seuil minimum, périmés, péremptions
  à 30 / 60 / 90 jours, plafonds de crédit, écarts de caisse, annulations du jour), top 10 des produits du mois.
  Préparateur — ses ventes du jour (sans marge), ventes en attente, alertes de stock, accès à la caisse.
- **Centre de rapports** (§6.15) : 31 rapports partageant une même forme (indicateurs, graphique, tableau, totaux),
  filtrables par période avec comparaison période précédente / année précédente : chiffre d'affaires, ventes par
  utilisateur / client / catégorie / laboratoire / mode de paiement, carte de chaleur heure × jour, top produits, analyse
  ABC, marges par produit et par catégorie, valeur du stock, rotation et couverture, produits dormants, lots à risque de
  péremption, pertes, achats par fournisseur / produit / évolution des prix, retours par motif / utilisateur / produit,
  annulations, balance âgée, principaux débiteurs, encaissements, écarts de caisse.
- **Journaux et états réglementaires** : journal des ventes, des achats et des règlements, récapitulatif de TVA (collectée
  nette des avoirs, déductible), registre des produits à tableau (client, prescripteur, ordonnance), traçabilité d'un lot.
  Chaque rapport s'exporte en **Excel** et en **PDF** (tracé au mouchard) et s'imprime.
- **Commandes fournisseurs** (§6.3) : brouillon saisi ou généré d'après les suggestions de réapprovisionnement, envoi au
  fournisseur (numéro `BC-…`, PDF joint par e-mail, renvoi possible), réceptions rattachées avec **contrôle des quantités**
  (excédent, produit non commandé), statuts envoyée / partiellement reçue / reçue, clôture du reliquat, annulation tracée.

**Démonstration (critère de phase)** : chiffres des statistiques recoupés avec des calculs indépendants sur les ventes,
retours et annulations réels (`test/reports.test.ts`, 8 tests), commandes et réceptions rattachées
(`test/purchase-orders.test.ts`, 4 tests).

## Phase 6 — Durcissement et mise en recette ⏳

## Phase 7 — Logiciel de bureau (après validation de la cliente) ⏳
