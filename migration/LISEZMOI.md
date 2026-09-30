# PharmaStock — dossier de migration vers votre serveur (VPS)

Ce dossier contient **tout** ce qu'il faut pour installer PharmaStock « pour de vrai » sur votre propre serveur :
le logiciel complet, son historique, le mode d'emploi pour vous, et un guide écrit pour **Claude Code** qui fera
l'installation à votre place sur le serveur.

> **En une phrase** : vous louez un serveur, vous y copiez ce dossier, vous lancez Claude Code dedans, vous collez le
> message de `PROMPT_CLAUDE_CODE.txt` — et Claude Code installe, configure et vérifie tout en vous expliquant.

---

## Ce que contient le dossier

| Élément                                       | À quoi il sert                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `LISEZMOI.md`                                 | Ce document : ce que **vous** avez à faire.                                                                                                |
| `CONTEXTE_CLAUDE_CODE.md`                     | Le guide complet pour **Claude Code** : ce qui a été construit, comment déployer, comment vérifier, ce qui reste à valider.                |
| `PROMPT_CLAUDE_CODE.txt`                      | Le message à coller dans Claude Code au démarrage (à compléter avec votre nom de domaine).                                                 |
| `code/`                                       | Le logiciel complet (site, serveur, application Windows, documentation, manuels PDF).                                                      |
| `PharmaStock.git.bundle`                      | Tout l'historique du projet (chaque étape, chaque décision). Sert à recréer un dépôt Git : `git clone PharmaStock.git.bundle pharmastock`. |
| `VERSION.txt`, `HISTORIQUE.txt`, `SHA256SUMS` | Version exacte, liste des étapes (commits) et empreintes des fichiers (pour vérifier que rien n'a été altéré pendant le transfert).        |

Les **manuels PDF** (Administrateur, Préparateur), l'**aide-mémoire d'une page** à imprimer pour les préparateurs et la
**FAQ « Que faire si… »** sont dans `code/docs/manuels/`.

---

## Ce qu'il vous faut avant de commencer

1. **Un serveur (VPS)** sous **Ubuntu 22.04 ou 24.04** (ou Debian 12) : 2 vCPU, **4 Go de RAM**, 40 Go de disque, une
   adresse IP fixe. Compter environ 5 à 10 € par mois chez les hébergeurs courants (Hetzner, OVH, Contabo, Scaleway…).
   Choisissez un hébergeur en Europe, et activez leur option de **sauvegarde de l'image du serveur** si elle existe.
2. **Un nom de domaine** (ex. `pharmacie-ennasr.tn`) et le droit de modifier ses réglages DNS. Créez un enregistrement
   **A** (par exemple `stock.pharmacie-ennasr.tn`) qui pointe vers l'adresse IP du serveur. Sans cela, le cadenas
   HTTPS (obligatoire pour installer l'application sur téléphone) ne peut pas être obtenu.
3. **Les identifiants du serveur d'e-mails (SMTP)** : hôte, port, identifiant, mot de passe, adresse d'expéditeur
   (fournis par votre hébergeur de messagerie). Vous les saisirez **vous-même dans le site**, jamais dans un fichier
   ni dans une conversation.
4. **Un accès SSH** au serveur (l'hébergeur vous envoie une adresse IP et un mot de passe ou une clé). Sous Windows,
   ouvrez _PowerShell_ et tapez `ssh root@ADRESSE_IP`.
5. **Un compte Claude** pour utiliser Claude Code sur le serveur (installation : voir la documentation officielle
   de Claude Code, https://docs.claude.com — commande courante : `npm install -g @anthropic-ai/claude-code` après
   avoir installé Node.js 22).
6. **Un gestionnaire de mots de passe** (Bitwarden, 1Password, KeePass…) pour ranger la clé de chiffrement (voir plus bas).

---

## Les étapes

**1. Préparer le serveur.** Connectez-vous en SSH. Copiez ce dossier sur le serveur sous le nom `PharmaStock-migration`,
par exemple depuis votre PC (remplacez la date par celle de votre dossier) :

```
scp -r PharmaStock-migration-AAAAMMJJ root@ADRESSE_IP:/root/PharmaStock-migration
```

(ou envoyez l'archive `.zip` / `.tar.gz` puis décompressez-la sur le serveur : `unzip PharmaStock-migration-*.zip` puis
`mv PharmaStock-migration-* PharmaStock-migration`). Puis, sur le serveur :

```
cd /root/PharmaStock-migration/code
sudo bash migration/scripts/vps-preparer.sh
```

Ce script installe Docker, active le pare-feu (seuls SSH, HTTP et HTTPS restent ouverts), les mises à jour de
sécurité automatiques et le fuseau horaire de Tunis. Il ne supprime rien et peut être relancé.

> **Conseil de sécurité** (recommandé, facultatif) : plutôt que de travailler en `root`, créez un utilisateur
> normal (`adduser pharma && usermod -aG sudo,docker pharma`), copiez le dossier dans `/home/pharma/` et lancez
> Claude Code avec cet utilisateur : il ne pourra alors rien faire d'irréparable sans `sudo`.

**2. Lancer Claude Code dans le dossier du code.**

```
cd /root/PharmaStock-migration/code
claude
```

**3. Coller le message de démarrage.** Ouvrez `PROMPT_CLAUDE_CODE.txt`, remplacez la ligne « nom de domaine » par le
vôtre, collez le tout dans Claude Code. Claude va lire son guide, puis :

- générer les secrets du serveur (fichier `.env.production`, jamais versionné) ;
- construire et démarrer le logiciel (PostgreSQL + serveur + site en HTTPS) ;
- vous demander de **créer le premier administrateur** : la commande vous pose les questions dans le terminal, c'est
  **vous** qui tapez le mot de passe et le PIN ;
- vérifier que tout répond, que le cadenas HTTPS est valide, qu'une sauvegarde se fait.

**4. Configurer les e-mails (vous, dans le site).** Ouvrez `https://votre-domaine`, connectez-vous en administrateur,
allez dans **Administration → E-mail & notifications**, saisissez les identifiants SMTP, envoyez un e-mail de test à
votre adresse, puis activez l'envoi. Le mot de passe est stocké chiffré dans la base.

**5. Créer les comptes de l'équipe.** **Administration → Utilisateurs** : un compte par personne (rôle « Préparateur »
pour les vendeurs). Chaque ordinateur ou téléphone doit ensuite être **approuvé** une fois dans **Administration →
Postes de travail**.

**6. Distribuer les documents.** Imprimez l'**aide-mémoire du préparateur** et posez-le près de la caisse. Le manuel
de chaque rôle se télécharge aussi dans le site (menu **Aide → Manuels PDF**).

**7. Téléphones.** Sur Android (Chrome) ou iPhone (Safari), ouvrez `https://votre-domaine` : un bouton **Installer**
apparaît en haut à droite et ajoute l'icône PharmaStock à l'écran d'accueil, sans passer par un magasin d'applications.

**8. Postes de caisse Windows (facultatif).** L'application Windows (impression des tickets sans boîte de dialogue,
ouverture du tiroir-caisse) se **construit sur votre VPS Linux**, sans ordinateur Windows ni GitHub : demandez à Claude
Code « construis l'application Windows », ou lancez vous-même
`bash migration/scripts/construire-application-windows.sh`. Vous récupérez un fichier `.zip` (~170 Mo) avec `scp`, vous le
décompressez sur le PC de caisse (par exemple dans `C:\PharmaStock`) et vous lancez `PharmaStock.exe`. Tout est expliqué
dans `code/docs/DESKTOP.md`.

---

## À faire absolument

- **Clé de chiffrement** : le script crée le fichier `~/pharmastock-secrets-A-SAUVEGARDER.txt`. Copiez-le dans votre
  gestionnaire de mots de passe (`scp root@ADRESSE_IP:pharmastock-secrets-A-SAUVEGARDER.txt .`), puis supprimez-le du
  serveur. **Sans la clé `APP_ENCRYPTION_KEY`**, si le serveur est perdu, le mot de passe SMTP et les codes 2FA
  enregistrés ne sont pas récupérables (le reste des données, si).
- **Sauvegardes hors du serveur** : le logiciel sauvegarde chaque nuit **sur le serveur**. Une panne du serveur emporterait
  aussi ces copies : configurez une copie externe (stockage compatible S3 : Backblaze B2, Cloudflare R2… — voir
  `code/docs/EXPLOITATION.md` §6) ou téléchargez régulièrement une sauvegarde (Administration → Sauvegardes).
- **Faites un essai de restauration** une fois (procédure `docs/EXPLOITATION.md` §7.1) : une sauvegarde qu'on n'a jamais
  restaurée n'est pas une garantie.
- **Ne partagez jamais** le contenu de `.env.production` ni les mots de passe, même avec un assistant.

---

## Ce qui n'a pas pu être vérifié avant la livraison (soyez-en informé)

Le logiciel est complet et testé automatiquement (tests d'intégration, 8 scénarios de bout en bout, construction des
images Docker et démarrage de la pile dans la CI). Mais, faute d'environnement réel, **ces éléments se valident chez
vous** :

- l'obtention du certificat HTTPS avec **votre** domaine ;
- l'envoi d'e-mails avec **votre** serveur SMTP (et leur bonne réception : réglages SPF/DKIM/DMARC de votre domaine) ;
- l'**imprimante de tickets** et le **tiroir-caisse** avec l'application Windows (recette dans `docs/DESKTOP.md`) ;
- l'application Windows sur un vrai PC (elle se construit et son contenu est vérifié depuis Linux, mais elle n'a jamais
  tourné sur Windows) ;
- la copie de sauvegarde vers un stockage S3 externe.

`CONTEXTE_CLAUDE_CODE.md` liste ces points comme une **check-list de recette** que Claude Code déroulera avec vous.

---

## En cas de problème

1. Demandez à Claude Code (dans le dossier du code) : « Le site ne répond plus, diagnostique. » Il dispose du guide de
   dépannage (`docs/EXPLOITATION.md` §14).
2. Les données ne sont pas perdues quand le site ne répond plus : elles sont dans la base PostgreSQL (volume Docker),
   sauvegardée chaque nuit.
3. Ne supprimez jamais les volumes Docker (`docker compose down -v`) : cela efface la base.
