# CLAUDE.md — mémoire du projet PharmaStock

Logiciel de gestion de stock de médicaments (pharmacie / dépôt, Tunisie). Référence fonctionnelle :
`docs/SPEC.md` (copie intégrale du cahier des charges). Avancement : `docs/PROGRESS.md`. Décisions
non prévues par le cahier : `docs/DECISIONS.md` (à compléter à chaque nouvelle décision).

## Stack

- Monorepo pnpm, TypeScript 6 strict partout, ESM (`"type": "module"`, imports relatifs en `.js`).
- `packages/shared` : schémas Zod, permissions, paramètres, codes d'erreur, événements d'audit,
  module `money`, calculs de vente/réception (`pricing.ts`), dates. Compilé vers `dist/` pour l'API ;
  le frontend l'importe directement depuis `src/` (alias Vite).
- `apps/api` : NestJS 12 + Prisma 7 (adaptateur `@prisma/adapter-pg`), PostgreSQL 16.
  Client Prisma généré dans `apps/api/src/generated/prisma` (non versionné).
- `apps/web` : React 19 + Vite 8 + React Router 8 + TanStack Query 5 / Table 8 + Tailwind 4
  (composants façon shadcn/ui sur `radix-ui`), sonner, cmdk. SPA statique (pas de SSR).
- Tests : Vitest (shared, API avec vraie base PostgreSQL `pharmastock_test`), Playwright (E2E).

## Commandes utiles

```bash
pnpm install
docker compose up -d                       # PostgreSQL + Mailpit (ou PostgreSQL local)
cp .env.example apps/api/.env
pnpm --filter @pharmastock/shared build    # à relancer après toute modification de shared (ou pnpm dev)
pnpm --filter @pharmastock/api db:generate # client Prisma
pnpm --filter @pharmastock/api db:deploy   # migrations
pnpm db:seed                               # données de démonstration (dev / recette uniquement)
pnpm dev                                   # shared (watch) + API :3000 + web :5173
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @pharmastock/api cli setup   # première installation (production)
pnpm docs:build                            # manuels PDF, mémo, FAQ (captures automatiques, base pharmastock_docs)
pnpm --filter @pharmastock/desktop smoke   # application Windows : vérification de bout en bout (xvfb-run -a sous Linux)
```

Comptes de démonstration (seed) : `admin` / `Admin2026` (ADM01, PIN 1234), `pre01` / `Prep2026`
(PRE01, PIN 1111), `pre02` / `Prep2026` (PRE02, PIN 2222).

## Règles métier clés (non négociables — §4, §8)

- Montants en millimes (entiers, `BIGINT`), jamais de float ; tout calcul passe par `money.ts`
  (arrondi half-up symétrique) ou `pricing.ts`. Quantités entières en unité de base.
- Horodatage : uniquement l'horloge serveur via `common/clock.ts` (`now()`), jamais l'heure du poste.
- Rien de validé ne se supprime : annulation = statut + contre-mouvements + audit.
- Stock jamais négatif (CHECK en base + contrôle applicatif), lots périmés/bloqués jamais vendus.
- `stock_movements`, `audit_logs`, `client_ledger` : ajout seul (triggers). Toute écriture de stock ou
  d'argent se fait dans `prisma.tx()` avec verrous `FOR UPDATE` (produits dans un ordre déterministe).
- Numéros de documents via `SequencesService.next(tx, type)` dans la transaction de validation.
- Audit : `audit.record(tx, …)` dans la transaction métier ; l'écriture est différée juste avant le
  COMMIT (hook `beforeCommit`) et chaînée par SHA-256 (RG-20). Ne jamais utiliser
  `prisma.$transaction` directement pour une opération auditée : utiliser `prisma.tx()`.
- Permissions vérifiées côté serveur (`@RequirePermission`, `SecurityGuard`) ; actions 🔑 via
  `OverrideRequirements` + `OverrideService.resolve()` (erreur `OVERRIDE_REQUIRED` → le frontend
  redemande avec `override: { userCode, pin, reason }`).
- Erreurs métier : `throw new AppError('CODE', details)` (codes et messages FR dans `shared/errors.ts`).
- Ventes / caisse : ordre des verrous vente → client → produits (triés) → lots (triés) → session de
  caisse → séquences → audit (en fin de transaction). Le compte client passe par `LedgerService.post`,
  les encaissements par `PaymentsCoreService.create`, les mouvements d'espèces par `CashService`.
- E-mail : jamais d'envoi direct dans une opération métier ; `EmailOutboxService.queueDocument(tx, …)`
  insère dans la file (même transaction). Le corps des e-mails clients ne cite jamais de médicament.
- Notifications : `audit.record(tx, { notify: … })` alimente `notification_events` ; le catalogue des
  événements notifiables et leurs modes par défaut sont dans `packages/shared/src/notifications.ts`.
- Interface : une action pouvant exiger 🔑 s'appelle via `withOverride(async (override) => api…)`
  (`components/override-dialog.tsx`). Libellé produit : `productLabel()` (évite le dosage en double).
- Seed : les variables d'environnement (`DISABLE_SCHEDULER`) doivent être posées avant les imports
  dynamiques ; les tâches planifiées ne doivent pas tourner pendant le seed.
- Tests : tous les fichiers partagent la même base de test. Un fichier qui change un état global (SMTP
  activé, paramètres) le rétablit dans `afterAll`, et cherche ses e-mails par destinataire.
- Stock : tout mouvement passe par `StockService.move` (verrous produits puis lots, soldes, alertes de
  rupture au franchissement). Aucun autre code n'écrit `remaining_qty`.
- Tâches planifiées : `JobsService` (une exécution par tâche et par période, `job_runs`) ; les résumés
  passent par `DigestService` (`digest_runs`). Toute nouvelle tâche s'ajoute à la liste `jobs`.
- Sauvegardes : `BackupService` (`pg_dump` + `pg_restore --list`, copie S3 SigV4, purge) ; tâche
  `database-backup` ; les répertoires `backups/` sont ignorés par git **uniquement à la racine et sous
  `apps/api/storage/`** (le module `src/modules/backups` doit rester versionné).
- Base en production : deux comptes (propriétaire pour les migrations, `pharmastock_app` pour l'API).
  Toute nouvelle table se termine par `SELECT pharmastock_apply_app_grants();` ; les journaux en ajout
  seul ne reçoivent jamais `UPDATE`/`DELETE`.
- Nouvelle route API : elle doit porter `@RequirePermission(...)`, sinon elle doit être ajoutée à la liste
  fermée de `test/route-permissions.test.ts` (avec la raison). Ce test exécute l'audit des 401/403.
- Recherche SQL sur de gros volumes : ne jamais mettre d'`OR` entre un `LIKE` indexé et une sous-requête
  (parcours complet) ; résoudre les voies exactes d'abord, puis le texte, puis la tolérance aux fautes.
  Mesurer avec `pnpm --filter @pharmastock/api test:load` (`LOAD_REUSE=1` pour ne pas régénérer les données).
- Interface : CSP sans `unsafe-eval` → pas de `eval`/`new Function` (Zod est en mode `jitless` via
  `public/zod-init.js`). Les listes de suggestions ne se ferment pas si le champ a repris le focus.
- E2E (`e2e/`, Playwright) : données préparées par l'API (`support/data.ts`), parcours vérifié par l'interface ;
  attendre la réponse serveur (`waitForResponse`) avant de payer un panier modifié ; boîte mail factice
  `support/mail-sink.mjs`. Ne jamais lancer deux exécutions en même temps (ports 3300, 5273, 8026, 2525).
- Shell : ne jamais `pkill -f` un motif qui figure dans sa propre ligne de commande (le shell se tue) ;
  arrêter l'API par son fichier PID (`restart-api.sh`).

- Aide et documentation : **une seule source** — `packages/shared/src/help` (fiches par écran et par rôle, FAQ,
  mémo, visite guidée). Toute nouvelle page ou action visible ajoute/adapte sa fiche (`routes`, `steps`, libellés
  exacts de l'interface) et sa scène de capture dans `tools/docs/lib/scenes.mjs`, puis `pnpm docs:build` régénère
  `docs/manuels/` (PDF versionnés, copiés dans `apps/web/public/manuels/`). Un champ difficile reçoit
  `FormField help="…"`. Le libellé du bouton « ? » d'un champ reste « Aide sur ce champ » (pas le nom du champ).
- Visite guidée : cibles `data-tour="…"` (menu, recherche, cloche, profil, aide) ; `localStorage
pharmastock.tour.disabled=1` la coupe (tests E2E, captures). Elle est déjà posée dans `e2e/support/ui.ts`.
- Application de bureau (`apps/desktop`, `docs/DESKTOP.md`) : le site local (`app://pharmastock`) appelle `/api/…`,
  relayé par le processus principal (cookie de renouvellement géré là, `SameSite=Strict` oblige). Toute nouvelle
  fonction du pont `window.pharmastockDesktop` se déclare dans `src/preload.ts`, `src/main.ts` (contrôle
  `trusted(event)`) et `apps/web/src/lib/platform.ts`. Vérifier avec `pnpm --filter @pharmastock/desktop smoke`.
- Installation PWA / téléphone : composants `useIsMobile`, `install.ts` ; un débordement horizontal se corrige avec
  `min-w-0` (règle `.grid > *` déjà en base), jamais avec `overflow-x: hidden` sur la page.

## Conventions

- Code, tables, routes en anglais ; interface, messages, documents en français.
- API REST `/api/v1`, actions métier explicites (`POST /sales/:id/validate`…), erreurs `{ code, message, details }`.
- En-têtes : `X-Device-Id` + `X-Device-Token` (poste), `Authorization: Bearer`, `Idempotency-Key`,
  `X-Background: 1` (sondages, ne comptent pas comme activité).
- Logique métier dans les services de domaine, jamais dans les contrôleurs ni les composants React.
- Frontend : aucun bouton factice ; une route n'apparaît dans le menu que si elle figure dans
  `AVAILABLE_ROUTES` (`apps/web/src/components/layout/nav.ts`).
- Commits : Conventional Commits (`feat:`, `fix:`…).

## Structure

```
apps/api/prisma/            schema.prisma, migrations (init + integrity : CHECK, triggers, trigram), seed
apps/api/src/common/        erreurs, garde de sécurité, contexte de requête, horloge, crypto, zod
apps/api/src/modules/       un dossier par domaine (auth, users, roles, devices, settings, audit…)
apps/api/test/              tests d'intégration (TestContext : app Nest + supertest + base de test)
apps/web/src/components/    ui/ (primitives), layout/ (coquille, navigation), data-table, form
apps/web/src/lib/           api (fetch + renouvellement), auth, device, platform (§14), format
apps/web/src/pages/         écrans par domaine
apps/desktop/               application Windows (Electron) : src/ (principal, préchargements, réglages), scripts/, test/
tools/docs/                 générateur des manuels PDF (captures Playwright + PDF), lancé par `pnpm docs:build`
packages/shared/src/        code partagé API / web (help/ : contenu d'aide, FAQ, mémo, visite guidée)
```
