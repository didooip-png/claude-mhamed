# PharmaStock

Logiciel de gestion de stock de médicaments (pharmacie / dépôt pharmaceutique) : lots et péremptions (FEFO/FIFO),
ventes au comptoir, clients et comptes, règlements, retours et avoirs, caisse, inventaires, commandes fournisseurs,
mouchard infalsifiable, statistiques et rapports, e-mails, sauvegardes.

| Document                                                                          | Contenu                                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`docs/GUIDE_UTILISATEUR.md`](docs/GUIDE_UTILISATEUR.md)                          | Mode d'emploi pour l'équipe (préparateurs, administrateur), avec captures d'écran            |
| [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md)                                    | Installation Docker, HTTPS, mises à jour, sauvegardes et restauration, supervision, sécurité |
| [`docs/SPEC.md`](docs/SPEC.md)                                                    | Cahier des charges                                                                           |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) · [`docs/DECISIONS.md`](docs/DECISIONS.md) | Avancement par phase · décisions d'architecture et de gestion                                |

- **Étape 1** (terminée, en recette) : application web (navigateur, installable en PWA).
- **Étape 2** (à venir) : logiciel de bureau Windows (Electron) utilisant la même API et la même base.

## Déploiement en production

Docker Compose (PostgreSQL 16 + API + Caddy en HTTPS automatique) : voir [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md).

```bash
cp .env.production.example .env.production        # renseigner domaine et secrets
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/src/cli.js setup
```

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

### Tester l'envoi d'e-mails en développement

Mailpit (interface <http://localhost:8025>) reçoit tous les e-mails. Dans **Administration → E-mail & notifications**,
saisir l'hôte `localhost`, le port `1025`, la sécurité « Aucune », un expéditeur (ex. `factures@example.com`),
activer l'envoi, enregistrer, puis « Tester la connexion ». Les clients de démonstration avec adresse `@example.com`
et consentement reçoivent leur facture PDF à la validation d'une vente.

Ces comptes n'existent **jamais** en production : la première installation se fait avec `pnpm --filter @pharmastock/api cli setup`.

## Commandes

| Commande                                        | Rôle                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`                                      | Paquet partagé (watch) + API + site                                                       |
| `pnpm lint` / `pnpm format`                     | ESLint / Prettier                                                                         |
| `pnpm typecheck`                                | Vérification des types de tout le monorepo                                                |
| `pnpm test`                                     | Tests unitaires et d'intégration (base `pharmastock_test`)                                |
| `pnpm --filter @pharmastock/api test:load`      | Tests de charge (50 000 produits, 1 M de mouvements, base `pharmastock_load`)             |
| `pnpm --filter @pharmastock/e2e e2e`            | Tests de bout en bout Playwright (API + site + boîte mail factice)                        |
| `pnpm build`                                    | Build de production                                                                       |
| `pnpm db:seed`                                  | Données de démonstration                                                                  |
| `pnpm --filter @pharmastock/api cli <commande>` | `setup`, `devices`, `approve-device <id>`, `unlock-user <code>`, `verify-audit`, `backup` |
