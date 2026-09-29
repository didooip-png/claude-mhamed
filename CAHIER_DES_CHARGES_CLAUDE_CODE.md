# CAHIER DES CHARGES — LOGICIEL DE GESTION DE STOCK DE MÉDICAMENTS

**Nom de code provisoire : PharmaStock** (modifiable : branding et nom paramétrables)
**Version du document : 1.1 — 30/09/2026** (ajout : messagerie e-mail SMTP et notifications, §6.19)
**Destinataire : Claude Code (développement)**
**Langue de l'interface : français**

---

## 0. INSTRUCTIONS POUR CLAUDE CODE — À LIRE EN PREMIER

Tu vas développer une application professionnelle de gestion de stock de médicaments, destinée à un usage réel en pharmacie ou dépôt pharmaceutique en Tunisie. Ce n'est ni un prototype ni une démo. La fiabilité des stocks, la traçabilité des opérations et l'exactitude financière priment sur tout le reste.

### Méthode de travail obligatoire

1. Lis ce document **en entier** avant d'écrire la moindre ligne de code.
2. Commence par un **plan d'implémentation** (architecture, schéma de données, découpage en phases) et présente-le avant de coder.
3. Crée à la racine du projet :
   - `CLAUDE.md` : mémoire du projet (stack, conventions, commandes utiles, règles métier clés, structure des dossiers). Tiens-le à jour.
   - `docs/SPEC.md` : copie intégrale de ce document (référence).
   - `docs/PROGRESS.md` : avancement phase par phase (fait / en cours / reste à faire).
   - `docs/DECISIONS.md` : toute décision technique ou métier non prévue ici, avec sa justification.
4. Travaille **phase par phase** (§15). Une phase n'est terminée que si :
   - migrations et seed passent sans erreur ;
   - lint et typecheck sont propres ;
   - les tests sont verts ;
   - les fonctionnalités sont réellement opérationnelles de bout en bout (aucun bouton factice, aucun `TODO` dans un chemin critique, aucune donnée codée en dur) ;
   - un résumé est ajouté dans `docs/PROGRESS.md`.
   Fais un commit Git par étape significative (Conventional Commits : `feat:`, `fix:`, `refactor:`…).
5. Les **règles de gestion (§8, préfixe RG-)** sont non négociables. En cas d'ambiguïté, choisis l'option qui préserve le mieux la traçabilité et l'intégrité des données, note-la dans `DECISIONS.md` et continue. Ne pose une question que si elle est réellement bloquante.
6. Code, noms de variables, tables et routes API **en anglais**. Interface, messages d'erreur, documents imprimés et documentation utilisateur **en français**.
7. Toute règle de sécurité ou de permission est appliquée **côté serveur**. Le frontend se contente de masquer ce que l'utilisateur n'a pas le droit de faire.
8. Utilise les **versions stables actuelles** des bibliothèques citées. Pas de bibliothèque abandonnée ou expérimentale.

### Prérequis du poste de développement

Node.js LTS (≥ 22), pnpm, Docker Desktop (pour PostgreSQL), Git.

---

## 1. CONTEXTE ET OBJECTIFS

La cliente veut un logiciel « installable sur PC » pour gérer le stock de médicaments de son établissement. **Les données sont centralisées en ligne** (serveur + base de données hébergés). L'application sur le poste n'est qu'une interface : plusieurs postes travaillent simultanément sur les mêmes données, et rien n'est perdu si un PC tombe en panne.

### Démarche en deux étapes

- **Étape 1 — Application web** (navigateur), installable en PWA, déployée sur un serveur de recette pour validation par la cliente.
- **Étape 2 — Logiciel de bureau** après validation : application Windows (Electron) avec installateur, mises à jour automatiques et impression directe des tickets. Elle utilise **la même API et la même base de données**. Le frontend doit donc être conçu dès le départ pour être empaqueté sans réécriture (§14).

### Besoins exprimés par la cliente (tous obligatoires)

1. Gestion de stock de médicaments respectant la règle FIFO.
2. Gestion des dates de péremption.
3. Consultation du mouvement d'un produit depuis une date choisie : ventes et achats avec leurs détails (qui a fait l'opération, date et heure).
4. Un code pour chaque utilisateur.
5. Date et heure enregistrées sur chaque opération.
6. Entrée en stock avec date de péremption, quantité et source d'approvisionnement.
7. Un **mouchard** qui signale les ventes annulées.
8. À la vente, l'acheteur doit obligatoirement être précisé.
9. Les règlements : date, montant, et facture(s) concernée(s).
10. Des statistiques.
11. Séparation des fonctionnalités entre **Administrateur** (accès illimité, peut modifier ou supprimer une vente, etc.) et **Préparateur** (utilisation basique, sans pouvoir de modification ni de suppression des opérations).
12. **Retour client** : un client peut retourner un article ; le montant est crédité sur son compte et peut servir à acheter d'autres produits.
13. **E-mail (serveur SMTP)** : l'administrateur est notifié par e-mail et **choisit lui-même de quoi il est notifié** concernant l'activité des employés ; les **clients reçoivent automatiquement** leurs factures et autres documents par e-mail.

### Besoins non exprimés mais indispensables (ajoutés dans ce cahier)

Gestion par **lots** ; blocage automatique des périmés ; alertes péremption et rupture ; **rappel de lot** et traçabilité descendante ; **caisse** (ouverture, clôture, écarts, comptage à l'aveugle) ; **inventaire** ; ajustements, pertes et destruction des périmés ; retours fournisseurs ; **comptes clients** et plafonds de crédit ; **lettrage** des règlements ; échéancier et balance âgée des créances ; documents imprimables (tickets, factures, avoirs, reçus, relevés) ; **numérotation continue** des documents ; **journal d'audit infalsifiable** ; **autorisation par code administrateur** (override) ; postes de travail autorisés ; ventes en attente ; proposition d'équivalents (même DCI) en cas de rupture ; suggestions de réapprovisionnement ; sauvegardes automatiques ; exports Excel/PDF ; rapports réglementaires (TVA, produits classés).

---

## 2. HYPOTHÈSES RETENUES (paramétrables)

| Sujet | Hypothèse par défaut | Paramétrable |
|---|---|---|
| Type d'établissement | Pharmacie / dépôt vendant à des clients identifiés (particuliers et professionnels) | — |
| Devise | Dinar tunisien (TND), **3 décimales** (millimes) | Oui |
| Fuseau horaire | Africa/Tunis (stockage en UTC, affichage en heure locale) | Oui |
| Règle de sortie de stock | **FEFO** (premier périmé, premier sorti), puis FIFO (date de réception) à péremption égale. Mode « **FIFO strict** » disponible | Oui |
| TVA | Taux configurables et affectés par produit. Valeurs initiales à faire confirmer par le comptable de la cliente | Oui |
| Timbre fiscal | Montant configurable, appliqué aux factures A4 (valeur à confirmer) | Oui |
| Prix de vente | Saisi **TTC** (prix public), HT calculé | Oui |
| Prix d'achat | Saisi **HT** | Oui |
| Acheteur | **Obligatoire** sur chaque vente | Oui (option « client comptoir » désactivée par défaut) |
| Stock négatif | **Interdit** | Non (règle d'or) |
| Unité de stock | Unité de base (ex. boîte). Vente à l'unité (déconditionnement) activable par produit | Oui |
| Multi-sites | Un seul site en v1, mais `site_id` présent dans toutes les tables de stock | — |
| Langue | Français. Structure i18n prête pour l'arabe (RTL) | — |
| E-mails | Désactivés tant que le SMTP n'est pas configuré et testé. Envoi automatique aux clients uniquement avec leur consentement | Oui |

> **Note FIFO / FEFO.** La cliente a demandé « FIFO ». En pharmacie, la pratique de référence est le **FEFO** : on sort d'abord le lot qui périme le plus tôt, ce qui réduit les pertes. Dans la grande majorité des cas les deux coïncident. Le paramètre `stock.exit_rule` permet de basculer en FIFO strict. Afficher clairement la règle active dans les paramètres.

---

## 3. ARCHITECTURE ET STACK TECHNIQUE

### 3.1 Principes

- **Client léger / serveur central** : API REST + PostgreSQL hébergés. Le navigateur (étape 1) et l'application Electron (étape 2) chargent le **même frontend**.
- **SPA + API séparée, pas de rendu serveur (SSR)** : le build statique du frontend s'empaquette tel quel dans Electron, sans embarquer de serveur Node.
- **L'horloge du serveur est la seule source d'horodatage.** L'heure du poste client n'est jamais utilisée pour dater une opération.
- **Montants en entiers** (millimes, type `BIGINT`). Jamais de `float`. Toute division/arrondi passe par un module `money` unique et testé (arrondi au millime, méthode « half up »).
- **Quantités en entiers**, exprimées dans l'unité de base du produit.
- **Tables en ajout seul (append-only)** : `stock_movements`, `audit_logs`, `client_ledger`. Aucune mise à jour ni suppression, verrouillé au niveau base (triggers).
- **Transactions ACID** pour toute opération touchant le stock ou l'argent, avec verrouillage des lignes de lots (`SELECT … FOR UPDATE`).

### 3.2 Stack

**Backend**
- NestJS (TypeScript strict), architecture modulaire par domaine.
- PostgreSQL 16+.
- Prisma (ORM + migrations). Requêtes SQL brutes autorisées pour les verrous `FOR UPDATE` et les agrégats statistiques lourds.
- Validation : Zod (schémas partagés avec le frontend via `packages/shared`).
- Authentification : JWT d'accès courte durée (15 min) + refresh token en cookie `httpOnly`, `Secure`, `SameSite=Strict`, rotation à chaque usage, stocké hashé en base.
- Hash des mots de passe et PIN : Argon2id.
- Sécurité HTTP : helmet, CORS strict, rate limiting (@nestjs/throttler).
- Logs : pino (JSON structuré), avec identifiant de requête.
- Tâches planifiées : @nestjs/schedule (alertes, statuts des lots, vérification des sauvegardes).
- Exports : exceljs (Excel), pdfmake (PDF côté serveur).
- E-mail : Nodemailer (SMTP), gabarits HTML responsives (MJML compilé) + version texte, file d'envoi en base de données (§6.19).
- Documentation API : OpenAPI/Swagger (accessible aux administrateurs uniquement en production).

**Frontend**
- React + TypeScript + Vite.
- React Router, TanStack Query (cache et synchronisation serveur), TanStack Table (tableaux denses, tri, filtres, pagination serveur).
- React Hook Form + Zod.
- Tailwind CSS + shadcn/ui (composants Radix accessibles).
- Graphiques : Apache ECharts (ou Recharts).
- Dates : date-fns + date-fns-tz.
- Palette de commandes (Ctrl+K) : cmdk. Notifications : sonner.
- i18n : react-i18next (fr par défaut).
- PWA : manifest + service worker (installation seulement, **pas de mode hors ligne** pour les opérations en v1).

**Étape 2 (bureau)** : Electron + electron-builder (installateur NSIS Windows) + electron-updater.

**Infrastructure** : Docker Compose, Caddy (HTTPS automatique), sauvegardes `pg_dump` planifiées, GitHub Actions (lint, typecheck, tests, build). En développement : **Mailpit** (faux serveur SMTP qui capture tous les e-mails, avec interface web).

Pas de Redis ni de file de messages en v1 (inutile à cette échelle).

### 3.3 Structure du dépôt (monorepo pnpm)

```
/
├── apps/
│   ├── api/            # NestJS
│   │   ├── prisma/     # schema.prisma, migrations, seed
│   │   └── src/modules/{auth,users,roles,devices,settings,catalog,suppliers,
│   │                    purchases,lots,stock,sales,returns,clients,payments,
│   │                    cash,inventory,adjustments,alerts,stats,reports,
│   │                    audit,documents,email,notifications,backup}
│   ├── web/            # React SPA
│   └── desktop/        # Electron (étape 2 uniquement)
├── packages/
│   └── shared/         # schémas Zod, types, enums, constantes, module money
├── docs/               # SPEC, PROGRESS, DECISIONS, guides
├── docker/             # Dockerfiles, Caddyfile, scripts de sauvegarde
├── docker-compose.yml  # dev
├── docker-compose.prod.yml
├── .env.example
└── CLAUDE.md
```

### 3.4 Conventions

- TypeScript `strict: true` partout. ESLint + Prettier. Pas de `any` non justifié.
- La logique métier vit dans des **services de domaine** testables, jamais dans les contrôleurs ni dans les composants React.
- Chaque opération d'écriture sensible passe par un service qui, **dans la même transaction** : valide les permissions, applique la règle métier, écrit les mouvements, écrit l'entrée d'audit.
- Erreurs métier typées avec un code stable (ex. `STOCK_INSUFFICIENT`, `LOT_EXPIRED`, `CREDIT_LIMIT_EXCEEDED`) traduit en message français côté frontend.
- Format d'affichage : montants `1 234,567 DT` ; dates `30/09/2026` ; date-heure `30/09/2026 14:05:32`.

---

## 4. RÈGLES D'OR (résumé)

1. **Rien de validé ne se supprime physiquement.** « Supprimer » une vente = l'annuler (statut `CANCELLED`), avec contre-mouvements et trace au mouchard. « Modifier » une vente validée = annulation + nouvelle vente liée.
2. **Chaque opération porte** : l'utilisateur (et son code), la date et l'heure serveur, le poste, et le cas échéant l'administrateur ayant autorisé.
3. **Le stock n'est jamais négatif** et un lot périmé ou bloqué n'est jamais vendu.
4. **Tout mouvement de stock est rattaché à un lot** et à un document source.
5. **Le coût d'achat réel de chaque lot est conservé** : la marge est calculée sur le coût exact des lots sortis.
6. **Les numéros de documents sont continus, sans trou**, par type et par année. Un numéro annulé reste visible et n'est jamais réutilisé.
7. **Le journal d'audit est infalsifiable** (ajout seul + chaînage de hash).

---

## 5. UTILISATEURS, RÔLES ET SÉCURITÉ D'ACCÈS

### 5.1 Rôles

Le système est fondé sur des **permissions** (RBAC). Deux rôles système, non supprimables :

- **Administrateur** : toutes les permissions.
- **Préparateur** : utilisation quotidienne, sans modification ni suppression d'opérations validées.

L'administrateur peut créer des rôles personnalisés (ex. « Caissier », « Magasinier », « Comptable — lecture seule ») en cochant des permissions. Les permissions sont regroupées par module dans l'écran d'administration.

### 5.2 Matrice des permissions par défaut

Légende : ✅ autorisé — ❌ interdit — 🔑 possible avec code administrateur (override, §5.4) — ⚙️ paramétrable

| Fonction | Admin | Préparateur |
|---|---|---|
| **Ventes** | | |
| Créer une vente, scanner, choisir l'acheteur | ✅ | ✅ |
| Créer un client rapidement (nom + téléphone) | ✅ | ✅ |
| Mettre une vente en attente / la reprendre | ✅ | ✅ |
| Encaisser (espèces, carte, chèque, virement, avoir) | ✅ | ✅ |
| Vente à crédit dans la limite du plafond client | ✅ | ✅ ⚙️ |
| Dépasser le plafond de crédit | ✅ | 🔑 |
| Remise ≤ plafond préparateur (ex. 5 %) | ✅ | ✅ |
| Remise au-delà du plafond / modification du prix unitaire | ✅ | 🔑 |
| Forcer un lot autre que celui proposé (FEFO/FIFO) | ✅ | 🔑 |
| Retirer une ligne du panier avant validation (tracé) | ✅ | ✅ |
| Réimprimer un ticket / une facture (tracé) | ✅ | ✅ |
| Voir ses propres ventes | ✅ | ✅ |
| Voir toutes les ventes (sans coûts ni marges) | ✅ | ✅ ⚙️ |
| **Annuler une vente validée** | ✅ | ❌ |
| **Modifier une vente validée** | ✅ | ❌ |
| **Retours et avoirs** | | |
| Saisir un retour client (avoir sur compte) | ✅ | ✅ 🔑 ⚙️ (code admin exigé par défaut) |
| Rembourser un retour en espèces | ✅ | ❌ |
| **Règlements** | | |
| Enregistrer un règlement et le lettrer | ✅ | ✅ |
| Annuler un règlement / déclarer un chèque impayé | ✅ | ❌ |
| **Stock et achats** | | |
| Consulter stock, lots, péremptions | ✅ | ✅ |
| Consulter la fiche de mouvement d'un produit | ✅ | ✅ (sans coûts) |
| Saisir une réception (brouillon) | ✅ | ✅ |
| Valider une réception | ✅ | ✅ ⚙️ |
| Annuler une réception validée | ✅ | ❌ |
| Déclarer une casse / perte (en attente de validation) | ✅ | ✅ |
| Valider un ajustement, une perte, une destruction | ✅ | ❌ |
| Saisir les comptages d'inventaire | ✅ | ✅ |
| Valider un inventaire | ✅ | ❌ |
| Bloquer / débloquer un lot, lancer un rappel de lot | ✅ | ❌ |
| Retour fournisseur | ✅ | ❌ |
| **Catalogue, clients, fournisseurs** | | |
| Consulter le catalogue | ✅ | ✅ |
| Créer / modifier un produit, modifier un prix | ✅ | ❌ |
| Voir prix d'achat et marges | ✅ | ❌ |
| Modifier un client (coordonnées) | ✅ | ✅ ⚙️ |
| Modifier plafond de crédit / remise habituelle d'un client | ✅ | ❌ |
| Gérer les fournisseurs | ✅ | ❌ (lecture ✅) |
| **Caisse** | | |
| Ouvrir / clôturer sa caisse (comptage à l'aveugle) | ✅ | ✅ |
| Voir les montants théoriques, écarts, rapports Z | ✅ | ❌ |
| Sortie de caisse (dépense) | ✅ | ❌ ⚙️ |
| **Statistiques et rapports** | | |
| Tableau de bord complet (CA, marges, valeur du stock) | ✅ | ❌ |
| Tableau de bord personnel (ses ventes du jour, alertes stock) | ✅ | ✅ |
| Rapports et exports | ✅ | ❌ |
| **Administration** | | |
| Mouchard / journal d'audit | ✅ | ❌ |
| Utilisateurs, rôles, postes, paramètres, sauvegardes | ✅ | ❌ |
| **E-mail** | | |
| Configurer le serveur SMTP, les modèles et les envois automatiques | ✅ | ❌ |
| Choisir ses notifications e-mail sur l'activité des employés | ✅ | ❌ ⚙️ |
| Envoyer / renvoyer manuellement un document au client par e-mail | ✅ | ✅ |
| Consulter le journal des e-mails envoyés | ✅ | ❌ |

### 5.3 Codes utilisateurs, connexion et PIN

Chaque utilisateur possède :
- un **code utilisateur unique** (ex. `ADM01`, `PRE01`, `PRE02`), affiché sur tous les documents imprimés, dans le mouchard et dans la fiche de mouvement ;
- un **mot de passe** pour la connexion (politique : 8 caractères minimum, changement obligatoire à la première connexion) ;
- un **code PIN personnel** (4 à 6 chiffres) pour :
  - le **changement rapide d'utilisateur** sur un poste partagé (comptoir) sans fermer la session applicative ;
  - le déverrouillage après inactivité ;
  - la confirmation d'une vente si le paramètre `sales.require_pin_on_validation` est actif (utile quand plusieurs préparateurs partagent un poste).

Sécurité :
- Verrouillage du compte après 5 échecs (durée paramétrable) ; chaque échec est tracé.
- Verrouillage automatique de l'écran après X minutes d'inactivité (défaut 10 min), déverrouillage par PIN.
- Liste des sessions actives visible par l'administrateur, avec déconnexion forcée.
- Un utilisateur n'est jamais supprimé : il est **désactivé** (ses opérations passées restent attribuées).
- Double authentification (TOTP) optionnelle pour les administrateurs.

### 5.4 Autorisation par code administrateur (override)

Quand un préparateur tente une action marquée 🔑, une fenêtre demande **le code utilisateur + PIN d'un administrateur** présent, et un **motif** obligatoire. Si valide, l'action est exécutée une seule fois.
L'opération enregistre `performed_by` (préparateur) **et** `authorized_by` (administrateur), et génère une entrée `ADMIN_OVERRIDE` au mouchard.

### 5.5 Postes de travail

- Chaque navigateur / installation s'enregistre comme **poste** (ex. « Comptoir 1 », « Réserve »). Un poste nouveau est en attente jusqu'à approbation par l'administrateur (paramètre `security.require_device_approval`, défaut : activé en production).
- Chaque opération enregistre le poste d'où elle a été faite.
- L'administrateur peut révoquer un poste (perdu, volé, remplacé).

---

## 6. MODULES FONCTIONNELS (SECTIONS DU LOGICIEL)

### 6.1 Tableau de bord

**Administrateur** — cartes et graphiques :
- CA du jour / semaine / mois (TTC et HT), nombre de ventes, panier moyen, marge brute et taux de marge, comparaison avec la période précédente.
- Encaissements du jour par mode de paiement.
- Créances clients totales et factures échues.
- Valeur du stock (au coût d'achat réel et au prix de vente).
- Alertes : ruptures, sous le seuil, lots périmés à retirer, lots proches de la péremption (J-30 / J-60 / J-90), plafonds de crédit dépassés, écarts de caisse, **annulations du jour** (lien vers le mouchard).
- Graphique des ventes des 30 derniers jours ; top 10 produits du mois.

**Préparateur** : ses ventes du jour (nombre, pas de marge), ventes en attente, alertes stock (ruptures, péremptions proches), raccourcis vers la caisse.

### 6.2 Catalogue produits

Fiche produit :
- Code interne (auto ou manuel, unique), **codes-barres multiples** (EAN-13…).
- Nom commercial, **DCI** (dénomination commune internationale), dosage, forme (comprimé, gélule, sirop, injectable, pommade…), présentation (ex. « boîte de 30 »).
- Laboratoire / fabricant, catégorie (médicament, parapharmacie, dispositif médical, autre), famille thérapeutique (optionnelle).
- Taux de TVA, prix d'achat de référence HT, **prix de vente TTC**, marge calculée affichée.
- Unités par boîte, vente à l'unité autorisée (oui/non) et prix unitaire.
- Ordonnance obligatoire (oui/non) ; classement « produit à tableau » (aucun / A / B / C, selon la réglementation applicable) ; chaîne du froid (2–8 °C) ; retour client autorisé (oui/non).
- Emplacement (rayon, étagère, casier).
- **Stock minimum** (seuil d'alerte), stock maximum, point de commande.
- Actif / archivé (un produit ayant des mouvements ne peut pas être supprimé, seulement archivé).

Fonctions :
- Recherche instantanée par nom, DCI, code, code-barres (tolérante aux accents et aux fautes légères).
- **Équivalents** : produits de même DCI + dosage + forme, proposés automatiquement en cas de rupture.
- Import / export du catalogue en Excel/CSV avec rapport d'erreurs ligne par ligne.
- Historique des changements de prix (qui, quand, ancien → nouveau).
- Génération d'étiquettes code-barres pour les produits sans code (EAN interne) — optionnel.

### 6.3 Fournisseurs et achats (réceptions)

**Fournisseurs** : code, raison sociale, matricule fiscal, contact, téléphone, e-mail, adresse, délai de paiement, notes, actif/inactif.

**Source d'approvisionnement** (obligatoire sur chaque entrée) : `SUPPLIER` (fournisseur, alors fournisseur obligatoire), `DONATION` (don), `TRANSFER` (transfert), `OTHER` (autre, motif obligatoire).

**Bon de réception** (entrée en stock) :
- En-tête : numéro automatique `REC-AAAA-NNNNNN`, source, fournisseur, référence et date de la facture fournisseur, date de réception, pièce jointe (scan de la facture, optionnel), notes.
- Lignes : produit (scan ou recherche), **numéro de lot**, **date de péremption**, **quantité**, **unités gratuites (UG)**, prix d'achat unitaire HT, remise %, TVA.
- Saisie de la péremption au format **MM/AAAA** accepté (comme imprimé sur les boîtes) → stocké au dernier jour du mois. Format JJ/MM/AAAA aussi accepté.
- Contrôles : péremption dans le passé → bloquant ; péremption < seuil (ex. 6 mois) → avertissement à confirmer ; écart de prix > X % par rapport au dernier prix d'achat → avertissement.
- Statuts : `DRAFT` (modifiable) → `VALIDATED` (crée les lots et les mouvements `PURCHASE_IN`, figé) → `CANCELLED` (admin, voir RG-15).
- **Coût unitaire du lot** = (quantité × prix net HT) / (quantité + UG).
- Si le même produit + même numéro de lot + même péremption existe déjà, créer tout de même un nouveau lot interne (traçabilité par réception), mais afficher le numéro fabricant identique.
- Mise à jour optionnelle du prix d'achat de référence et proposition de mise à jour du prix de vente.

**Commandes fournisseurs** (optionnel v1, phase 5) : bon de commande généré depuis les suggestions de réapprovisionnement, export PDF, réception rattachée à la commande avec contrôle des quantités.

### 6.4 Stock et lots (FEFO/FIFO, péremption)

**Lot** : produit, numéro de lot fabricant, date de péremption, date de réception, quantité initiale, **quantité restante**, coût unitaire, fournisseur, source, réception d'origine, statut.

Statuts de lot : `ACTIVE`, `BLOCKED` (bloqué manuellement : rappel, doute qualité), `QUARANTINE` (retour non revendable en attente de décision), `EXHAUSTED` (épuisé). Le caractère « périmé » est **calculé** (date de péremption ≤ aujourd'hui) et rend le lot invendable automatiquement.

**Allocation à la vente** (voir RG-05) : le système choisit automatiquement le ou les lots selon la règle active. Une ligne de vente peut consommer **plusieurs lots**.

**Écrans** :
- **État du stock** : par produit — stock total, stock vendable, stock bloqué/périmé, nombre de lots, prochaine péremption, valeur au coût (admin), statut (OK / sous seuil / rupture). Filtres par catégorie, laboratoire, emplacement, statut. Export.
- **Lots** : liste de tous les lots avec code couleur de péremption (rouge : périmé ; orange : < 30 j ; jaune : < 90 j ; vert : OK — seuils paramétrables).
- **Péremptions** : lots à échéance dans les N prochains jours, valeur concernée, action « déclarer destruction » ou « retour fournisseur ».
- **Stock à une date passée** : état du stock tel qu'il était à une date choisie (reconstitué à partir des mouvements).
- **Rappel de lot** : saisir un numéro de lot → bloquer le lot, voir les quantités restantes, et la **liste de tous les clients** l'ayant acheté (date, quantité, facture, coordonnées), exportable. Événement `LOT_RECALL` au mouchard.

### 6.5 Fiche de mouvement d'un produit (traçabilité) — besoin n° 3

Écran central demandé par la cliente.

- Sélection : **produit** + **date de début** (choisie librement) + date de fin (défaut : maintenant). Filtres optionnels : type de mouvement, lot, utilisateur, client, fournisseur.
- En tête : **stock initial à la date de début** (calculé), total des entrées, total des sorties, **stock final**.
- Tableau chronologique, une ligne par mouvement :
  - date et heure (à la seconde), type (achat, vente, retour client, retour fournisseur, annulation, ajustement, perte, destruction, inventaire…), numéro du document (cliquable, ouvre le détail), lot et péremption, **entrée**, **sortie**, **solde après mouvement**, client ou fournisseur, prix unitaire (vente ou achat), coût (admin uniquement), **utilisateur (code + nom)**, administrateur ayant autorisé le cas échéant, poste, motif.
- Totaux par type de mouvement sur la période.
- Export Excel et PDF (en-tête avec nom de l'établissement, produit, période, date d'édition, utilisateur ayant imprimé).

### 6.6 Ventes — caisse / point de vente

Écran conçu pour la **rapidité au clavier et au scanner**.

**Déroulé** :
1. **Choix de l'acheteur** (obligatoire) : recherche par nom, code, téléphone, CIN / matricule fiscal ; création rapide (nom + téléphone minimum). À la sélection, afficher : solde du compte, **crédit disponible (avoir)**, plafond de crédit restant, alerte si factures échues.
2. **Ajout des produits** : scan du code-barres ou recherche (nom, DCI, code). Pour chaque produit affiché : stock vendable, prochaine péremption, prix, alerte ordonnance/tableau/chaîne du froid. Si rupture : proposer les **équivalents** disponibles.
3. Quantité (boîte ou unité si déconditionnement autorisé), remise ligne ou globale (plafonnée selon le rôle), **aperçu des lots qui seront sortis**.
4. Pour les produits à ordonnance obligatoire ou à tableau (paramétrable) : médecin prescripteur, numéro et date de l'ordonnance.
5. **Paiement** : un ou plusieurs modes combinés — espèces (calcul du rendu), carte, chèque (numéro, banque, date d'échéance), virement (référence), **avoir / crédit client**, **à crédit** (reste à payer sur le compte, dans la limite du plafond). Si le client a un avoir, proposer automatiquement de l'utiliser.
6. **Validation** : transaction unique (RG-05, RG-10) → numéro `FAC-AAAA-NNNNNN`, allocation des lots, mouvements de stock, règlements et lettrage, écriture au compte client, mouvement de caisse, audit. Impression du ticket (80 mm) ou de la facture A4 selon le choix, et/ou **envoi de la facture par e-mail** (case pré-cochée si le client a une adresse et a accepté l'envoi ; saisie de l'adresse possible à ce moment ; envoi en arrière-plan, sans jamais bloquer la vente).

**Fonctions complémentaires** :
- **Vente en attente** (touche F8) : mettre de côté une vente pour servir un autre client, la reprendre plus tard. Les ventes en attente sont visibles de tous les postes.
- Le panier en cours est **persisté côté serveur** (vente au statut `DRAFT`) : une coupure ne perd rien, et **chaque retrait de ligne est tracé** au mouchard.
- **Protection contre la double validation** : clé d'idempotence envoyée à la validation.
- Historique des ventes : recherche par numéro, client, période, utilisateur, produit, statut, montant. Détail complet d'une vente (lignes, lots sortis, paiements, retours, historique d'annulation/modification).
- Raccourcis clavier : F1 aide, F2 recherche produit, F3 client, F4 remise, F6 quantité, F8 mettre en attente, F9 paiement, F10 valider, Suppr retirer la ligne sélectionnée, Échap fermer la fenêtre courante.

**Statuts d'une vente** : `DRAFT`, `ON_HOLD`, `VALIDATED`, puis statut de paiement calculé (`UNPAID`, `PARTIALLY_PAID`, `PAID`), statut de retour (`PARTIALLY_RETURNED`, `RETURNED`), et `CANCELLED`.

### 6.7 Annulation et modification d'une vente (administrateur)

**Annuler** (« supprimer » au sens de la cliente) :
- Motif obligatoire (liste + texte libre).
- Réintégration du stock **dans les lots d'origine exacts** (mouvement `SALE_CANCEL`).
- Règlements liés : l'administrateur choisit entre **remboursement** (sortie de caisse, session ouverte requise) ou **conversion en crédit client**.
- Écriture d'annulation au compte client.
- Le numéro de facture reste attribué et apparaît « ANNULÉE » partout.
- Entrée **`SALE_CANCELLED`** (sévérité critique) au mouchard avec l'état complet de la vente avant annulation.
- Interdit si la vente a déjà fait l'objet d'un retour (utiliser alors un retour pour le reste) — RG-12.

**Modifier** :
- Annulation automatique de la vente d'origine + création d'une nouvelle vente **pré-remplie** et liée (`replaces_sale_id` / `replaced_by_sale_id`).
- Les règlements de l'originale sont transférés vers la nouvelle vente.
- Entrée **`SALE_MODIFIED`** au mouchard avec le différentiel (avant / après).

### 6.8 Retours clients et avoirs — besoin n° 12

- Retrouver la vente d'origine (numéro, scan du ticket, ou historique du client). Un retour sans vente d'origine est interdit par défaut (paramétrable, admin uniquement).
- Sélection des lignes et quantités retournées (≤ quantité vendue − déjà retournée).
- Pour chaque ligne : **état du produit**
  - **revendable** → remis en stock dans son lot d'origine (le préparateur confirme le numéro de lot inscrit sur la boîte parmi les lots sortis pour cette ligne) ;
  - **non revendable** → lot en quarantaine ou mouvement de destruction.
- Motif obligatoire.
- Contrôles paramétrables : délai maximum de retour (défaut 15 jours, dépassement = 🔑), produits non retournables (chaîne du froid, produits à tableau, produits marqués « retour non autorisé »), lot entre-temps périmé → non revendable d'office.
- Montant remboursé = **prix réellement payé** (après remises) au prorata.
- Mode de remboursement :
  - **Avoir sur le compte client** (défaut) : document **`AV-AAAA-NNNNNN`**, crédit disponible immédiatement pour un achat suivant ;
  - **Remboursement en espèces** : administrateur uniquement, sortie de caisse.
- Si la vente d'origine n'était pas entièrement payée, l'avoir vient d'abord **réduire le reste à payer** de cette facture ; seul l'excédent devient crédit disponible.
- Impression de l'avoir (ticket ou A4).
- Événement `CUSTOMER_RETURN` au mouchard.

### 6.9 Clients et comptes clients

**Fiche client** : code auto, type (particulier, pharmacie, clinique, hôpital, association, entreprise, autre), nom / raison sociale, CIN ou matricule fiscal, téléphone(s), e-mail, adresse, **plafond de crédit**, remise habituelle, délai de paiement, notes, actif/inactif.

**Préférences e-mail du client** : consentement à recevoir ses documents par e-mail (avec date et utilisateur ayant enregistré le consentement), types de documents souhaités (factures, avoirs, reçus, relevés), adresses en copie (ex. service comptable d'une clinique), indicateur « adresse en échec » si les e-mails reviennent. Onglet « E-mails envoyés » sur la fiche.

**Compte client** (grand livre, ajout seul) :
- Débits : factures validées. Crédits : règlements, avoirs, annulations.
- **Solde** : positif = le client doit ; négatif = crédit en faveur du client (affiché « Crédit disponible : X DT »).
- Onglets de la fiche : historique des achats, retours, règlements, factures ouvertes, **relevé de compte** sur période (solde d'ouverture, mouvements, solde de clôture), export PDF/Excel.
- Contrôle du plafond à chaque vente à crédit (🔑 pour dépasser).

### 6.10 Règlements et lettrage — besoin n° 9

- Encaissement : client, **date**, **montant**, mode (espèces, chèque [n°, banque, échéance], virement [référence], carte, traite), numéro automatique **`REG-AAAA-NNNNNN`**, reçu imprimable.
- **Lettrage** : affectation du règlement à **une ou plusieurs factures** ; répartition automatique (factures les plus anciennes d'abord) ou manuelle facture par facture. Le reliquat non affecté devient **acompte** (crédit client), affectable plus tard.
- Utilisation d'un avoir ou d'un acompte existant pour solder une facture (lettrage sans nouvel encaissement).
- Chaque facture affiche : total, déjà payé, **reste à payer**, et la liste des règlements avec date, montant, mode et utilisateur.
- **Chèques en portefeuille** : liste par date d'échéance ; statut remis en banque / encaissé ; **chèque impayé** (admin) → annulation du lettrage, facture rouverte, événement au mouchard.
- **Échéancier / balance âgée** : créances par client en tranches 0–30, 31–60, 61–90, > 90 jours.
- Annulation d'un règlement : administrateur uniquement, motif obligatoire, tracée.

### 6.11 Caisse (sessions)

- **Ouverture** : par utilisateur et par poste, avec fond de caisse.
- Les encaissements en espèces nécessitent une session ouverte (paramétrable).
- Mouvements de caisse : encaissements, remboursements, **sorties** (dépenses, motif obligatoire), apports, **ouverture du tiroir sans vente** (tracée au mouchard).
- **Clôture** avec **comptage à l'aveugle** : l'utilisateur saisit le détail par coupure (liste paramétrable, pré-remplie avec les billets et pièces tunisiens, à vérifier) **sans voir le montant théorique**. Le système calcule l'écart.
- Rapport de clôture (rapport Z) imprimable : ventes, encaissements par mode, remboursements, sorties, théorique, compté, écart. Rapport X (intermédiaire, sans clôture) pour l'administrateur.
- Écart supérieur au seuil → alerte administrateur + événement `CASH_DISCREPANCY`.
- Une opération (ex. annulation) touchant une journée déjà clôturée est enregistrée dans la session **en cours**, jamais dans une session fermée.

### 6.12 Inventaire et ajustements

**Inventaire** :
- Complet ou partiel (par catégorie, emplacement, laboratoire, sélection de produits).
- À l'ouverture : **photographie du stock théorique par lot**.
- Saisie des quantités comptées par lot (scan ou saisie), sur plusieurs postes en parallèle, avec l'utilisateur ayant compté.
- Rapport des écarts (quantité et valeur), recomptage possible.
- **Validation par l'administrateur** → mouvements `INVENTORY_ADJUSTMENT` datés de la validation. Les ventes faites pendant l'inventaire sont prises en compte (l'écart est calculé sur le théorique au moment du comptage de la ligne).
- Historique des inventaires, export.

**Ajustements** (hors inventaire) : types `LOSS` (perte), `BREAKAGE` (casse), `EXPIRED_DESTRUCTION` (destruction de périmés), `CORRECTION`. Saisie par un préparateur possible (statut `PENDING`), **validation par l'administrateur**. Motif obligatoire. Procès-verbal de destruction imprimable.

### 6.13 Retours fournisseurs

- Sélection du fournisseur, des lots et quantités (périmés, défectueux, erreur de livraison, rappel).
- Numéro `RF-AAAA-NNNNNN`, bon de retour imprimable, mouvement `SUPPLIER_RETURN`.
- Suivi : en attente d'avoir fournisseur / avoir reçu (montant).

### 6.14 Alertes et notifications

Centre de notifications (icône cloche) + widgets du tableau de bord :
- Rupture de stock et passage sous le seuil minimum.
- Lots proches de la péremption (seuils J-90 / J-60 / J-30 paramétrables) et lots périmés encore en stock.
- **Suggestions de réapprovisionnement** : quantité suggérée = f(stock max, consommation moyenne sur N jours, délai fournisseur).
- Clients au-delà du plafond, factures échues.
- **Annulations** : notification immédiate à l'administrateur à chaque annulation / modification de vente ; alerte si un utilisateur dépasse N annulations ou N retraits de lignes par jour.
- Écarts de caisse, échecs de connexion répétés, sauvegarde échouée.
- Chaque alerte peut aussi être envoyée **par e-mail**, selon les abonnements choisis par chaque administrateur (§6.19).

### 6.15 Statistiques et rapports — besoin n° 10

Tous filtrables par période (avec comparaison N / N-1), exportables en Excel et PDF, avec graphiques.

**Ventes** : CA (TTC/HT) par jour/semaine/mois/année ; nombre de ventes et panier moyen ; ventes par **utilisateur**, par **client**, par catégorie, par laboratoire, par **mode de paiement** ; ventes par **heure et jour de la semaine** (carte de chaleur) ; top produits (quantité, CA, marge) ; **analyse ABC** (Pareto).
**Marges** : marge brute sur coût réel des lots, par produit, catégorie, période.
**Stock** : valeur du stock au coût et au prix de vente ; **rotation** ; **couverture en jours** ; **produits dormants** (aucune vente depuis N jours) ; état du stock à une date donnée.
**Péremptions** : valeur des lots proches de la péremption ; **pertes** (périmés détruits, casse) par période.
**Achats** : par fournisseur, par produit, évolution des prix d'achat.
**Retours et annulations** : par motif, par utilisateur, par produit, montant.
**Créances** : balance âgée, top débiteurs, encaissements par période.
**Caisse** : écarts par utilisateur et par période.

**Rapports imprimables** : journal des ventes, journal des achats, journal des règlements, état du stock, état des péremptions, relevé client, balance âgée, **récapitulatif TVA** (collectée par taux / déductible), **registre des produits à tableau** (si activé : date, produit, lot, quantité, client, prescripteur, n° d'ordonnance), rapport Z, procès-verbal d'inventaire, traçabilité d'un lot.

### 6.16 Mouchard / journal d'audit — besoin n° 7

Écran réservé à l'administrateur. **Le journal enregistre tout événement sensible, et pas seulement les annulations.**

**Événements enregistrés (minimum)** :

| Code | Sévérité |
|---|---|
| `SALE_CANCELLED` — vente annulée | Critique |
| `SALE_MODIFIED` — vente modifiée | Critique |
| `CART_LINE_REMOVED` — ligne retirée du panier avant validation | Avertissement |
| `DRAFT_SALE_DISCARDED` — panier / vente en attente abandonné | Avertissement |
| `DISCOUNT_OVER_LIMIT` — remise au-delà du plafond | Avertissement |
| `PRICE_OVERRIDE` — prix modifié en vente | Avertissement |
| `LOT_FORCED` — lot forcé hors règle FEFO/FIFO | Avertissement |
| `DOCUMENT_REPRINTED` — ticket / facture réimprimé | Info |
| `CASH_DRAWER_OPENED` — tiroir ouvert sans vente | Avertissement |
| `CUSTOMER_RETURN` / `CASH_REFUND` | Avertissement |
| `PAYMENT_CANCELLED` / `CHEQUE_BOUNCED` | Critique |
| `STOCK_ADJUSTMENT` / `INVENTORY_VALIDATED` / `DESTRUCTION` | Avertissement |
| `RECEIPT_CANCELLED` | Critique |
| `PRODUCT_PRICE_CHANGED` | Info |
| `LOT_BLOCKED` / `LOT_UNBLOCKED` / `LOT_RECALL` | Avertissement |
| `CREDIT_LIMIT_OVERRIDE` / `ADMIN_OVERRIDE` | Avertissement |
| `CASH_DISCREPANCY` | Avertissement |
| `USER_CREATED` / `USER_UPDATED` / `USER_DISABLED` / `ROLE_PERMISSIONS_CHANGED` | Critique |
| `LOGIN_SUCCESS` / `LOGIN_FAILED` / `LOGOUT` / `ACCOUNT_LOCKED` | Info / Avertissement |
| `SETTING_CHANGED` / `DEVICE_APPROVED` / `DEVICE_REVOKED` | Avertissement |
| `DATA_EXPORTED` / `BACKUP_RESTORED` | Info / Critique |

**Contenu de chaque entrée** : date-heure serveur (à la seconde), utilisateur (code + nom), administrateur ayant autorisé, poste, adresse IP, type, sévérité, entité concernée (type, id, **numéro lisible** : facture, client…), résumé en français, **état avant / après** (JSON), motif.

**Écran** :
- Filtres : période, utilisateur, type d'événement, sévérité, poste, texte (numéro de facture, client).
- Onglet dédié **« Ventes annulées »** : date, heure, n° de facture, client, montant, lignes, motif, annulée par, autorisée par — avec total annulé sur la période.
- Indicateurs : annulations et retraits de lignes **par utilisateur** sur la période.
- Panneau de détail avec comparaison avant / après lisible.
- Export PDF/Excel (l'export est lui-même tracé).
- Bouton **« Vérifier l'intégrité du journal »** (contrôle de la chaîne de hash, voir RG-20).

### 6.17 Administration et paramètres

- **Établissement** : nom, logo, adresse, téléphone, e-mail, matricule fiscal, registre de commerce, mentions légales en pied de document.
- **Utilisateurs** : création, code, rôle, réinitialisation du mot de passe / PIN, désactivation, sessions actives.
- **Rôles et permissions** : matrice éditable (rôles système non supprimables).
- **Postes** : approbation, renommage, révocation, imprimante associée (étape 2).
- **Paramètres métier** (tous tracés au mouchard) :
  - devise, décimales, fuseau horaire ;
  - règle de sortie `FEFO` / `FIFO` ;
  - seuils de péremption (alertes, blocage de vente si péremption < N jours, avertissement à la réception) ;
  - taux de TVA, timbre fiscal ;
  - formats de numérotation par type de document ;
  - remise maximale préparateur, vente à crédit par préparateur ;
  - politique de retour (délai, code admin exigé, remboursement espèces autorisé) ;
  - acheteur obligatoire / client comptoir autorisé ;
  - PIN exigé à chaque validation de vente ;
  - informations d'ordonnance obligatoires (pour quels produits) ;
  - caisse obligatoire pour les espèces, seuil d'écart, liste des coupures ;
  - délai de verrouillage d'inactivité, politique de mot de passe ;
  - seuils d'alerte d'annulations par utilisateur ;
  - horaires d'ouverture de l'établissement (utilisés pour les alertes « activité hors horaires ») ;
  - envois automatiques d'e-mails par type de document (§6.19).
- **E-mail & notifications** : serveur SMTP, test d'envoi, modèles d'e-mails, envois automatiques aux clients, journal des e-mails (§6.19).
- **Sauvegardes** : état de la dernière sauvegarde, historique, déclenchement manuel (la restauration se fait par procédure d'exploitation documentée, pas depuis l'interface).

### 6.18 Impressions et documents

Modèles propres, en français, avec logo et mentions de l'établissement :
- **Ticket 80 mm** : vente, avoir, reçu de règlement, rapport Z.
- **A4** : facture (avec HT, TVA par taux, timbre fiscal, TTC, montant en toutes lettres, reste à payer), avoir, reçu, relevé de compte, bon de réception, bon de retour fournisseur, procès-verbal d'inventaire et de destruction, tous les rapports.
- Chaque document porte : numéro, date-heure, **code de l'utilisateur**, et la mention « DUPLICATA » en cas de réimpression, « ANNULÉ » si annulé.
- Étape 1 : impression via le navigateur (feuille de style d'impression dédiée 80 mm / A4). Étape 2 : impression silencieuse directe (§14).
- Les templates sont centralisés dans un module `documents` pour être partagés entre PDF serveur et impression navigateur.
- Chaque document (facture, avoir, reçu, relevé, bon de commande) dispose d'un bouton **« Envoyer par e-mail »** / **« Renvoyer »** (§6.19).

### 6.19 Messagerie e-mail (serveur SMTP) et notifications — besoin n° 13

Tout le système d'e-mail est **désactivé tant que le SMTP n'est pas configuré et testé**. L'envoi d'un e-mail n'empêche et ne ralentit **jamais** une opération : une vente est validée même si le serveur e-mail est en panne (voir E. File d'envoi).

#### A. Configuration du serveur SMTP (Administration → E-mail & notifications)

- Serveur (hôte), port, sécurité (SSL/TLS, STARTTLS, aucune), identifiant, **mot de passe** (chiffré en base, jamais réaffiché : champ masqué avec bouton « Modifier »).
- Nom et adresse d'expéditeur (ex. « Pharmacie X <factures@domaine.tn> »), adresse de réponse, **copie cachée d'archivage** optionnelle (chaque e-mail client envoyé en copie à une adresse de l'établissement).
- Limite d'envois par heure (pour respecter le quota du fournisseur e-mail).
- Boutons **« Tester la connexion »** et **« Envoyer un e-mail de test »** vers une adresse saisie, avec message d'erreur clair en français (authentification refusée, port bloqué, certificat invalide…).
- Compatible avec tout fournisseur SMTP : hébergeur du nom de domaine, Google Workspace / Gmail (mot de passe d'application), Microsoft 365 / Outlook, services d'envoi transactionnel en mode SMTP.
- Interrupteur général « Envoi d'e-mails activé ».
- Toute modification est tracée au mouchard (`SETTING_CHANGED`, mot de passe masqué).

#### B. Notifications de l'administrateur — il choisit lui-même de quoi il est notifié

Chaque administrateur (et tout utilisateur ayant la permission `notifications.email.receive`) dispose d'une page **« Mes notifications »** : adresse e-mail de réception, puis pour **chaque événement**, un mode au choix :

- **Désactivé**
- **Dans le logiciel uniquement** (cloche)
- **E-mail immédiat**
- **Résumé quotidien** (heure d'envoi choisie, ex. 20h00)
- **Résumé hebdomadaire** (jour et heure choisis)

Filtres par événement :
- **Employés suivis** : tous, ou une sélection d'utilisateurs (ex. seulement les préparateurs, ou seulement `PRE02`).
- **Seuils** : ex. prévenir seulement si l'annulation dépasse 50 DT, si la remise dépasse 10 %, si l'écart de caisse dépasse 5 DT.
- **Hors horaires** : alerte si un employé se connecte ou fait une opération en dehors des horaires d'ouverture.

**Catalogue des événements notifiables**

| Groupe | Événements |
|---|---|
| Activité des employés | Vente annulée ; vente modifiée ; ligne retirée du panier ; panier abandonné ; remise au-delà du plafond ; prix modifié en vente ; lot forcé ; code administrateur utilisé (qui l'a demandé, pour quoi) ; retour client ; remboursement en espèces ; réimpression de ticket/facture ; tiroir-caisse ouvert sans vente ; ouverture / clôture de caisse ; **écart de caisse** ; réception validée (avec montant) ou annulée ; perte / casse déclarée **en attente de validation** ; inventaire prêt à valider ; connexion ou opération hors horaires ; échecs de connexion, compte verrouillé ; nouveau poste en attente d'approbation |
| Stock | Rupture ; passage sous le seuil ; lots proches de la péremption ; lots périmés encore en stock ; suggestions de réapprovisionnement ; incohérence de stock détectée (RG-22) |
| Clients & finances | Plafond de crédit dépassé ; factures échues ; chèque impayé ; règlement annulé ; règlement important reçu (seuil) |
| Système | Sauvegarde échouée ; échec de la vérification d'intégrité du journal (RG-20) ; échecs répétés d'envoi d'e-mails |

**Rapport d'activité quotidien par employé** (abonnement dédié, envoyé à l'heure choisie) : pour chaque utilisateur actif dans la journée — nombre et montant des ventes, remises accordées, retours, annulations, lignes retirées du panier, codes administrateur utilisés, écart de caisse, heure de la première et de la dernière opération. Liens vers les écrans correspondants (mouchard, ventes filtrées sur l'employé).

Règles :
- **Regroupement anti-rafale** : si le même événement se répète plus de N fois en 10 minutes, un seul e-mail récapitulatif est envoyé.
- **Alertes critiques système** (sauvegarde échouée, intégrité du journal, incohérence de stock) : au moins un administrateur doit rester abonné par e-mail ; le logiciel empêche de toutes les désactiver.
- **Abonnements par défaut** d'un nouvel administrateur : annulations et modifications de ventes (immédiat), écarts de caisse (immédiat), alertes critiques (immédiat), rapport d'activité (quotidien), péremptions et ruptures (résumé quotidien).
- Chaque e-mail contient un lien direct vers l'élément concerné dans le logiciel (connexion requise) et un lien « Gérer mes notifications ».
- Un préparateur ne reçoit jamais de notification sur l'activité des autres employés (sauf rôle personnalisé disposant de la permission).

#### C. E-mails envoyés aux clients (documents automatiques)

Dans les paramètres, pour chaque type de document, l'administrateur choisit : **Automatique**, **Manuel uniquement** ou **Désactivé**.

| Document | Déclencheur | Défaut |
|---|---|---|
| Facture | Validation de la vente | Automatique |
| Facture annulée / remplacée | Annulation ou modification de la vente | Automatique |
| Avoir | Création d'un retour client | Automatique |
| Reçu de règlement | Enregistrement d'un règlement | Automatique |
| Relevé de compte | 1er jour du mois (clients avec solde ou mouvements) | Manuel |
| Relance de facture échue | J+X, J+Y après échéance, jusqu'à N relances, ton progressif | Désactivé |
| Bon de commande fournisseur (phase 5) | Envoi de la commande au fournisseur | Manuel |

Règles :
- Envoi automatique **uniquement** si le client a une adresse e-mail **et a donné son consentement**. Sans consentement, l'envoi manuel reste possible après confirmation explicite.
- Respect des préférences du client (types de documents, adresses en copie).
- Le document est joint en **PDF** (même rendu que l'impression A4). Objet type : « Facture FAC-2026-000123 — [Nom de l'établissement] ».
- **Confidentialité** : le corps de l'e-mail ne cite **aucun nom de médicament** (données de santé). Il indique seulement le numéro, la date, le montant et le reste à payer ; le détail n'est que dans le PDF. Option (désactivée par défaut) : PDF protégé par un mot de passe communiqué au client.
- Bouton **« Envoyer par e-mail »** / **« Renvoyer »** sur chaque document, avec destinataire, copie et message modifiables avant l'envoi.
- Pied de chaque e-mail : coordonnées de l'établissement et comment ne plus recevoir les documents par e-mail.

#### D. Modèles d'e-mails

- Un modèle par type : facture, facture annulée, avoir, reçu, relevé, relances 1/2/3, notification administrateur, résumé quotidien/hebdomadaire, rapport d'activité, e-mail de test.
- Modifiables par l'administrateur : objet et corps, avec variables insérables (`{{client.nom}}`, `{{document.numero}}`, `{{document.date}}`, `{{document.montant}}`, `{{document.reste_a_payer}}`, `{{etablissement.nom}}`, `{{etablissement.telephone}}`…), **aperçu** avec des données d'exemple, bouton « Restaurer le modèle par défaut ».
- Rendu HTML responsive avec le logo et les couleurs de l'établissement, plus une version texte brut.
- Modèles par défaut fournis en français, ton professionnel.

#### E. File d'envoi et journal des e-mails

- **File d'envoi transactionnelle (outbox)** : l'opération métier (ex. validation d'une vente) insère la demande d'envoi dans `email_outbox` **dans la même transaction**. Un processus en arrière-plan (tâche planifiée toutes les 30 s, réservation des lignes avec `FOR UPDATE SKIP LOCKED`) effectue l'envoi. Une panne SMTP ne bloque jamais une opération.
- Reprises automatiques avec délai croissant (1 min, 5 min, 15 min, 1 h, 6 h), puis statut `FAILED` et notification à l'administrateur.
- Respect de la limite d'envois par heure.
- Le PDF est généré au moment de l'envoi, à partir de l'état réel du document (ex. mention « ANNULÉE » si elle a été annulée entre-temps).
- Écran **« Journal des e-mails »** (admin) : date, destinataire, type, document lié (cliquable), statut (en file, en cours, envoyé, échec, annulé), tentatives, dernière erreur ; filtres ; actions « Renvoyer » et « Annuler l'envoi ». Historique des e-mails visible aussi sur chaque document et sur la fiche client.
- Adresses validées (format, protection contre l'injection d'en-têtes). Un échec permanent (boîte inexistante) marque l'adresse « en échec » sur la fiche client.

---

## 7. MODÈLE DE DONNÉES (RÉFÉRENCE)

Schéma de référence à affiner dans `schema.prisma`. Toutes les tables ont `id` (UUID ou BIGSERIAL selon pertinence), `created_at`, et si modifiables `updated_at`, `created_by`, `updated_by`. Montants en `BIGINT` (millimes). Horodatages en `timestamptz`.

**Sécurité et configuration**
- `sites` (id, name, …) — un seul enregistrement en v1.
- `users` (code UNIQUE, username UNIQUE, full_name, email?, password_hash, pin_hash, role_id, is_active, must_change_password, failed_attempts, locked_until, totp_secret?, last_login_at)
- `roles` (name, is_system) ; `permissions` (key, module, label) ; `role_permissions`
- `sessions` (user_id, device_id, refresh_token_hash, ip, user_agent, last_seen_at, revoked_at)
- `devices` (name, kind WEB|DESKTOP, token_hash, status PENDING|APPROVED|REVOKED, site_id, last_seen_at)
- `settings` (key UNIQUE, value JSONB, updated_by, updated_at)
- `document_sequences` (doc_type, year, prefix, next_number) — verrouillée à chaque attribution

**Catalogue**
- `categories`, `laboratories`, `therapeutic_classes`, `tva_rates` (label, rate_bp en points de base)
- `products` (internal_code UNIQUE, name, dci, dosage, form, presentation, laboratory_id, category_id, tva_rate_id, ref_purchase_price_ht, sale_price_ttc, units_per_pack, sell_by_unit, unit_sale_price_ttc, requires_prescription, controlled_class, cold_chain, returnable, location, min_stock, max_stock, reorder_point, is_active)
- `product_barcodes` (product_id, barcode UNIQUE)
- `product_price_history` (product_id, field, old_value, new_value, changed_by, changed_at)

**Tiers**
- `suppliers` (code, name, tax_id, phone, email, address, payment_terms_days, is_active, notes)
- `clients` (code, type, name, national_id_or_tax_id, phone, phone2, email, address, credit_limit, default_discount_bp, payment_terms_days, is_active, notes, email_consent, email_consent_at, email_consent_by, email_doc_prefs JSONB, email_cc TEXT[], email_bounced)

**Achats et lots**
- `purchase_receipts` (number UNIQUE, site_id, source_type, supplier_id?, supplier_invoice_ref, supplier_invoice_date, received_at, status, totals…, attachment_id?, validated_by, validated_at, cancelled_by, cancelled_at, cancel_reason)
- `purchase_receipt_lines` (receipt_id, product_id, lot_number, expiry_date, qty, free_qty, unit_price_ht, discount_bp, tva_rate_bp, line_total_ht, lot_id?)
- `lots` (site_id, product_id, lot_number, expiry_date, received_at, initial_qty, remaining_qty **CHECK ≥ 0**, unit_cost_ht, supplier_id?, source_type, receipt_line_id, status, block_reason)
  - Index : (product_id, status, expiry_date, received_at)
- `supplier_returns` + `supplier_return_lines` (lot_id, qty, reason)

**Mouvements (ajout seul)**
- `stock_movements` (site_id, product_id, lot_id, type, qty signée, unit_cost_ht, unit_price_ttc?, product_balance_after, lot_balance_after, document_type, document_id, document_number, counterpart_type CLIENT|SUPPLIER|NONE, counterpart_id?, reason?, user_id, authorized_by?, device_id, created_at)
  - Types : `PURCHASE_IN`, `SALE_OUT`, `SALE_CANCEL`, `CUSTOMER_RETURN_IN`, `SUPPLIER_RETURN_OUT`, `INVENTORY_ADJUSTMENT`, `LOSS`, `BREAKAGE`, `EXPIRED_DESTRUCTION`, `CORRECTION`, `RECEIPT_CANCEL`
  - Index : (product_id, created_at), (lot_id, created_at), (document_type, document_id)

**Ventes**
- `sales` (number UNIQUE nullable tant que DRAFT, site_id, client_id, status, subtotal_ht, total_tva, total_discount, stamp_duty, total_ttc, amount_paid, amount_due, prescriber_name?, prescription_ref?, prescription_date?, replaces_sale_id?, replaced_by_sale_id?, cash_session_id?, device_id, idempotency_key UNIQUE, created_by, validated_by, validated_at, cancelled_by, cancelled_at, cancel_reason, cancel_authorized_by)
- `sale_lines` (sale_id, product_id, qty, unit PACK|UNIT, qty_base, unit_price_ttc, discount_bp, discount_amount, tva_rate_bp, line_total_ttc, returned_qty_base)
- `sale_line_allocations` (sale_line_id, lot_id, qty_base, unit_cost_ht)
- `sale_draft_events` (sale_id, event ADD|REMOVE|QTY_CHANGE, product_id, qty, user_id, created_at) — alimente le mouchard

**Retours et avoirs**
- `customer_returns` (number, sale_id, client_id, status, total_ttc, refund_mode CREDIT|CASH, reason, created_by, authorized_by, created_at)
- `customer_return_lines` (return_id, sale_line_id, product_id, qty_base, unit_price_ttc, amount, resellable, lot_id)
- `credit_notes` (number, client_id, return_id?, amount, remaining_amount, created_at)
- `credit_note_allocations` (credit_note_id, sale_id, amount, created_by, created_at, cancelled_at?)

**Règlements et comptes clients**
- `payments` (number, client_id, paid_at, amount, method, cheque_number?, bank?, due_date?, reference?, status VALID|CANCELLED|BOUNCED, cash_session_id?, created_by, cancelled_by?, cancel_reason?)
- `payment_allocations` (payment_id, sale_id, amount, created_by, created_at, cancelled_at?)
- `client_ledger` (client_id, entry_type INVOICE|PAYMENT|CREDIT_NOTE|INVOICE_CANCEL|PAYMENT_CANCEL|REFUND|ADJUSTMENT, debit, credit, balance_after, document_type, document_id, document_number, user_id, created_at) — ajout seul

**Caisse, inventaire, ajustements**
- `cash_sessions` (device_id, user_id, opened_at, opening_float, closed_at?, expected_amount?, counted_amount?, difference?, denominations JSONB?, status OPEN|CLOSED, closed_by?)
- `cash_movements` (session_id, type SALE_PAYMENT|REFUND|EXPENSE|DEPOSIT|WITHDRAWAL|DRAWER_OPEN, amount, reason?, document_ref?, user_id, created_at)
- `inventories` (number, scope JSONB, status DRAFT|COUNTING|VALIDATED|CANCELLED, started_by, started_at, validated_by?, validated_at?)
- `inventory_lines` (inventory_id, product_id, lot_id, theoretical_qty, counted_qty?, difference?, counted_by?, counted_at?)
- `stock_adjustments` (number, type, status PENDING|VALIDATED|REJECTED, reason, created_by, validated_by?) + `stock_adjustment_lines` (lot_id, qty)

**Audit et divers**
- `audit_logs` (BIGSERIAL, occurred_at, user_id?, authorized_by?, device_id?, ip, event_type, severity, entity_type, entity_id, entity_ref, summary, before JSONB, after JSONB, metadata JSONB, prev_hash, hash) — ajout seul, trigger interdisant UPDATE/DELETE
- `notifications` (type, severity, title, body, target_user_id? / target_permission?, entity_type, entity_id, read_at?, created_at)
- `attachments` (filename, mime, size, storage_path, uploaded_by)

**E-mail et notifications**
- Paramètres SMTP dans `settings` (clés `smtp.*`) ; mot de passe dans `smtp.password_encrypted` (AES-256-GCM, clé fournie par la variable d'environnement `APP_ENCRYPTION_KEY`).
- `notification_subscriptions` (user_id, event_type, mode OFF|IN_APP|EMAIL_IMMEDIATE|EMAIL_DAILY|EMAIL_WEEKLY, watched_user_ids UUID[]? (null = tous), thresholds JSONB, schedule JSONB, updated_at) — UNIQUE (user_id, event_type)
- `email_templates` (key UNIQUE, subject, body_mjml, body_text, is_customized, updated_by, updated_at)
- `email_outbox` (kind, to TEXT[], cc TEXT[], bcc TEXT[], subject, template_key, payload JSONB, attachment_refs JSONB, related_entity_type, related_entity_id, client_id?, status QUEUED|SENDING|SENT|FAILED|CANCELLED, attempts, next_attempt_at, last_error, provider_message_id?, sent_at?, created_by?, created_at)
  - Index : (status, next_attempt_at), (related_entity_type, related_entity_id), (client_id)
- `digest_runs` (user_id, digest_type DAILY|WEEKLY|ACTIVITY, period_start, period_end, outbox_id, created_at) — UNIQUE (user_id, digest_type, period_start), évite les doublons.

**Contraintes base de données obligatoires**
- `CHECK (remaining_qty >= 0)` sur `lots`.
- Triggers `BEFORE UPDATE OR DELETE` levant une exception sur `stock_movements`, `audit_logs`, `client_ledger`.
- L'utilisateur PostgreSQL de l'application n'a pas le droit `DELETE` sur ces tables (défense en profondeur).
- Clés étrangères `ON DELETE RESTRICT` partout sur les données métier.

---

## 8. RÈGLES DE GESTION DÉTAILLÉES

**RG-01 — Pas de suppression physique.** Aucune vente, réception, règlement, retour, avoir, mouvement ou entrée d'audit validé n'est supprimé physiquement. Seuls les brouillons (`DRAFT`) peuvent être abandonnés (et c'est tracé).

**RG-02 — Horodatage et attribution.** Toute écriture enregistre `user_id`, `device_id`, horodatage serveur UTC, et `authorized_by` en cas d'override.

**RG-03 — Stock jamais négatif.** Toute sortie est refusée si la quantité vendable est insuffisante (`STOCK_INSUFFICIENT`, avec détail : vendable, bloqué, périmé).

**RG-04 — Lot vendable** = statut `ACTIVE` ET `remaining_qty > 0` ET `expiry_date > aujourd'hui + blocage_jours` (paramètre, défaut 0).

**RG-05 — Allocation des lots (FEFO/FIFO).** À la validation d'une vente, dans une transaction :
1. Sélectionner les lots vendables du produit **avec `SELECT … FOR UPDATE`**, triés :
   - FEFO : `expiry_date ASC, received_at ASC, id ASC` ;
   - FIFO : `received_at ASC, id ASC`.
2. Consommer lot par lot jusqu'à couvrir la quantité ; créer une ligne `sale_line_allocations` par lot avec son coût.
3. Pour éviter les interblocages entre postes, verrouiller les produits d'une vente dans un **ordre déterministe** (par `product_id`).
4. Si un lot est forcé (🔑), l'allocation commence par ce lot puis reprend la règle normale ; événement `LOT_FORCED`.

**RG-06 — Coût des ventes.** Coût d'une ligne = Σ (qty allouée × coût unitaire du lot). Marge = CA HT − coût.

**RG-07 — Déconditionnement.** Le stock est tenu en unité de base. Vente d'une boîte = `units_per_pack` unités de base si la vente à l'unité est active pour le produit ; sinon l'unité de base est la boîte.

**RG-08 — Réception.** Péremption obligatoire, dans le futur. Coût unitaire = (qty × prix net HT) / (qty + UG). La validation crée un lot par ligne et un mouvement `PURCHASE_IN` pour (qty + UG).

**RG-09 — Acheteur obligatoire.** Une vente ne peut être validée sans client (sauf paramètre « client comptoir » activé, et dans ce cas jamais de vente à crédit ni d'avoir).

**RG-10 — Numérotation.** Numéros attribués **dans la transaction de validation** via `document_sequences` verrouillée : continus, sans trou, par type et par année (`FAC`, `AV`, `REG`, `REC`, `RT`, `RF`, `INV`, `AJ`, `CS`). Les brouillons n'ont pas de numéro.

**RG-11 — Annulation d'une vente.** Réintégration exacte dans les lots d'origine (même si le lot est depuis périmé : il redevient du stock, mais invendable) ; traitement des règlements (remboursement ou crédit) ; écriture `INVOICE_CANCEL` au compte client ; audit `SALE_CANCELLED` avec l'état complet avant annulation. Motif obligatoire.

**RG-12 — Vente avec retours.** Une vente ayant fait l'objet d'un retour ne peut être ni annulée ni modifiée ; seul un retour complémentaire est possible.

**RG-13 — Modification d'une vente** = annulation (RG-11) + nouvelle vente liée ; les règlements sont réaffectés à la nouvelle vente dans la même transaction.

**RG-14 — Retour client.** Quantité retournée ≤ vendue − déjà retournée, par ligne. Remise en stock dans un lot d'origine de la ligne. Montant = prix payé net de remise, au prorata. L'avoir réduit d'abord le reste à payer de la facture d'origine ; l'excédent devient crédit disponible.

**RG-15 — Annulation d'une réception.** Autorisée (admin) uniquement si **aucune unité** des lots créés n'a été sortie ; sinon refus avec message indiquant d'utiliser un retour fournisseur ou un ajustement.

**RG-16 — Règlements.** Σ des affectations d'un règlement ≤ montant du règlement ; affectation sur une facture ≤ son reste à payer ; reliquat = acompte. Annulation d'un règlement → affectations annulées, factures rouvertes, écriture au compte client.

**RG-17 — Plafond de crédit.** À la validation d'une vente à crédit : (solde actuel + reste à payer de la vente) ≤ plafond, sinon 🔑 `CREDIT_LIMIT_OVERRIDE`.

**RG-18 — Remises.** Remise préparateur ≤ plafond paramétré ; au-delà, 🔑. Le prix de vente ne peut jamais descendre sous le coût du lot sans confirmation administrateur (avertissement).

**RG-19 — Caisse.** Tout encaissement ou remboursement en espèces est rattaché à la session ouverte du poste. Le théorique n'est jamais affiché avant la saisie du comptage.

**RG-20 — Intégrité du journal d'audit.** `hash = SHA-256(prev_hash || JSON canonique de l'entrée)`. Écriture sérialisée (verrou consultatif PostgreSQL) pour garantir la chaîne. Une vérification complète est disponible dans l'interface et en tâche planifiée hebdomadaire.

**RG-21 — Fiche de mouvement.** Stock initial à la date D = Σ des quantités des mouvements du produit avec `created_at < D`. Le solde affiché par ligne est le cumul chronologique.

**RG-22 — Cohérence stock.** Tâche planifiée quotidienne : pour chaque lot, `remaining_qty` doit égaler Σ des mouvements du lot. Toute divergence → alerte critique administrateur (sans correction automatique).

**RG-23 — Idempotence.** Les créations de vente, règlement et retour acceptent un en-tête `Idempotency-Key` ; un rejeu renvoie le résultat initial sans double écriture.

**RG-24 — Concurrence d'édition.** Les entités éditables (produits, clients, paramètres) utilisent un contrôle optimiste (champ `version`) ; conflit → message clair, rechargement proposé.

---

## 9. EXIGENCES NON FONCTIONNELLES

**Sécurité**
- HTTPS obligatoire, en-têtes de sécurité, CSP stricte.
- Contrôle d'accès par permission sur **chaque** endpoint (guard NestJS + décorateur `@RequirePermission('sales.cancel')`).
- Validation stricte de toutes les entrées (Zod), requêtes paramétrées uniquement.
- Aucun secret dans le code : `.env`, `.env.example` documenté.
- Mot de passe SMTP chiffré en base (AES-256-GCM), jamais renvoyé par l'API, jamais écrit dans les logs.
- Journalisation sans données sensibles (pas de mots de passe, PIN ou jetons dans les logs).
- Données personnelles des clients : accès restreint, conformité à la réglementation tunisienne sur la protection des données personnelles (à vérifier avec la cliente).

**Performance** (sur un VPS modeste, 2 vCPU / 4 Go)
- Recherche produit au comptoir < 200 ms (50 000 produits).
- Validation d'une vente < 500 ms.
- Fiche de mouvement sur 12 mois < 2 s.
- Tenue en charge : 10 postes simultanés, 1 million de mouvements.
- Pagination côté serveur partout ; index sur toutes les colonnes filtrées.

**Fiabilité et sauvegarde**
- Sauvegarde automatique quotidienne (`pg_dump` compressé) + rétention 30 jours locale + **copie hors site** (stockage compatible S3). Sauvegarde supplémentaire avant chaque migration.
- **Procédure de restauration documentée et testée** (`docs/EXPLOITATION.md`).
- Endpoint `/health` (API + base).
- Gestion propre de la perte de connexion : bandeau « Connexion perdue — aucune opération ne peut être enregistrée », boutons de validation désactivés, reprise automatique. Le panier en cours est conservé (persisté serveur + copie locale temporaire).

**Ergonomie et accessibilité**
- Résolution minimale 1366×768 ; utilisable sur tablette (inventaire).
- Navigation complète au clavier sur la caisse ; contrastes WCAG AA.
- Messages d'erreur en français clair, qui disent quoi faire.

---

## 10. INTERFACE UTILISATEUR (UX/UI)

**Direction visuelle** : sobre, professionnelle, dense mais lisible. Accent vert pharmacie / sarcelle, fonds neutres, typographie Inter (ou équivalent). Mode clair par défaut, mode sombre optionnel. Pas d'animations gratuites.

**Codes couleur constants** : rouge = périmé / rupture / critique ; orange = péremption < 30 j / avertissement ; jaune = < 90 j / sous seuil ; vert = OK.

**Navigation (barre latérale, filtrée selon les permissions)** :
1. Tableau de bord
2. Caisse (point de vente)
3. Ventes — historique, ventes en attente
4. Retours & avoirs
5. Clients — liste, comptes, relevés
6. Règlements — encaissements, lettrage, chèques, échéancier
7. Stock — état, lots, péremptions, fiche de mouvement, rappel de lot, stock à date
8. Achats — réceptions, fournisseurs, retours fournisseurs, (commandes)
9. Inventaire & ajustements
10. Catalogue — produits, catégories, laboratoires, TVA
11. Caisse — sessions, rapports Z
12. Statistiques & rapports
13. Mouchard (admin)
14. Administration — utilisateurs, rôles, postes, paramètres, e-mail & notifications, journal des e-mails, sauvegardes

**Barre supérieure** : recherche globale (Ctrl+K : produit, client, n° de document), notifications (avec accès à « Mes notifications »), utilisateur connecté (code + nom), changement rapide d'utilisateur (PIN), poste courant, indicateur de connexion.

**Écran caisse** : colonne gauche = client sélectionné (solde, avoir, plafond) + panier (grandes lignes lisibles, lots prévus en petit) ; colonne droite = recherche produit avec résultats, total en très grand, boutons Paiement / Attente / Annuler le panier. Tout doit être faisable sans souris.

**Tableaux** : tri, filtres, colonnes masquables, pagination serveur, export Excel/PDF, état vide explicite, squelettes de chargement.

**Confirmations** : toute action irréversible (validation d'une réception, annulation…) passe par une fenêtre de confirmation récapitulative ; les actions administrateur demandent un motif.

---

## 11. API — CONVENTIONS

- REST, préfixe `/api/v1`, JSON, ressources au pluriel (`/sales`, `/sales/:id/cancel`, `/products/:id/movements?from=…&to=…`).
- Actions métier explicites plutôt que PATCH génériques : `POST /sales/:id/validate`, `POST /sales/:id/cancel`, `POST /sales/:id/modify`, `POST /receipts/:id/validate`, `POST /returns`, `POST /payments/:id/allocate`, `POST /cash-sessions/:id/close`, `POST /inventories/:id/validate`, `POST /lots/:id/block`.
- Pagination : `?page=&pageSize=` (ou curseur pour les mouvements et l'audit), tri `?sort=field:asc`.
- Format d'erreur unique : `{ "code": "STOCK_INSUFFICIENT", "message": "…", "details": {…} }`.
- En-têtes : `Idempotency-Key` (RG-23), `X-Device-Id`.
- Schémas Zod partagés dans `packages/shared` → typage de bout en bout.
- OpenAPI généré automatiquement.

---

## 12. TESTS ET QUALITÉ

**Tests unitaires (services de domaine, couverture ≥ 90 %)** — au minimum :
- Allocation FEFO et FIFO : lot unique ; plusieurs lots ; lot périmé ignoré ; lot bloqué ignoré ; péremptions égales départagées par date de réception ; stock insuffisant ; lot forcé.
- Coût unitaire avec unités gratuites ; calculs HT/TVA/TTC, remises, arrondis au millime, timbre fiscal.
- Retour partiel puis complémentaire ; dépassement de quantité refusé ; avoir réduisant d'abord le reste à payer.
- Annulation et modification : stock réintégré dans les bons lots, règlements traités, refus si retour existant.
- Lettrage : répartition automatique, manuelle, reliquat en acompte, annulation de règlement.
- Plafond de crédit ; remise préparateur ; override administrateur.
- Numérotation sans trou sous concurrence.
- Chaîne de hash de l'audit (détection d'une altération).
- Notifications : filtrage des abonnements (événement, employés suivis, seuils, hors horaires), regroupement anti-rafale, construction des résumés et du rapport d'activité, impossibilité de désactiver toutes les alertes critiques.
- File d'envoi : reprises avec délai croissant, abandon après N échecs, respect du quota horaire, **aucun envoi automatique à un client sans consentement**, aucun nom de médicament dans le corps des e-mails clients.

**Tests d'intégration** (vraie base PostgreSQL de test via Docker) : endpoints principaux, transactions, **deux ventes simultanées sur le dernier article** (une seule réussit), triggers interdisant UPDATE/DELETE.

**Tests de permissions** : pour chaque endpoint protégé, le préparateur reçoit `403`.

**Tests de bout en bout (Playwright)** — scénarios :
1. Connexion admin → création produit → réception de 2 lots (péremptions différentes) → vente consommant les deux lots dans le bon ordre → vérification de la fiche de mouvement.
2. Préparateur : vente → tentative d'annulation refusée → admin annule → entrée visible au mouchard, stock réintégré.
3. Retour client → avoir → nouvel achat payé avec l'avoir → solde client correct.
4. Vente à crédit → règlement partiel lettré → règlement du reste → facture soldée.
5. Ouverture de caisse → ventes espèces → clôture à l'aveugle → écart calculé.
6. Inventaire partiel → validation → ajustements corrects.
7. Admin configure le SMTP (Mailpit) et envoie un e-mail de test → s'abonne en « immédiat » aux remises hors plafond de `PRE01` → `PRE01` vend à un client consentant avec une remise hors plafond (override) → le client reçoit sa facture PDF, l'admin reçoit la notification → le rapport d'activité quotidien de `PRE01` est généré correctement. Même scénario avec le SMTP coupé : la vente est validée, l'e-mail part automatiquement au rétablissement.

**CI** (GitHub Actions) : lint, typecheck, tests unitaires et d'intégration, build, à chaque push.

---

## 13. DÉPLOIEMENT ET EXPLOITATION (ÉTAPE 1)

- `docker-compose.yml` (dev) : PostgreSQL + API + web en mode watch + **Mailpit** (capture de tous les e-mails envoyés en développement, consultables dans une interface web locale ; aucun e-mail réel ne part en dev).
- `docker-compose.prod.yml` : Caddy (HTTPS automatique, sert le build statique et proxifie `/api`), API, PostgreSQL (volume persistant, non exposé publiquement), conteneur de sauvegarde planifiée.
- Deux environnements : **recette** (validation par la cliente, données de démonstration) et **production** (données réelles).
- Migrations Prisma appliquées au déploiement, précédées d'une sauvegarde.
- Script de première installation : création du premier administrateur (identifiants demandés en ligne de commande, jamais par défaut en production), paramètres de l'établissement.
- `docs/EXPLOITATION.md` : déploiement, mise à jour, sauvegarde, restauration, rotation des logs, renouvellement des certificats, supervision, **configuration e-mail** (choix du fournisseur SMTP, enregistrements SPF, DKIM et DMARC du domaine expéditeur pour que les e-mails n'arrivent pas en spam).
- Hébergement recommandé : VPS avec sauvegardes, latence faible depuis la Tunisie.
- Recommandation à transmettre à la cliente : connexion Internet de secours (routeur 4G) puisque les données sont en ligne.

---

## 14. ÉTAPE 2 — APPLICATION DE BUREAU (ELECTRON)

À réaliser **uniquement après validation de l'application web**. Préparer dès l'étape 1 :
- un service frontend `platform` (`isDesktop`, `print(document, options)`, `openCashDrawer()`, `getDeviceInfo()`) avec une implémentation web (navigateur) et une implémentation desktop (pont IPC) ;
- l'URL de l'API configurable (variable de build / réglage local), jamais codée en dur.

**Application Electron (`apps/desktop`)** :
- Charge le **build local** du frontend (pas une URL distante) ; communique avec l'API distante en HTTPS.
- Sécurité : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload minimal exposant uniquement les fonctions du service `platform`, CSP stricte, navigation externe bloquée.
- Jeton d'enregistrement du poste stocké via `safeStorage`.
- **Impression silencieuse** sur l'imprimante choisie par poste (ticket 80 mm / A4), sans boîte de dialogue.
- **Tiroir-caisse** : commande ESC/POS via l'imprimante ticket.
- Lecteur code-barres : fonctionne nativement (mode clavier).
- Instance unique, démarrage plein écran optionnel, raccourci bureau.
- **Installateur Windows** (NSIS, x64) avec electron-builder ; signature de code recommandée (certificat à acquérir par la cliente).
- **Mises à jour automatiques** (electron-updater) depuis un serveur de publication ou GitHub Releases ; mise à jour proposée à la fermeture, jamais en pleine vente.
- Détection de connexion et bandeau identique au web.
- La même API, la même base, les mêmes comptes : web et bureau peuvent coexister.

---

## 15. PLAN DE RÉALISATION PAR PHASES

Chaque phase se termine par les critères du §0.4 et une démonstration décrite dans `PROGRESS.md`.

**Phase 0 — Fondations**
Monorepo, Docker, PostgreSQL, Prisma, NestJS, React, `packages/shared`, module `money`, authentification (mot de passe + PIN + refresh), rôles et permissions, guards, postes, paramètres, **module d'audit avec chaîne de hash et triggers**, `document_sequences`, layout de l'interface, écran de connexion, verrouillage d'inactivité, changement rapide d'utilisateur, CI.
*Critère* : un admin et un préparateur se connectent ; les menus et endpoints respectent la matrice ; chaque connexion apparaît au journal.

**Phase 1 — Catalogue, tiers, réceptions, stock**
Produits, codes-barres, catégories, laboratoires, TVA, import Excel ; fournisseurs ; clients ; réceptions (brouillon → validation → lots + mouvements) ; état du stock ; lots ; péremptions ; **fiche de mouvement produit** ; stock à date.
*Critère* : une réception crée les bons lots ; la fiche de mouvement affiche stock initial, mouvements avec utilisateur/date/heure, et solde exact.

**Phase 2 — Ventes et mouchard**
Écran caisse complet (client obligatoire, scan, lots FEFO/FIFO, remises, ordonnance, attente, paiements multiples, crédit, plafond), validation transactionnelle, numérotation, impressions ticket/A4, historique des ventes, **annulation et modification administrateur**, override par code admin, **écran mouchard** avec onglet ventes annulées ; **infrastructure e-mail** (écran SMTP, test d'envoi, file d'envoi, modèles, journal des e-mails) ; envoi automatique de la facture au client ; notification e-mail immédiate de l'administrateur sur annulation / modification de vente.
*Critère* : scénarios E2E 1 et 2 verts ; deux ventes concurrentes sur le dernier article gérées correctement ; facture PDF reçue dans Mailpit ; vente validée même SMTP coupé.

**Phase 3 — Retours, avoirs, comptes clients, règlements**
Retours clients (revendable / non revendable), avoirs, utilisation de l'avoir en vente, grand livre client, relevé, encaissements, lettrage, acomptes, chèques et impayés, balance âgée ; préférences e-mail des clients ; envoi par e-mail des avoirs, reçus et relevés.
*Critère* : scénarios E2E 3 et 4 verts ; soldes clients exacts à tout moment.

**Phase 4 — Caisse, inventaire, ajustements, retours fournisseurs, alertes**
Sessions de caisse, comptage à l'aveugle, rapports X/Z ; inventaire complet et partiel ; ajustements avec validation ; destruction des périmés ; retours fournisseurs ; rappel de lot ; centre de notifications ; suggestions de réapprovisionnement ; tâches planifiées (statuts, cohérence RG-22, intégrité RG-20) ; **page « Mes notifications »** (abonnements par événement, employés suivis, seuils, hors horaires), résumés quotidien / hebdomadaire, **rapport d'activité quotidien par employé**, relances de factures échues.
*Critère* : scénarios E2E 5, 6 et 7 verts.

**Phase 5 — Statistiques, rapports, exports**
Tableaux de bord admin et préparateur, toutes les statistiques du §6.15, rapports imprimables, exports Excel/PDF, commandes fournisseurs avec envoi par e-mail (optionnel).
*Critère* : chiffres des statistiques recoupés par tests avec les données du seed.

**Phase 6 — Durcissement et mise en recette**
Revue de sécurité, tests de charge légers, optimisation des index, PWA, documentation (`GUIDE_UTILISATEUR.md` en français avec captures, `EXPLOITATION.md`), déploiement de l'environnement de recette avec données de démonstration.
*Critère* : application accessible en HTTPS, validée sur la liste de contrôle du §18.

**Phase 7 — Logiciel de bureau (après validation de la cliente)**
Application Electron, impression silencieuse, tiroir-caisse, installateur, mises à jour automatiques (§14).

---

## 16. DONNÉES DE DÉMONSTRATION (SEED)

Seed réaliste, **uniquement en recette/développement** :
- Utilisateurs : 1 administrateur (`ADM01`), 2 préparateurs (`PRE01`, `PRE02`) — mots de passe de démonstration documentés dans le README de dev, **jamais en production**.
- ~150 produits génériques identifiés par leur DCI (ex. Paracétamol 500 mg cp, Amoxicilline 1 g cp, Ibuprofène 400 mg cp…), répartis en catégories, avec codes-barres fictifs.
- 5 fournisseurs fictifs, 30 clients fictifs (particuliers et professionnels, certains avec plafond et impayés).
- Lots aux péremptions variées : quelques lots **déjà périmés**, certains à moins de 30, 60, 90 jours, la majorité au-delà.
- 3 mois d'historique : réceptions, ventes (plusieurs utilisateurs, différentes heures), quelques annulations, retours, avoirs, règlements partiels, sessions de caisse avec un écart — pour alimenter statistiques et mouchard.
- Adresses e-mail fictives en `@example.com` uniquement (une partie des clients avec consentement) ; modèles d'e-mails par défaut ; abonnements par défaut de l'administrateur.

---

## 17. ÉVOLUTIONS FUTURES (HORS PÉRIMÈTRE V1, MAIS À NE PAS BLOQUER)

- Multi-sites / multi-dépôts avec transferts (le `site_id` est déjà prévu).
- Tiers payant / organismes d'assurance maladie.
- Facturation électronique si elle devient applicable à l'établissement.
- Interface en arabe (RTL).
- Mode hors ligne avec synchronisation (complexe à cause des lots : nécessite une étude dédiée).
- Application mobile d'inventaire (scan avec le téléphone).
- Commandes fournisseurs électroniques (EDI).
- Gestion des dettes fournisseurs et paiements fournisseurs complets.

---

## 18. LIVRABLES ET LISTE DE CONTRÔLE DE VALIDATION

**Livrables** : code source complet et versionné ; `README.md` (installation dev, commandes) ; `CLAUDE.md` ; `docs/` (SPEC, PROGRESS, DECISIONS, GUIDE_UTILISATEUR, EXPLOITATION) ; fichiers Docker de dev et de prod ; `.env.example` ; environnement de recette déployé ; puis installateur Windows (phase 7).

**Liste de contrôle — chaque besoin de la cliente doit être démontrable** :
- [ ] Sortie des lots selon FEFO/FIFO, visible sur la vente et dans la fiche de mouvement.
- [ ] Péremptions : saisie obligatoire, alertes, blocage automatique des périmés.
- [ ] Fiche de mouvement d'un produit depuis une date choisie, avec utilisateur, date et heure.
- [ ] Code unique par utilisateur, visible sur documents et journaux.
- [ ] Date et heure sur chaque opération.
- [ ] Entrée en stock avec péremption, quantité, source d'approvisionnement.
- [ ] Mouchard des ventes annulées (et autres événements sensibles).
- [ ] Acheteur obligatoire sur chaque vente.
- [ ] Règlements avec date, montant et factures concernées (lettrage).
- [ ] Statistiques.
- [ ] Séparation Administrateur / Préparateur conforme à la matrice.
- [ ] Retour client → avoir sur compte → réutilisable pour un autre achat.
- [ ] SMTP configurable ; l'administrateur choisit de quoi il est notifié sur l'activité des employés ; les clients reçoivent automatiquement leurs factures et documents par e-mail.

---

## 19. GLOSSAIRE

- **DCI** : dénomination commune internationale (nom de la molécule, ex. paracétamol).
- **Lot** : ensemble d'unités d'un produit fabriquées ensemble, avec un numéro et une date de péremption communs.
- **FIFO** : premier entré, premier sorti (selon la date de réception).
- **FEFO** : premier périmé, premier sorti (selon la date de péremption).
- **UG** : unités gratuites offertes par le fournisseur lors d'un achat.
- **Avoir** : document qui crédite le compte d'un client (suite à un retour), utilisable comme moyen de paiement.
- **Acompte** : somme versée par le client non encore affectée à une facture.
- **Lettrage** : affectation d'un règlement ou d'un avoir à une ou plusieurs factures.
- **Mouchard** : journal des opérations sensibles (annulations, retraits de lignes, remises, overrides…).
- **Override** : autorisation ponctuelle d'une action par un administrateur qui saisit son code.
- **Rapport Z** : rapport de clôture de caisse.
- **Comptage à l'aveugle** : comptage de la caisse sans voir le montant attendu.
- **SMTP** : protocole d'envoi d'e-mails ; le logiciel se connecte au serveur SMTP de l'établissement (hébergeur, Gmail, Outlook…) pour envoyer ses e-mails.
- **File d'envoi (outbox)** : liste d'attente des e-mails à envoyer, traitée en arrière-plan, avec reprises automatiques en cas d'échec.
