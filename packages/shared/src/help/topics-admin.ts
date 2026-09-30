import type { HelpTopic } from './types.js';

const BOTH = ['ADMIN', 'PREPARER'] as const;
const ADMIN = ['ADMIN'] as const;

/** Rapports, mouchard, administration, compte personnel et installation. */
export const TOPICS_ADMIN: HelpTopic[] = [
  // --------------------------------------------------------------------------- Rapports
  {
    id: 'reports',
    chapter: 'reports',
    title: 'Statistiques et rapports',
    routes: ['/reports'],
    roles: [...ADMIN],
    summary:
      'Le centre de rapports regroupe les analyses par famille : Ventes, Marges, Stock, Péremptions et pertes, Achats, Retours et annulations, Créances, Caisse, Journaux et états réglementaires.',
    steps: [
      'Choisissez un rapport dans la liste de gauche (sur téléphone : le sélecteur en haut).',
      'Réglez la période (aujourd’hui, semaine, mois, année ou dates précises) et, au besoin, les filtres proposés.',
      'Sur le rapport « Chiffre d’affaires », choisissez « Période précédente » ou « Année précédente » dans « Comparaison » pour mettre les deux périodes en regard.',
      'Exportez en Excel ou en PDF avec les boutons d’export : le fichier reprend exactement ce qui est affiché.',
    ],
    tips: [
      'Un rapport qui demande un critère (par exemple la traçabilité d’un lot) affiche « Précisez le critère » tant que celui-ci n’est pas rempli.',
      'Les montants sont en dinars, calculés au millime : aucun arrondi caché.',
    ],
    shot: 'reports',
    shotCaption: 'Centre de rapports',
  },
  {
    id: 'report-detail',
    chapter: 'reports',
    title: 'Lire un rapport',
    routes: ['/reports/:id'],
    roles: [...ADMIN],
    summary:
      'Un rapport affiche un graphique, des totaux et le tableau détaillé. Les colonnes se trient d’un clic sur leur titre.',
    steps: [
      'Vérifiez la période et les filtres en haut : ils déterminent tous les chiffres.',
      'Lisez d’abord les totaux, puis descendez dans le tableau pour trouver l’origine d’un écart.',
      'Touchez une ligne quand elle est cliquable pour ouvrir la vente, le lot ou le client concerné.',
      'Exportez si vous devez transmettre le rapport (comptable, associé).',
    ],
    warnings: [
      'Les rapports « Journaux et états réglementaires » (TVA, registre des produits à tableau, traçabilité d’un lot) sont des documents officiels : exportez-les en PDF et conservez-les.',
    ],
    shot: 'report-detail',
  },
  // --------------------------------------------------------------------------- Mouchard
  {
    id: 'audit',
    chapter: 'audit',
    title: 'Mouchard',
    routes: ['/audit'],
    roles: [...ADMIN],
    summary:
      'Le journal infalsifiable de toutes les opérations sensibles : qui a fait quoi, quand, depuis quel poste, avec l’état avant et après. Il est en ajout seul et chaîné : rien ne peut y être modifié ni supprimé.',
    steps: [
      'Onglet « Journal » : filtrez par date, utilisateur, poste ou type d’événement, puis ouvrez une ligne pour voir le détail avant / après.',
      'Onglet « Ventes annulées » : toutes les annulations et modifications, avec le motif et l’autorisation utilisée.',
      'Onglet « Indicateurs par utilisateur » : annulations, remises, retours et écarts de caisse rapportés à l’activité de chacun.',
      'Onglet « Activité du jour » : la synthèse de la journée, la même que celle envoyée par e-mail.',
    ],
    tips: [
      'Un pic d’annulations, de remises ou d’écarts de caisse chez une même personne est le signal à surveiller.',
    ],
    warnings: [
      'Les préparateurs n’ont pas accès au mouchard, et ne voient jamais l’activité des autres employés.',
    ],
    shot: 'audit',
    shotCaption: 'Le mouchard',
  },
  // --------------------------------------------------------------------------- Administration
  {
    id: 'users',
    chapter: 'admin',
    title: 'Utilisateurs',
    routes: ['/admin/users'],
    roles: [...ADMIN],
    summary:
      'Les comptes du personnel. Chaque personne a un code (utilisé sur les autorisations et les documents), un identifiant de connexion, un mot de passe et un PIN à elle.',
    steps: [
      'Touchez « Nouvel utilisateur » et renseignez le code, l’identifiant, le nom, l’e-mail et le rôle.',
      'Saisissez un mot de passe provisoire et un PIN de 4 à 6 chiffres : la personne devra changer son mot de passe à la première connexion.',
      'Depuis le menu « Actions » d’une ligne : Modifier, Réinitialiser mot de passe / PIN, Déverrouiller le compte (après trop d’essais), Désactiver ou Réactiver.',
    ],
    tips: [
      'On ne supprime jamais un utilisateur : on le désactive. Son historique reste intact et son code n’est pas réutilisé.',
      'Vous ne pouvez pas vous désactiver vous-même.',
    ],
    warnings: [
      'Ne communiquez pas le mot de passe provisoire par un canal partagé : remettez-le en main propre.',
    ],
    shot: 'users',
    shotCaption: 'Utilisateurs',
  },
  {
    id: 'roles',
    chapter: 'admin',
    title: 'Rôles et permissions',
    routes: ['/admin/roles'],
    roles: [...ADMIN],
    summary:
      'Un rôle est un ensemble de permissions. Les rôles « Administrateur » et « Préparateur » sont fournis ; vous pouvez en créer d’autres, par exemple pour un caissier ou un responsable des achats.',
    steps: [
      'Choisissez un rôle dans la liste.',
      'Cochez ou décochez les permissions, regroupées par domaine (ventes, stock, achats, caisse…).',
      'Enregistrez : le changement s’applique aux sessions ouvertes et il est tracé au mouchard.',
      'Pour un nouveau rôle : « Nouveau rôle », donnez un nom puis cochez ses permissions.',
    ],
    tips: [
      'Une action marquée d’une clé 🔑 reste possible pour un préparateur avec l’autorisation ponctuelle d’un administrateur (code + PIN), même si sa permission n’est pas cochée.',
    ],
    warnings: [
      'Un rôle système ne se supprime pas. Un rôle encore attribué à des utilisateurs non plus.',
      'N’accordez « Autorisation administrateur » qu’à des personnes de confiance : elle permet d’autoriser les actions sensibles.',
    ],
    shot: 'roles',
  },
  {
    id: 'devices',
    chapter: 'admin',
    title: 'Postes de travail',
    routes: ['/admin/devices'],
    roles: [...ADMIN],
    summary:
      'Chaque ordinateur, téléphone ou tablette doit être approuvé avant de servir : c’est ce qui empêche un inconnu de se connecter depuis chez lui.',
    steps: [
      'Sur le nouvel appareil, ouvrez le site et donnez un nom au poste (« Comptoir 1 », « Téléphone de Sami »).',
      'Le poste apparaît ici avec l’état « En attente ».',
      'Ouvrez le menu de la ligne puis « Approuver ».',
      'Pour retirer un appareil perdu ou volé : « Révoquer ». Il est déconnecté aussitôt.',
    ],
    tips: ['« Ce poste » indique l’appareil sur lequel vous êtes en ce moment.'],
    warnings: ['Vous ne pouvez pas révoquer le poste que vous utilisez.'],
    shot: 'devices',
    shotCaption: 'Postes de travail',
  },
  {
    id: 'sessions',
    chapter: 'admin',
    title: 'Sessions actives',
    routes: ['/admin/sessions'],
    roles: [...ADMIN],
    summary:
      'Qui est connecté en ce moment, depuis quel poste, et depuis quand. Un écran verrouillé est signalé « Écran verrouillé ».',
    steps: [
      'Repérez la session à fermer (personne partie sans se déconnecter, appareil perdu).',
      'Touchez « Déconnecter » sur sa ligne : la personne devra se reconnecter.',
    ],
    shot: 'sessions',
  },
  {
    id: 'settings',
    chapter: 'admin',
    title: 'Paramètres',
    routes: ['/admin/settings'],
    roles: [...ADMIN],
    summary:
      'Tous les réglages métier de l’établissement, en groupes : Établissement, Général, Stock et péremptions, TVA et timbre fiscal, Numérotation des documents, Ventes, Retours, Caisse, Sécurité, Alertes, E-mails aux clients.',
    steps: [
      'Ouvrez le groupe voulu.',
      'Modifiez la valeur : le texte sous chaque réglage explique son effet.',
      'Enregistrez. Chaque modification est tracée au mouchard avec l’ancienne et la nouvelle valeur.',
    ],
    tips: [
      'Commencez par « Établissement » (nom, adresse, matricule fiscal) : ces informations figurent sur tous les documents imprimés.',
      'Les seuils (remise maximale sans autorisation, délai de retour, écart de caisse toléré…) se règlent ici.',
    ],
    warnings: [
      'La numérotation des documents ne peut que progresser : un numéro déjà émis n’est jamais réutilisé.',
    ],
    shot: 'settings',
    shotCaption: 'Paramètres',
  },
  {
    id: 'email',
    chapter: 'admin',
    title: 'E-mail & notifications',
    routes: ['/admin/email'],
    roles: [...ADMIN],
    summary:
      'Configure le serveur SMTP et les modèles d’e-mails (facture, avoir, relevé, bon de commande, alertes). Tant que l’envoi n’est pas activé et testé, aucun e-mail ne part.',
    steps: [
      'Onglet « Serveur SMTP » : renseignez le serveur (hôte), le port, la sécurité (SSL/TLS 465 ou STARTTLS 587), l’identifiant et le mot de passe fournis par votre hébergeur de messagerie.',
      'Indiquez le nom et l’adresse de l’expéditeur.',
      'Saisissez une adresse dans « Destinataire du test » et envoyez un e-mail de test : vérifiez qu’il arrive.',
      'Activez « Envoi d’e-mails activé ».',
      'Onglet « Modèles d’e-mails » : adaptez l’objet et le corps des messages ; l’aperçu montre le rendu final.',
    ],
    tips: [
      'Le corps des e-mails envoyés aux clients ne cite jamais de médicament : c’est voulu, pour la confidentialité.',
      'Une panne d’e-mail ne bloque jamais une vente : le message reste dans la file et repart tout seul.',
    ],
    warnings: ['Le mot de passe SMTP n’est jamais réaffiché une fois enregistré.'],
    shot: 'email',
    shotCaption: 'Serveur SMTP',
  },
  {
    id: 'email-log',
    chapter: 'admin',
    title: 'Journal des e-mails',
    routes: ['/admin/email-log'],
    roles: [...ADMIN],
    summary:
      'La file d’envoi et son historique. Un e-mail en échec est repris automatiquement après 1 min, 5 min, 15 min, 1 h et 6 h, puis passe en échec définitif.',
    steps: [
      'Filtrez par statut (« Tous statuts ») ou par type (« Tous types »).',
      'Survolez ou ouvrez une ligne en échec pour lire la dernière erreur.',
      'Touchez « Renvoyer » sur un e-mail en échec après avoir corrigé la cause (adresse fausse, SMTP hors service).',
    ],
    shot: 'email-log',
  },
  {
    id: 'jobs',
    chapter: 'admin',
    title: 'Tâches planifiées',
    routes: ['/admin/jobs'],
    roles: [...ADMIN],
    summary:
      'Les contrôles et alertes automatiques (péremptions, ruptures, relances de créances, résumés, sauvegarde nocturne). Chacune tourne une fois par période.',
    steps: [
      'Consultez la dernière exécution de chaque tâche et son résultat.',
      'Touchez « Lancer » pour exécuter une tâche à la demande si nécessaire (par exemple après un changement de réglage).',
    ],
    shot: 'jobs',
  },
  {
    id: 'backups',
    chapter: 'admin',
    title: 'Sauvegardes',
    routes: ['/admin/backups'],
    roles: [...ADMIN],
    summary:
      'Une sauvegarde complète de la base est faite chaque nuit et vérifiée. Ici vous voyez la liste, pouvez en lancer une et la télécharger.',
    steps: [
      'Vérifiez que la dernière sauvegarde porte l’état « Réussie » et date de moins de 24 heures.',
      'Touchez « Sauvegarder maintenant » avant une opération importante (mise à jour, inventaire annuel).',
      'Téléchargez régulièrement une sauvegarde et rangez-la hors de l’établissement (clé USB, autre ordinateur).',
    ],
    warnings: [
      'Une sauvegarde qui reste sur le seul serveur ne protège pas d’une panne du serveur : gardez toujours une copie ailleurs.',
    ],
    shot: 'backups',
  },
  // --------------------------------------------------------------------------- Compte
  {
    id: 'account',
    chapter: 'account',
    title: 'Mon compte',
    routes: ['/account'],
    roles: [...BOTH],
    summary:
      'Vos identifiants personnels : identité, mot de passe, PIN personnel et, pour les administrateurs, la double authentification.',
    steps: [
      'Ouvrez le menu de votre profil en haut à droite puis « Mon compte ».',
      'Carte « Mot de passe » : changez-le. Vos autres sessions ouvertes sont fermées.',
      'Carte « PIN personnel » : changez-le régulièrement. Il sert à déverrouiller l’écran et à valider vos actions.',
    ],
    roleNotes: {
      ADMIN: [
        'Carte « Double authentification » : activez-la avec une application d’authentification (code à 6 chiffres). C’est fortement conseillé, surtout si le site est accessible depuis Internet.',
      ],
    },
    warnings: [
      'Ne communiquez jamais votre mot de passe ni votre PIN, même à un collègue ou à un administrateur.',
    ],
    shot: 'account',
    shotCaption: 'Mon compte',
  },
  {
    id: 'my-notifications',
    chapter: 'account',
    title: 'Mes notifications',
    routes: ['/account/notifications'],
    roles: [...ADMIN],
    summary:
      'Choisissez de quoi vous êtes prévenu et comment : dans le logiciel (cloche), par e-mail immédiat ou dans un résumé quotidien ou hebdomadaire.',
    steps: [
      'Pour chaque événement, choisissez le mode : Désactivé, Dans le logiciel uniquement, E-mail immédiat, Résumé quotidien ou Résumé hebdomadaire.',
      'Enregistrez. Les alertes graves (rupture, lot périmé vendu, écart de caisse important) ont un mode conseillé par défaut.',
    ],
    tips: ['Trop d’e-mails ? Passez les événements peu urgents en « Résumé ».'],
    shot: 'my-notifications',
  },
  {
    id: 'notifications',
    chapter: 'account',
    title: 'La cloche de notifications',
    routes: ['/notifications'],
    roles: [...BOTH],
    summary:
      'Toutes vos alertes reçues : ruptures de stock, péremptions proches, chèques à échéance, relances, etc. Le chiffre sur la cloche indique celles que vous n’avez pas lues.',
    steps: [
      'Touchez la cloche en haut de l’écran pour voir les dernières alertes.',
      'Touchez une alerte pour ouvrir l’écran concerné : elle est alors marquée comme lue.',
      '« Tout marquer comme lu » vide le compteur.',
    ],
    shot: 'notifications',
  },
  // --------------------------------------------------------------------------- Installation
  {
    id: 'install-app',
    chapter: 'install',
    title: 'Installer l’application sur un téléphone ou un ordinateur',
    routes: [],
    roles: [...BOTH],
    summary:
      'PharmaStock s’installe comme une application, sans passer par un magasin d’applications : une icône sur l’écran d’accueil, un affichage plein écran, et un démarrage plus rapide.',
    steps: [
      'Ouvrez le site dans Chrome (Android, Windows, Mac) ou dans Safari (iPhone, iPad).',
      'Android et ordinateur : touchez le bouton « Installer » en haut à droite, puis « Installer » dans la fenêtre qui s’ouvre.',
      'iPhone ou iPad : touchez le bouton de partage de Safari, puis « Sur l’écran d’accueil », puis « Ajouter ».',
      'Ouvrez l’application depuis son icône. Connectez-vous comme d’habitude.',
    ],
    tips: [
      'Le bouton « Installer » disparaît une fois l’application installée.',
      'Si le bouton n’apparaît pas, vérifiez que l’adresse commence par https:// et que vous n’êtes pas en navigation privée.',
    ],
    shot: 'install',
  },
  {
    id: 'desktop-app',
    chapter: 'install',
    title: 'Application Windows',
    routes: [],
    roles: [...ADMIN],
    summary:
      'Une application Windows (installateur .exe) ouvre le site dans sa propre fenêtre et ajoute ce que le navigateur ne peut pas faire : impression silencieuse des tickets, ouverture du tiroir-caisse, jeton du poste chiffré par Windows, mises à jour proposées à la fermeture.',
    steps: [
      'Décompressez le fichier PharmaStock-X.Y.Z-win-x64.zip fourni par votre installateur dans un dossier durable (par exemple C:\\PharmaStock), puis lancez PharmaStock.exe et créez un raccourci sur le bureau (clic droit → Envoyer vers → Bureau). Une version avec installateur (PharmaStock-Setup-X.Y.Z.exe) existe aussi.',
      'Au premier lancement, la fenêtre « Réglages du poste » s’ouvre : saisissez l’adresse du serveur (la même que dans le navigateur) et choisissez l’imprimante des tickets 80 mm et celle des factures A4.',
      'Touchez « Ticket de test » puis « Ouvrir le tiroir » pour vérifier l’imprimante et le tiroir-caisse, puis « Enregistrer ».',
      'Nommez le poste (le nom de l’ordinateur est proposé) et connectez-vous. Un administrateur l’approuve dans Administration → Postes de travail.',
    ],
    tips: [
      'Les réglages se rouvrent avec le menu du profil → « Réglages du poste » ou Ctrl+, (menu Poste).',
      'F11 bascule en plein écran ; l’option « Démarrer en plein écran » et le lancement avec Windows se cochent dans les réglages.',
      'Mise à jour : décompressez le nouveau fichier .zip par-dessus l’ancien dossier (application fermée) ; vos réglages sont conservés. La version avec installateur propose les mises à jour à la fermeture, jamais au milieu d’une vente.',
      'L’application Windows et le navigateur se partagent le même serveur, les mêmes comptes et les mêmes données : vous pouvez les utiliser en même temps sur des postes différents.',
    ],
    warnings: [
      'Le tiroir-caisse doit être branché sur l’imprimante de tickets (prise RJ11/RJ12) : c’est elle qui reçoit l’impulsion d’ouverture.',
    ],
    shot: 'desktop-settings',
    shotCaption: 'Réglages du poste (application Windows)',
  },
];
