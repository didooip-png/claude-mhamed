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

## Phase 2 — Ventes et mouchard ⏳

## Phase 3 — Retours, avoirs, comptes clients, règlements ⏳

## Phase 4 — Caisse, inventaire, ajustements, retours fournisseurs, alertes ⏳

## Phase 5 — Statistiques, rapports, exports ⏳

## Phase 6 — Durcissement et mise en recette ⏳

## Phase 7 — Logiciel de bureau (après validation de la cliente) ⏳
