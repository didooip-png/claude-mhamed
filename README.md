# PharmaStock

Logiciel de gestion de stock de médicaments (pharmacie / dépôt pharmaceutique) : lots et péremptions (FEFO/FIFO),
ventes au comptoir, clients et comptes, règlements, retours et avoirs, caisse, inventaires, mouchard, statistiques,
e-mails. Cahier des charges : [`docs/SPEC.md`](docs/SPEC.md) · Avancement : [`docs/PROGRESS.md`](docs/PROGRESS.md) ·
Décisions : [`docs/DECISIONS.md`](docs/DECISIONS.md).

- **Étape 1** (en cours) : application web (navigateur, installable en PWA).
- **Étape 2** : logiciel de bureau Windows (Electron) utilisant la même API et la même base.

## Prérequis

Node.js ≥ 22, pnpm 10, PostgreSQL 16 (via Docker : `docker compose up -d`, ou installé localement).

## Installation (développement)

```bash
pnpm install
docker compose up -d                          # PostgreSQL :5432 + Mailpit (SMTP :1025, interface http://localhost:8025)
cp .env.example apps/api/.env                 # adapter si besoin
pnpm --filter @pharmastock/shared build
pnpm --filter @pharmastock/api db:generate
pnpm --filter @pharmastock/api db:deploy
pnpm db:seed                                  # données de démonstration
pnpm dev                                      # API http://localhost:3000 · site http://localhost:5173
```

Au premier lancement, le site demande un **nom de poste** (ex. « Comptoir 1 »), puis l'écran de connexion.

### Comptes de démonstration (développement / recette uniquement)

| Code  | Identifiant | Mot de passe | PIN  | Rôle           |
| ----- | ----------- | ------------ | ---- | -------------- |
| ADM01 | `admin`     | `Admin2026`  | 1234 | Administrateur |
| PRE01 | `pre01`     | `Prep2026`   | 1111 | Préparateur    |
| PRE02 | `pre02`     | `Prep2026`   | 2222 | Préparateur    |

Ces comptes n'existent **jamais** en production : la première installation se fait avec `pnpm --filter @pharmastock/api cli setup`.

## Commandes

| Commande                                        | Rôle                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                                      | Paquet partagé (watch) + API + site                                             |
| `pnpm lint` / `pnpm format`                     | ESLint / Prettier                                                               |
| `pnpm typecheck`                                | Vérification des types de tout le monorepo                                      |
| `pnpm test`                                     | Tests unitaires et d'intégration (base `pharmastock_test`)                      |
| `pnpm build`                                    | Build de production                                                             |
| `pnpm db:seed`                                  | Données de démonstration                                                        |
| `pnpm --filter @pharmastock/api cli <commande>` | `setup`, `devices`, `approve-device <id>`, `unlock-user <code>`, `verify-audit` |
