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
packages/shared/src/        code partagé API / web
```
