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

## Phase 1 — Catalogue, tiers, réceptions, stock ⏳
## Phase 2 — Ventes et mouchard ⏳
## Phase 3 — Retours, avoirs, comptes clients, règlements ⏳
## Phase 4 — Caisse, inventaire, ajustements, retours fournisseurs, alertes ⏳
## Phase 5 — Statistiques, rapports, exports ⏳
## Phase 6 — Durcissement et mise en recette ⏳
## Phase 7 — Logiciel de bureau (après validation de la cliente) ⏳
