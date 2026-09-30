# Décisions techniques et métier

Décisions non prévues (ou précisées) par le cahier des charges, avec leur justification.
Règle appliquée en cas d'ambiguïté : l'option qui préserve le mieux la traçabilité et l'intégrité.

## Technique

| # | Décision | Justification |
|---|---|---|
| T1 | **NestJS 12 (ESM)**, **Prisma 7** (adaptateur `pg`), **React 19**, **Vite 8**, **Tailwind 4**, **Zod 4**. | Versions stables actuelles (§0.8). NestJS 12 est ESM uniquement : tout le monorepo est en ESM. |
| T2 | **TypeScript 6.0** (et non 7.0). | `typescript-eslint` ne supporte pas encore TypeScript 7 (portage natif) ; le lint strict fait partie des critères de fin de phase. |
| T3 | **TanStack Table 8** (et non 9). | L'API de la v9 vient d'être refondue (hooks de fonctionnalités) ; la v8 reste maintenue et stable. Tri / pagination côté serveur. |
| T4 | Tests d'intégration sur une base PostgreSQL dédiée (`pharmastock_test`), schéma recréé à chaque exécution. Docker optionnel (PostgreSQL local accepté). | Tests réalistes (transactions, verrous, triggers). |
| T5 | Montants `BIGINT` exposés en JSON comme **nombres** (`BigInt.prototype.toJSON`), avec contrôle `Number.isSafeInteger`. | Les montants restent < 9 × 10¹⁵ millimes ; évite de manipuler des chaînes dans l'interface. |
| T6 | Horodatages `timestamptz(3)` (milliseconde). | Précision identique à JavaScript : la relecture d'une entrée d'audit redonne exactement la valeur hachée. |
| T7 | **Journal d'audit** : l'écriture est différée juste avant le COMMIT (hook `beforeCommit`), sous verrou consultatif `pg_advisory_xact_lock`, hash = SHA-256(prev_hash ‖ JSON canonique à clés triées). | Le verrou global est pris en dernier (aucun interblocage avec les verrous de lignes des ventes) ; les entrées disparaissent avec une transaction annulée ; l'ordre des `id` correspond à l'ordre de la chaîne. |
| T8 | Identification du poste par deux en-têtes : `X-Device-Id` **et** `X-Device-Token` (jeton secret, stocké haché). | Le cahier cite `X-Device-Id` ; seul, un identifiant serait falsifiable. |
| T9 | Verrouillage d'écran **appliqué côté serveur** : `sessions.locked_at`, verrouillage automatique après inactivité (les requêtes `X-Background: 1` ne comptent pas). | Un simple masquage côté navigateur serait contournable. |
| T10 | Rotation du refresh token avec **délai de grâce de 30 s** en cas de requêtes simultanées ; au-delà, la réutilisation d'un ancien jeton révoque la session (vol présumé). | Plusieurs onglets ou requêtes concurrentes ne doivent pas déconnecter l'utilisateur. |
| T11 | Événements notifiables écrits dans `notification_events` dans la transaction métier (file transactionnelle), traités ensuite par le moteur de notifications. | Même principe que la file d'e-mails (§6.19 E) : rien n'est perdu, rien ne bloque l'opération. |
| T12 | Horloge centralisée `common/clock.ts` ; un mode « horloge figée » n'existe que pour le script de données de démonstration (historique de 3 mois). | Respect de « l'horloge du serveur est la seule source d'horodatage » tout en permettant un seed réaliste et cohérent (mouvements, audit, soldes). |
| T13 | Défense en profondeur base de données : fonction `pharmastock_apply_app_grants()` qui retire `UPDATE/DELETE/TRUNCATE` sur les tables en ajout seul au rôle applicatif `pharmastock_app` (production). | §7 « L'utilisateur PostgreSQL de l'application n'a pas le droit DELETE sur ces tables ». |
| T14 | Recherche tolérante : colonne `search_text` normalisée (minuscules, sans accents) + index trigramme `pg_trgm`. | Recherche < 200 ms sur 50 000 produits, tolérante aux accents et fautes légères. |

## Sécurité et accès

| # | Décision | Justification |
|---|---|---|
| S1 | **Amorçage des postes** : si aucun poste n'est encore approuvé, le premier administrateur qui se connecte approuve automatiquement son poste (tracé). Commande `cli approve-device` en secours. | Sinon, avec l'approbation obligatoire, personne ne pourrait se connecter à la première installation. |
| S2 | `security.require_device_approval` : activé par défaut en production, désactivé en développement (surchargeable dans les paramètres). | Conforme au §5.5 (« défaut : activé en production »). |
| S3 | **Autorisation administrateur (🔑)** : l'action échoue avec `OVERRIDE_REQUIRED` et la liste des autorisations nécessaires ; le poste renvoie la même action avec `override: { userCode, pin, reason }`. Un administrateur ne peut pas s'autoriser lui-même. Les échecs sont tracés (`OVERRIDE_FAILED`) après l'annulation de la transaction. | Autorisation à usage unique, liée à une seule exécution, entièrement tracée (`performed_by` + `authorized_by`). |
| S4 | Écran verrouillé sur un poste partagé : un autre utilisateur peut saisir **son code + PIN** ; la session verrouillée est fermée et une nouvelle session est ouverte à son nom (`USER_SWITCHED`). | Usage réel au comptoir (§5.3 « changement rapide d'utilisateur »). |
| S5 | Les échecs de PIN comptent pour le verrouillage du compte (même seuil que le mot de passe). | Empêche de deviner un PIN à 4 chiffres. |
| S6 | Permissions ajoutées à la matrice : `sales.below_cost`, `sales.walk_in`, `returns.approve` (retour sans code admin), `returns.late`, `returns.without_sale`, `clients.create`, `inventory.manage` (ouvrir / valider un inventaire). | Granularité nécessaire pour les cas 🔑 et ⚙️ du §5.2. |
| S7 | Le rôle Administrateur dispose **toujours** de toutes les permissions (non modifiable) ; le rôle Préparateur est modifiable (⚙️) mais ni renommable ni supprimable. | §5.1. |
| S8 | Politique de mot de passe : longueur minimale paramétrable (8 par défaut) + au moins une lettre et un chiffre. | §5.3. |

## Métier

| # | Décision | Justification |
|---|---|---|
| M1 | Arrondi « half up » **symétrique** (0,5 millime s'éloigne de zéro). | Une annulation produit exactement l'opposé du montant initial. |
| M2 | HT et TVA d'une vente calculés **par taux** sur le cumul TTC des lignes (et non ligne par ligne). | Limite les écarts d'arrondi sur la facture ; HT + TVA + timbre = TTC exactement. |
| M3 | **Timbre fiscal** : 1,000 DT par défaut (à confirmer), appliqué selon `tax.stamp_duty_scope` : clients professionnels par défaut (pharmacie, clinique, hôpital, association, entreprise), ou toutes les ventes, ou jamais. Fixé à la validation. | Le total d'une vente doit être figé à la validation ; en Tunisie le timbre s'applique aux factures, pas aux tickets des particuliers. |
| M4 | Taux de TVA initiaux : 0 %, 7 % (défaut, médicaments), 13 %, 19 % — **à confirmer par le comptable**. | §2. |
| M5 | Coupures de caisse pré-remplies : billets 50/20/10/5 DT ; pièces 5, 2, 1 DT, 500, 200, 100, 50, 20, 10 millimes — **à vérifier**. | §6.11. |
| M6 | Le « client comptoir » (si activé) est un client système unique (`is_walk_in`) : jamais de vente à crédit ni d'avoir pour lui. | RG-09 ; toutes les ventes gardent un `client_id`. |
| M7 | Tout règlement reçoit un numéro `REG-AAAA-NNNNNN`, y compris les paiements saisis à la caisse. | Numérotation continue et lettrage uniforme. |
| M8 | Coût unitaire des lots exprimé **par unité de base** (arrondi au millime) ; quantités de réception saisies en boîtes puis converties si la vente à l'unité est active. `units_per_pack` et `sell_by_unit` ne sont plus modifiables dès qu'un produit a des mouvements. | RG-07 : le stock est tenu en unité de base ; changer l'unité après coup fausserait les quantités. |
| M9 | Les brouillons (réception, ajustement en attente, panier) n'ont pas de numéro ; le numéro est attribué à la validation. | RG-10. |
