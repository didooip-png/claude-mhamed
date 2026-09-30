# Contexte pour Claude Code — héberger PharmaStock sur un VPS

> Ce document est **ton guide**. Il résume le projet, l'état exact du code, ce qui a été fait et décidé, comment déployer
> pas à pas, comment vérifier, et ce qui n'a pas pu être validé avant la livraison. Le propriétaire n'est pas
> informaticien : parle-lui en **français**, simplement, et demande avant toute action irréversible.

## 0. Ta mission

Installer **réellement** PharmaStock sur ce serveur : HTTPS avec le nom de domaine du propriétaire, e-mails, sauvegardes,
pare-feu, puis **prouver** que tout fonctionne (script `migration/scripts/verifier-deploiement.sh`). Tu ne développes pas de
nouvelles fonctions : le logiciel est terminé et testé. Si tu dois toucher au code (correctif de déploiement), dis-le au
propriétaire, fais un commit `fix:` isolé et relance les tests concernés.

**Règles d'or**

1. **Aucun secret dans un fichier versionné, un commit, un journal ou la conversation.** `.env.production` n'est jamais
   commité (il est ignoré par git) ; ne l'affiche pas (`cat`), ne le colle pas dans le chat.
2. Le **mot de passe et le PIN du premier administrateur** sont saisis par le propriétaire lui-même dans le terminal
   (commande interactive `cli setup`). Le **mot de passe SMTP** est saisi par le propriétaire dans l'interface du site
   (_Administration → E-mail & notifications_) ; il est stocké chiffré en base (AES-256-GCM, clé `APP_ENCRYPTION_KEY`).
3. **Ne jamais** lancer `docker compose down -v`, `docker volume rm`, `DROP DATABASE` ni supprimer `pgdata` sans accord explicite
   et une sauvegarde vérifiée : cela efface les données de la pharmacie.
4. **Pas de données de démonstration en production** (`pnpm db:seed` est refusé en production, ne le contourne pas).
5. Avant chaque mise à jour, laisser le point d'entrée faire la **sauvegarde préalable** (c'est automatique) ; ne le désactive pas.

## 1. Le projet en bref

- **PharmaStock** : gestion de stock de médicaments (pharmacie / dépôt), Tunisie. Interface, messages et documents en
  **français** ; monnaie : dinar tunisien, **montants en millimes (entiers)**, jamais de nombres flottants ; fuseau
  `Africa/Tunis` ; horloge **serveur** uniquement.
- Fonctions : lots et péremptions (FEFO), ventes au comptoir (caisse), clients et comptes, règlements/lettrage, retours et
  avoirs, sessions de caisse « à l'aveugle », inventaires, ajustements, commandes et retours fournisseurs, rappel de lot,
  mouchard infalsifiable (chaînage SHA-256), statistiques et rapports (Excel/PDF), e-mails (file d'envoi, reprises),
  notifications, sauvegardes, rôles et permissions, postes de travail approuvés, 2FA (TOTP) administrateur.
- Interfaces : **site web** (React, installable sur téléphone/PC en PWA, affichage optimisé mobile), **aide intégrée**
  (bouton « ? », visite guidée, FAQ), **application Windows** (Electron) pour les postes de caisse.
- Cahier des charges complet : `docs/SPEC.md`. Avancement : `docs/PROGRESS.md`. Décisions (M1…M76) : `docs/DECISIONS.md`.
  Mémoire technique et règles non négociables : `CLAUDE.md` (lis-le).

## 2. Architecture et carte du dépôt

```
Navigateur / PWA / app Windows ──HTTPS──▶ Caddy (conteneur « web ») ──/api/*──▶ API NestJS ──▶ PostgreSQL 16
```

| Chemin                               | Rôle                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `apps/api`                           | NestJS 12 + Prisma 7 (adaptateur `pg`). Migrations : `prisma/migrations`. CLI d'exploitation : `src/cli.ts`. |
| `apps/web`                           | React 19 + Vite 8 + Tailwind 4 + TanStack. SPA statique servie par Caddy.                                    |
| `apps/desktop`                       | Application Windows (Electron). Installateur construit par GitHub Actions (`.github/workflows/desktop.yml`). |
| `packages/shared`                    | Schémas Zod, permissions, erreurs, calculs (`money`, `pricing`), **contenu d'aide** (`help/`).               |
| `e2e`                                | Tests de bout en bout Playwright (8 scénarios).                                                              |
| `tools/docs`                         | Générateur des manuels PDF (`pnpm docs:build`) — **inutile pour déployer** : les PDF sont déjà versionnés.   |
| `docker/`, `docker-compose.prod.yml` | Déploiement : `postgres`, `api`, `web` (Caddy). Seul `web` publie 80/443.                                    |
| `docs/`                              | `EXPLOITATION.md` (ton manuel d'exploitation), `GUIDE_UTILISATEUR.md`, `DESKTOP.md`, `manuels/*.pdf`.        |
| `migration/`                         | Ce document, les scripts de préparation du VPS, de génération des secrets, de vérification.                  |

Deux comptes PostgreSQL en production : propriétaire (migrations, sauvegarde préalable) et `pharmastock_app` (API), ce
dernier sans `UPDATE/DELETE` sur les journaux en ajout seul. L'API tourne en **une seule instance** (tâches planifiées).

## 3. État du code livré

- Phases 0 à 7 terminées (voir `docs/PROGRESS.md`). Aucune fonction du cahier des charges de l'étape 1 n'est laissée de côté.
- **Tests** : API (tests d'intégration sur vraie base PostgreSQL), paquet partagé, application de bureau, 8 scénarios E2E
  Playwright. La **CI GitHub** (`.github/workflows/ci.yml`) exécute lint, format, typecheck, tests, build, **construction
  des images Docker + démarrage de la pile + vérifications HTTP + sauvegarde**, et les E2E : ces jobs passent (dont le
  job `docker`, qui prouve que `docker compose -f docker-compose.prod.yml build/up` fonctionne sur un Linux neuf).
- **Documentation utilisateur** : manuels PDF Administrateur/Préparateur, aide-mémoire d'une page, FAQ (générés depuis le
  logiciel avec captures automatiques), aussi servis par le site sous `/manuels/…`.
- Historique lisible : `HISTORIQUE.txt` (liste des commits) ; historique Git complet sur GitHub (branche `claude/intelligent-faraday-dj0t2k`) ou dans le fichier facultatif `PharmaStock-historique-*.git.bundle`.

### Ce qui n'a PAS pu être vérifié (à valider chez le propriétaire — c'est ta check-list de recette)

| #   | Point                                                                       | Comment le valider                                                                                                                                                                |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Certificat HTTPS Let's Encrypt avec le vrai domaine                         | DNS `A` → IP du VPS, ports 80/443 ouverts ; `verifier-deploiement.sh` (certificat, HSTS, redirection HTTP→HTTPS).                                                                 |
| 2   | Envoi d'e-mails avec le vrai SMTP, et **délivrabilité**                     | Le propriétaire configure le SMTP dans le site, « Tester la connexion » puis e-mail de test reçu (hors spam). Conseiller SPF/DKIM/DMARC (`docs/EXPLOITATION.md` §10).             |
| 3   | Copie de sauvegarde **hors serveur** (S3)                                   | Renseigner `S3_*` dans `.env.production` (si le propriétaire a un stockage), redémarrer l'API, `cli backup`, vérifier « Copie hors site » dans _Administration → Sauvegardes_.    |
| 4   | **Restauration** réelle d'une sauvegarde                                    | Rejouer `docs/EXPLOITATION.md` §7.1 (test à blanc) une fois.                                                                                                                      |
| 5   | Imprimante de tickets, tiroir-caisse, mises à jour de l'application Windows | `docs/DESKTOP.md` (recette). Exige du matériel : sur place.                                                                                                                       |
| 6   | Application Windows sur un vrai PC                                          | La construction depuis Linux (paquet portable `.zip`) est vérifiée jusqu'au contenu du paquet ; le lancement sur Windows est à valider sur un poste (`docs/DESKTOP.md`, recette). |
| 7   | Performances sur ce VPS                                                     | Objectifs testés en développement (recherche produit < 200 ms…) ; contrôle rapide au ressenti + `docs/EXPLOITATION.md` §12.                                                       |

## 4. Déploiement pas à pas

Répertoire de travail : la racine du dépôt (`code/` dans le dossier de migration). Le propriétaire a déjà lancé
`migration/scripts/vps-preparer.sh` (Docker, pare-feu, fuseau) — sinon, propose-le (et lis le script avant de l'exécuter).

**Étape 1 — Contrôles préalables**

```bash
docker --version && docker compose version         # Docker ≥ 24
df -h / && free -m                                  # ≥ 20 Go libres, ≥ 2 Go de RAM (4 Go conseillés)
dig +short <domaine> A                              # doit renvoyer l'IP publique de CE serveur
curl -s https://ifconfig.me                         # IP publique du serveur
```

Si le DNS ne pointe pas encore ici : arrête-toi et explique-le au propriétaire (sans DNS correct, Caddy n'obtient pas de certificat
et risque d'être limité par Let's Encrypt).

**Étape 2 — Secrets**

```bash
bash migration/scripts/generer-env.sh <domaine>     # crée .env.production (600) + ~/pharmastock-secrets-A-SAUVEGARDER.txt
```

Ne lis pas ces fichiers à voix haute dans la conversation. Dis au propriétaire de récupérer
`~/pharmastock-secrets-A-SAUVEGARDER.txt` avec `scp` et de le ranger dans un gestionnaire de mots de passe.
Variables facultatives à proposer : `S3_*` (copie hors site), `BACKUP_TIME`, `BACKUP_RETENTION_DAYS`, `TZ`. Le mot de passe SMTP n'y figure **pas**.

**Étape 3 — Construire et démarrer**

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC up -d --build
$DC ps                       # postgres, api, web : « healthy » / « running » (l'API met ~30 s à devenir saine)
$DC logs --tail 50 api       # doit montrer les migrations appliquées, sans erreur
```

Au premier démarrage l'API crée le schéma, le rôle `pharmastock_app` et ses droits. Si la construction échoue, lis l'erreur ;
les images se construisent aussi dans la CI, donc une erreur vient presque sûrement du serveur (mémoire, réseau, disque).

**Étape 4 — Premier administrateur (le propriétaire tape les secrets)**

```bash
$DC exec api node dist/src/cli.js setup
```

La commande est interactive (nom de l'établissement, code ex. `ADM01`, identifiant, nom complet, mot de passe ≥ 8 caractères avec
lettre + chiffre, PIN 4–6 chiffres). Demande au propriétaire de la lancer **lui-même** dans son terminal si ton outil ne permet pas
de saisie masquée. Ne jamais faire passer ces valeurs par le chat ni par des arguments de ligne de commande.

**Étape 5 — Vérifier**

```bash
bash migration/scripts/verifier-deploiement.sh --sauvegarde
```

Tout doit être « OK ». Puis le propriétaire ouvre `https://<domaine>` : écran « Enregistrer ce poste » (nom du poste, ex. « Comptoir 1 »), se
connecte. Le **premier poste utilisé par un administrateur est approuvé automatiquement** ; les suivants sont approuvés dans
_Administration → Postes de travail_ (ou `cli devices` / `cli approve-device <id>`).

**Étape 6 — Configuration métier avec le propriétaire (dans le site)**

1. _Administration → Paramètres → Établissement_ : nom, adresse, matricule fiscal, mentions légales.
2. _Administration → E-mail & notifications_ : SMTP (hôte, port 465 SSL/TLS ou 587 STARTTLS, identifiant, mot de passe, expéditeur) →
   « Tester la connexion » → e-mail de test → activer l'envoi. Suggérer d'ajouter une adresse en « copie cachée d'archivage ».
3. _Administration → Utilisateurs_ : un compte par personne (rôle _Préparateur_ ou rôles personnalisés), mots de passe provisoires
   remis en main propre (changement forcé à la première connexion).
4. _Administration → Sauvegardes_ : « Sauvegarder maintenant », vérifier l'état « Réussie ».
5. _Mon compte_ (administrateur) : activer la **double authentification** (TOTP) — fortement conseillé, le site est public.
6. Catalogue : import Excel/CSV des produits (_Catalogue → Produits → Importer_), fournisseurs, clients ; stock initial par **réception**
   (jamais par ajustement) ou inventaire.
7. Remettre l'**aide-mémoire** (`docs/manuels/PharmaStock-Aide-memoire-Preparateur.pdf`) à imprimer, et les manuels.

**Étape 7 — Application Windows des postes de caisse (facultatif, à proposer)**
Elle se construit **sur ce VPS Linux** (pas besoin de GitHub ni de Windows) :

```bash
# Node.js 22 + pnpm requis (sinon : curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs && sudo corepack enable)
bash migration/scripts/construire-application-windows.sh        # → apps/desktop/release/PharmaStock-X.Y.Z-win-x64.zip
```

Le propriétaire récupère le `.zip` (`scp`), le décompresse sur le PC de caisse et lance `PharmaStock.exe` ; au premier
lancement il saisit l'adresse du serveur (`https://<domaine>`) et choisit l'imprimante (`docs/DESKTOP.md`). L'option
`--installateur` (NSIS, mises à jour automatiques) demande Wine. Ne pas activer de CORS : l'application passe par un relais interne.

**Étape 8 — Durcissement et exploitation (à proposer, avec accord)**

- Vérifier `ufw status` (22, 80, 443 seulement) ; `fail2ban` actif ; mises à jour automatiques activées.
- Limiter SSH (clé plutôt que mot de passe, `PermitRootLogin prohibit-password`) **seulement** si le propriétaire a déjà une clé qui fonctionne.
- Supervision externe gratuite (UptimeRobot, Better Stack…) sur `https://<domaine>/api/v1/health`.
- Copie hors site des sauvegardes (S3) ; tâche `cron` de rappel mensuel « télécharger une sauvegarde ».
- Documenter dans un fichier local (hors dépôt) : IP, domaine, hébergeur, date d'installation, version (`git rev-parse HEAD`).

## 5. Commandes utiles (toutes depuis la racine du dépôt)

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC ps ; $DC logs -f --tail 100 api ; $DC restart api
$DC exec api node dist/src/cli.js <commande>       # setup | devices | approve-device <id> | unlock-user <CODE> |
                                                    # reset-credentials <CODE> | verify-audit | backup
$DC exec postgres psql -U pharmastock -d pharmastock -c '\dt'      # inspection (lecture)
```

Mise à jour du logiciel : récupérer le nouveau code (git pull / nouvelle archive), puis `$DC up -d --build` — le démarrage de
l'API **sauvegarde avant de migrer** et s'arrête si la sauvegarde échoue (base intacte). Détails : `docs/EXPLOITATION.md` §5.

## 6. Ce qu'il faut savoir si tu dois modifier le code

- Lire `CLAUDE.md` avant tout : règles non négociables (montants en millimes, aucun float, horloge serveur, journaux en ajout seul,
  toute écriture de stock via `StockService.move`, transactions `prisma.tx()`, audit différé, permissions `@RequirePermission`…).
- Toute nouvelle route API porte `@RequirePermission(...)` (sinon le test d'audit des routes échoue).
- Toute nouvelle table se termine par `SELECT pharmastock_apply_app_grants();`.
- Aide intégrée = **une seule source** : `packages/shared/src/help` ; régénérer les manuels avec `pnpm docs:build` (machine de développement).
- Tests : `pnpm lint && pnpm typecheck && pnpm test` ; E2E : `pnpm test:e2e` (ne jamais en lancer deux à la fois).
- Commits : Conventional Commits (`feat:`, `fix:`…).

## 7. Erreurs fréquentes au déploiement

| Symptôme                                      | Cause probable                                                                          | Action                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pas de cadenas HTTPS / erreur de certificat   | DNS pas propagé, ports 80/443 fermés chez l'hébergeur, domaine faux dans `SITE_ADDRESS` | `dig`, pare-feu de l'hébergeur (panneau web), `$DC logs web`                                                 |
| Connexion impossible en HTTP                  | Cookie `Secure`                                                                         | Utiliser HTTPS ; `COOKIE_SECURE=false` **uniquement** en réseau local                                        |
| `api` redémarre en boucle                     | Secret manquant, mémoire insuffisante, sauvegarde préalable impossible (disque)         | `$DC logs api`, `df -h`, `free -m`                                                                           |
| « Poste en attente d'approbation »            | Nouveau navigateur/appareil                                                             | _Postes de travail → Approuver_ ou `cli approve-device`                                                      |
| E-mails non partis                            | SMTP désactivé/non testé, port sortant bloqué par l'hébergeur (25/465/587)              | _Journal des e-mails_ (erreur exacte), tester un autre port, demander à l'hébergeur d'ouvrir le SMTP sortant |
| Compte verrouillé                             | Trop d'essais                                                                           | _Utilisateurs → Déverrouiller_ ou `cli unlock-user <CODE>`                                                   |
| Mot de passe de l'unique administrateur perdu | —                                                                                       | `cli reset-credentials <CODE>` (propriétaire présent)                                                        |
| Disque plein                                  | Sauvegardes/journaux Docker                                                             | `docs/EXPLOITATION.md` §14                                                                                   |

## 8. Ton compte rendu final au propriétaire

À la fin, donne-lui, en français et sans jargon : (1) l'adresse du site ; (2) le résultat du script de vérification ;
(3) la liste de ses tâches (clé de chiffrement à ranger, copie hors site, comptes de l'équipe, essai de restauration,
impression de l'aide-mémoire, installation de l'application Windows sur les postes de caisse) ; (4) les points de recette de la section 3 qui
restent ouverts ; (5) comment te redemander de l'aide (« relance Claude Code dans ce dossier »).
