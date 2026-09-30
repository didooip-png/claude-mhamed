# tools/docs — manuels PDF, aide-mémoire et FAQ

Génère la documentation utilisateur **à partir du logiciel lui-même** : les captures d'écran sont prises en
pilotant le vrai site sur les données de démonstration, donc les images correspondent exactement à la
version livrée. Le texte vient de l'unique source de l'aide (`packages/shared/src/help`), la même que le
bouton « ? » du logiciel : manuel, aide intégrée et FAQ ne peuvent pas se contredire.

## Résultat

| Fichier (`docs/manuels/` et `apps/web/public/manuels/`) | Contenu                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PharmaStock-Manuel-Administrateur.pdf`                 | Toutes les procédures, écran par écran, étapes numérotées, sommaire paginé |
| `PharmaStock-Manuel-Preparateur.pdf`                    | Vente, encaissement, retour, réception, inventaire, clôture de caisse      |
| `PharmaStock-Aide-memoire-Preparateur.pdf`              | Une page A4 à imprimer : raccourcis de caisse, vente, retour               |
| `PharmaStock-FAQ-Que-faire-si.pdf`                      | « Que faire si… » : stock insuffisant, e-mail non reçu, code oublié…       |

Les PDF sont versionnés dans le dépôt et servis par le site (`/manuels/…`, onglet « Manuels PDF » de la page Aide).

## Utilisation

```bash
pnpm docs:build                       # tout : base de démo, captures, PDF (compter 8 à 10 minutes)
pnpm docs:build -- --shots-only       # captures seulement
pnpm docs:build -- --pdf-only         # PDF seulement, à partir des captures en cache
pnpm docs:build -- --only=pos-cart,cash   # ne refaire que ces scènes
pnpm docs:build -- --strict           # échoue si une capture manque
```

Prérequis : PostgreSQL local (l'utilisateur de l'application peut créer des bases), Chromium de Playwright
(`DOCS_CHROMIUM_PATH` pour en indiquer un autre). La base `pharmastock_docs` est recréée à chaque exécution :
la base de développement n'est jamais touchée. Ports : API 3400, site 5373, boîte e-mail 2526 / 8027.

## Comment ça marche

- `lib/stack.mjs` — recrée la base, applique les migrations, charge le seed, lance API + site + boîte de capture
  d'e-mails (un vrai serveur SMTP local : aucun message ne sort de la machine).
- `lib/scenes.mjs` — une scène par capture (`shot` d'une fiche d'aide). Chaque scène exécute les gestes d'un
  utilisateur (préparateur ou administrateur), puis pose des pastilles numérotées qui correspondent aux étapes
  du manuel (`marks`).
- `lib/shots.mjs` — exécute les scènes, enregistre `.cache/shots/<id>.<RÔLE>.jpg`.
- `lib/render.mjs` — assemble les PDF (Chromium pour la mise en page, `pdf-lib` pour l'assemblage et les pieds de page).

## Ajouter ou modifier une fiche

1. Écrire la fiche dans `packages/shared/src/help/topics-*.ts` (champ `shot` = identifiant de capture).
2. Ajouter la scène correspondante dans `lib/scenes.mjs`.
3. `pnpm docs:build`, relire les PDF, valider (`git add docs/manuels apps/web/public/manuels`).

Les libellés cités entre « guillemets » dans les fiches doivent être ceux de l'interface : les scènes échouent
(et le build avec `--strict`) si un bouton cité a changé de nom.
