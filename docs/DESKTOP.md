# PharmaStock — application Windows (Electron)

L'application de bureau est une **fenêtre dédiée** au site PharmaStock, avec ce qu'un navigateur ne peut pas
faire : **impression silencieuse** des tickets et factures, **ouverture du tiroir-caisse**, **jeton du poste
chiffré par Windows**, **mises à jour** proposées à la fermeture. Même serveur, mêmes comptes, mêmes données que
le site : les deux peuvent être utilisés en même temps sur des postes différents.

Code : `apps/desktop`. Spécification : `docs/SPEC.md` §14.

## Installer sur un poste de caisse

**Version portable (`PharmaStock-X.Y.Z-win-x64.zip`, recommandée — se construit sur le VPS Linux)**

1. Copier le `.zip` sur le PC de caisse et le **décompresser** dans un dossier durable, par exemple `C:\PharmaStock`
   (pas dans « Téléchargements »).
2. Lancer `C:\PharmaStock\PharmaStock.exe`. Clic droit sur `PharmaStock.exe` → _Envoyer vers_ → _Bureau (créer un
   raccourci)_ ; pour un lancement automatique avec Windows, cocher l'option dans les réglages du poste (étape 3).
3. Mise à jour : décompresser le nouveau `.zip` **par-dessus** l'ancien dossier (fermer l'application avant). Les
   réglages et la session sont dans `%APPDATA%\PharmaStock` et ne sont pas touchés. La version portable ne cherche pas
   de mise à jour toute seule.
4. Windows SmartScreen peut afficher un avertissement au premier lancement tant que l'application n'est pas
   **signée** (voir plus bas) : _Informations complémentaires → Exécuter quand même_.

**Version avec installateur (`PharmaStock-Setup-X.Y.Z.exe`, facultative)** : installation pour l'utilisateur courant,
sans droits d'administrateur, raccourci sur le bureau, **mises à jour automatiques** proposées à la fermeture (si une
adresse de publication est configurée). Elle se construit avec Wine (voir « Construire »).

Puis, dans les deux cas :

1. Au premier lancement, la fenêtre **Réglages du poste** s'ouvre :
   - **Adresse du serveur** : celle du navigateur (`https://pharmacie.exemple.tn`). `http://` n'est admis que sur le
     réseau local (`192.168.x.x`, `localhost`…) ;
   - **Imprimante des tickets** (80 mm) : c'est aussi celle qui reçoit l'ouverture du tiroir-caisse ;
   - **Imprimante des factures A4** ;
   - boutons **Ticket de test**, **Page A4 de test**, **Ouvrir le tiroir** pour vérifier avant d'enregistrer.
2. Nommer le poste (le nom de l'ordinateur est proposé), se connecter ; un administrateur **approuve** le poste
   dans _Administration → Postes de travail_ (le premier poste d'un administrateur est approuvé d'office).

Les réglages se rouvrent avec _Poste → Réglages du poste_ (`Ctrl+,`) ou le menu du profil.
`F11` : plein écran. Ils sont stockés dans `%APPDATA%\PharmaStock`.

## Comment ça marche

| Sujet           | Choix                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface       | Le **build local** du site est chargé via le protocole `app://pharmastock` (aucune page distante n'est exécutée).                                                                                                                                              |
| API             | Les appels `/api/…` du site sont **relayés par le processus principal** vers le serveur configuré. Le site reste « même origine » : pas de CORS à configurer, et le cookie de renouvellement (`SameSite=Strict`) est géré par le relais et chiffré sur disque. |
| Isolation       | `contextIsolation`, `sandbox`, pas de Node dans le site, CSP identique à la production, navigation et ouvertures de fenêtres externes bloquées (seuls les aperçus PDF `blob:` s'ouvrent), aucune permission (caméra, micro…).                                  |
| Pont            | `window.pharmastockDesktop` : `print`, `openCashDrawer`, `getDeviceInfo`, `openSettings`, `deviceStore`, `version` — rien d'autre. Les appels sont refusés s'ils ne viennent pas des pages de l'application.                                                   |
| Jeton du poste  | Chiffré avec `safeStorage` (DPAPI sous Windows), jamais dans le stockage web.                                                                                                                                                                                  |
| Impression      | PDF du serveur → imprimante choisie, sans boîte de dialogue (`pdf-to-printer`, SumatraPDF embarqué). Ticket : échelle réelle ; A4 : ajusté à la page.                                                                                                          |
| Tiroir-caisse   | Impulsion ESC/POS `1B 70 00 32 C8` envoyée en RAW à l'imprimante de tickets par le spouleur Windows (PowerShell, nom d'imprimante passé par l'environnement, jamais interpolé). Le tiroir se branche sur l'imprimante (RJ11/RJ12).                             |
| Mises à jour    | `electron-updater`, téléchargement en arrière-plan ; l'installation est **proposée à la fermeture**, jamais en pleine vente.                                                                                                                                   |
| Instance unique | Un second lancement ramène la fenêtre existante au premier plan.                                                                                                                                                                                               |

## Construire l'application (sur le VPS Linux)

Aucun PC Windows ni GitHub n'est nécessaire : l'application Windows se **construit depuis Linux**, sur le VPS.

```bash
# Prérequis (une fois) : Node.js 22 et pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs && sudo corepack enable

cd <dossier du code>
bash migration/scripts/construire-application-windows.sh          # dossier portable .zip (sans Wine)
# → apps/desktop/release/PharmaStock-X.Y.Z-win-x64.zip  (+ empreinte .sha256)
```

Récupérer le fichier sur votre PC : `scp root@ADRESSE_IP:/chemin/apps/desktop/release/PharmaStock-*-win-x64.zip .`
(~170 Mo ; le téléchargement d'Electron par le script demande un accès Internet sortant).

**Installateur `.exe` (NSIS)** : `bash migration/scripts/construire-application-windows.sh --installateur`. Sous Linux, il
demande **Wine** (`sudo dpkg --add-architecture i386 && sudo apt-get update && sudo apt-get install -y wine wine32 wine64`) ;
Wine permet aussi d'appliquer l'icône et les informations de version à `PharmaStock.exe`. Sans Wine, le script construit
le dossier portable, qui contient exactement la même application.

> Vérifié : la construction du paquet portable Windows depuis Linux (Electron 44, sans Wine) produit un dossier complet
> (`PharmaStock.exe`, `app.asar`, SumatraPDF de `pdf-to-printer` hors archive). Non vérifié sur un vrai Windows :
> voir la recette ci-dessous.

Autres voies (facultatives) : le workflow GitHub `.github/workflows/desktop.yml` (onglet _Actions_ → _Application Windows_ →
_Run workflow_) construit l'installateur sur un exécuteur Windows ; sur un PC Windows,
`pnpm --filter @pharmastock/desktop dist:installer`.

Développement (n'importe quel système) :

```bash
PHARMASTOCK_SERVER_URL=http://127.0.0.1:3000 pnpm --filter @pharmastock/desktop start
# Vérification automatique de bout en bout (Linux sans écran : préfixer par xvfb-run -a)
PHARMASTOCK_SERVER_URL=http://127.0.0.1:3000 pnpm --filter @pharmastock/desktop smoke
```

### Signature de code (recommandée)

Sans signature, Windows SmartScreen met en garde au premier lancement. Acheter un certificat de signature de code
(OV ou EV) au nom de l'établissement, puis fournir à la construction les variables `CSC_LINK` (certificat `.pfx` encodé
en base64 ou chemin) et `CSC_KEY_PASSWORD` (Wine requis sous Linux pour signer, ou signer sur un poste Windows).
electron-builder signe alors l'application.

### Mises à jour automatiques (version avec installateur)

1. Héberger un dossier HTTPS servi statiquement (ex. `https://pharmacie.exemple.tn/desktop/`).
2. Construire avec l'adresse : `pnpm --filter @pharmastock/desktop exec electron-builder --win nsis --x64 --publish never -c.publish.provider=generic -c.publish.url=https://.../desktop/` (ou le workflow, entrée `update_url`).
3. Publier dans ce dossier `PharmaStock-Setup-X.Y.Z.exe`, `latest.yml` et le `.blockmap`.
4. Les postes vérifient au démarrage puis toutes les 4 heures ; la mise à jour est proposée à la fermeture.

Sans adresse de publication (et avec la version portable), l'application ne cherche pas de mise à jour : on remplace le
dossier par le nouveau `.zip`.

## Dépannage

| Symptôme                              | Piste                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| « Aucun serveur n'est configuré »     | Ouvrir _Poste → Réglages du poste_ et saisir l'adresse.                                                                                                                              |
| Bandeau « hors ligne »                | Le serveur est injoignable depuis ce poste (Internet, pare-feu, mauvaise adresse).                                                                                                   |
| Rien ne s'imprime                     | Vérifier l'imprimante dans les réglages puis _Ticket de test_. Le journal `%APPDATA%\PharmaStock\logs\desktop.log` (menu _Aide → Ouvrir le dossier des journaux_) contient l'erreur. |
| Le tiroir ne s'ouvre pas              | Le tiroir doit être branché sur l'imprimante de tickets ; certains modèles attendent la broche 5 (`1B 70 01 …`) — à signaler pour ajuster `src/escpos.ts`.                           |
| Écran de connexion à chaque lancement | Le chiffrement Windows (DPAPI) est indisponible pour cet utilisateur : la session ne peut pas être conservée.                                                                        |
| SmartScreen bloque l'installateur     | Non signé : « Informations complémentaires → Exécuter quand même », ou signer l'installateur.                                                                                        |

## Limites connues

- L'impression silencieuse et le tiroir-caisse sont **propres à Windows** ; sur les autres systèmes (développement),
  l'impression ouvre le PDF dans le lecteur du système et le tiroir renvoie une erreur explicite.
- Le pilotage réel de l'imprimante et du tiroir n'a pas pu être testé sans matériel : à valider sur le poste de
  caisse (recette ci-dessous).

## Recette sur le poste de caisse

1. **Ticket de test** dans les réglages : un ticket 80 mm sort, sans boîte de dialogue.
2. **Page A4 de test** : une page A4 sort sur l'imprimante A4 choisie.
3. **Ouvrir le tiroir** : le tiroir s'ouvre (sinon voir Dépannage).
4. Faire une vente en espèces : le ticket s'imprime seul à la validation et le tiroir s'ouvre à l'ouverture de la
   caisse ; la réimpression depuis le détail d'une vente imprime sans dialogue.
5. Fermer l'application avec une mise à jour prête : la proposition d'installation apparaît à la fermeture.
6. Redémarrer l'ordinateur : la session ne demande que le PIN d'écran (jeton du poste conservé).
