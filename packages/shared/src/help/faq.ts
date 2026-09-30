import type { FaqEntry } from './types.js';

const BOTH = ['ADMIN', 'PREPARER'] as const;
const ADMIN = ['ADMIN'] as const;

/**
 * « Que faire si… » — les situations qui reviennent au comptoir.
 * Les libellés entre guillemets français sont ceux de l’interface.
 */
export const FAQ: FaqEntry[] = [
  // --------------------------------------------------------------------------- Caisse
  {
    id: 'stock-insufficient',
    question: 'Le logiciel dit « Stock vendable insuffisant » alors que la boîte est bien là',
    roles: [...BOTH],
    answer: [
      'Le logiciel ne compte comme vendable que les lots actifs et non périmés. La boîte peut être physiquement présente mais absente du stock vendable. Vérifiez dans l’ordre :',
      '1. Ouvrez Stock → Lots et cherchez le produit : le lot est-il périmé, bloqué ou en quarantaine ? Un tel lot n’est jamais vendu.',
      '2. La marchandise a-t-elle été réceptionnée ? Une réception encore en brouillon n’ajoute rien au stock : elle doit être validée.',
      '3. La boîte a-t-elle été rangée sous un autre produit (autre dosage, autre conditionnement) ? Cherchez par code-barres.',
      '4. Vendez-vous à l’unité alors que le stock est en boîtes entières ? Vérifiez l’unité de vente de la ligne.',
      '5. Le stock affiché est-il faux ? Signalez-le : un administrateur fera un ajustement ou un inventaire (jamais de modification silencieuse : tout est tracé).',
      'Une vente en attente ne réserve pas le stock : la même boîte peut avoir été vendue entre-temps à un autre client.',
    ],
    link: '/stock/lots',
  },
  {
    id: 'lot-expired',
    question: 'Un lot est refusé parce qu’il est périmé ou bloqué',
    roles: [...BOTH],
    answer: [
      'C’est une protection : un lot périmé, bloqué ou en quarantaine ne peut jamais être vendu, même avec une autorisation.',
      'Sélectionnez un autre lot du même produit (le logiciel propose le plus proche de la péremption en premier, règle FEFO). Sortez physiquement le lot périmé du rayon et signalez-le à un administrateur, qui le détruira par un ajustement ou le renverra au fournisseur.',
    ],
    link: '/stock/expiries',
  },
  {
    id: 'product-not-found',
    question: 'Je ne trouve pas le produit en caisse ou le code-barres ne se lit pas',
    roles: [...BOTH],
    answer: [
      '1. Tapez seulement le début du nom ou de la molécule : la recherche tolère les fautes de frappe.',
      '2. Saisissez le code-barres à la main dans le même champ (touche F2).',
      '3. Sur téléphone, utilisez le bouton de scan (appareil photo) : il fonctionne sous Chrome sur Android.',
      '4. Si le produit n’existe pas du tout, demandez à un administrateur de le créer dans Catalogue → Produits. Un produit archivé n’est pas vendable.',
    ],
    link: '/pos',
  },
  {
    id: 'discount-refused',
    question: 'La remise est refusée (« Remise supérieure au plafond autorisé »)',
    roles: [...BOTH],
    answer: [
      'Vous pouvez accorder une remise jusqu’au plafond réglé dans Paramètres → Ventes. Au-delà, un administrateur doit l’autoriser.',
      'Une fenêtre demande alors le code et le PIN d’un administrateur, ainsi qu’un motif. Faites saisir l’administrateur lui-même : ne connaissez jamais son PIN.',
    ],
    link: '/pos',
  },
  {
    id: 'override-window',
    question: 'Une fenêtre me demande le code et le PIN d’un administrateur',
    roles: [...BOTH],
    answer: [
      'Certaines actions sensibles sont marquées d’une clé 🔑 : remise au-delà du plafond, changement de prix, vente à crédit hors plafond, annulation ou modification d’une vente, retour hors délai, etc.',
      'L’administrateur saisit son code utilisateur, son PIN et un motif. L’opération est ensuite tracée au mouchard avec son nom. Si l’administrateur n’est pas là, l’action est impossible : c’est voulu.',
    ],
  },
  {
    id: 'prescription-required',
    question: 'Le logiciel demande une ordonnance pour un produit',
    roles: [...BOTH],
    answer: [
      'Ce produit est délivré sur ordonnance ou figure au tableau. Renseignez le médecin prescripteur et le numéro d’ordonnance dans l’encadré « Ordonnance obligatoire » qui apparaît sous le panier : la vente alimente le registre légal.',
      'Vous ne pouvez pas valider la vente sans ces informations.',
    ],
    link: '/pos',
  },
  {
    id: 'client-required',
    question: 'Le logiciel exige un client (« L’acheteur est obligatoire »)',
    roles: [...BOTH],
    answer: [
      'Touchez F3 ou « Client » et choisissez un client existant, ou créez-le en quelques secondes.',
      'Si l’établissement l’autorise, « Client comptoir » permet une vente sans identifier l’acheteur (pas de crédit ni de facture nominative dans ce cas).',
    ],
    link: '/pos',
  },
  {
    id: 'payment-mismatch',
    question: '« Le total des paiements ne correspond pas au montant à régler »',
    roles: [...BOTH],
    answer: [
      'La somme des modes de paiement saisis doit être égale au total de la vente. Vérifiez chaque montant.',
      'Pour un paiement en espèces avec rendu de monnaie, saisissez la somme remise par le client : le logiciel calcule la monnaie à rendre. Un solde peut aussi être mis à crédit si le client y est autorisé.',
    ],
    link: '/pos',
  },
  {
    id: 'cash-session-required',
    question: '« Ouvrez une session de caisse sur ce poste avant d’encaisser des espèces »',
    roles: [...BOTH],
    answer: [
      'Une session de caisse doit être ouverte pour encaisser des espèces. Allez dans Sessions de caisse, touchez « Ouvrir la caisse » et saisissez le fond de caisse.',
      'Si une session est déjà ouverte sur ce poste par un collègue, elle doit d’abord être clôturée.',
    ],
    link: '/cash',
  },
  {
    id: 'credit-limit',
    question: 'La vente à crédit est refusée (plafond dépassé ou crédit non autorisé)',
    roles: [...BOTH],
    answer: [
      'Le plafond de crédit se règle sur la fiche du client. S’il est atteint, faites encaisser une partie du solde ou demandez à un administrateur d’augmenter le plafond ou d’autoriser le crédit.',
      'Vous pouvez aussi enregistrer d’abord un règlement du client (Règlements → Nouvel encaissement) puis refaire la vente.',
    ],
    link: '/clients',
  },
  {
    id: 'sale-on-hold-lost',
    question: 'Ma vente en attente a disparu',
    roles: [...BOTH],
    answer: [
      'Elle est dans Ventes → Ventes en attente. Elle peut être reprise depuis n’importe quel poste.',
      'Si elle n’y est pas, elle a été reprise ou abandonnée par quelqu’un d’autre : l’historique du panier est conservé au mouchard.',
    ],
    link: '/sales/on-hold',
  },
  {
    id: 'double-click',
    question: 'La connexion a coupé pendant la validation : ai-je vendu deux fois ?',
    roles: [...BOTH],
    answer: [
      'Non. Chaque validation porte une clé unique : si vous réessayez, le serveur reconnaît l’opération et ne la double pas.',
      'Avant de recommencer, ouvrez Ventes → Historique pour voir si la vente y figure. Si oui, imprimez-la depuis son détail ; sinon, revalidez le panier.',
    ],
    link: '/sales',
  },
  {
    id: 'find-a-sale',
    question: 'Comment retrouver une vente ?',
    roles: [...BOTH],
    answer: [
      'Ouvrez Ventes → Historique et retrouvez la vente avec la recherche et les filtres (date, client, statut). Ouvrez-la pour voir les lignes, les paiements et pour la réimprimer.',
    ],
    link: '/sales',
  },
  // --------------------------------------------------------------------------- Retours et erreurs
  {
    id: 'sale-mistake',
    question: 'Je me suis trompé sur une vente déjà validée',
    roles: [...BOTH],
    answer: [
      'Une vente validée ne se supprime jamais. Selon le cas :',
      '1. Erreur immédiate (mauvais produit, mauvaise quantité) : demandez à un administrateur d’annuler ou de modifier la vente (action 🔑, motif obligatoire).',
      '2. Le client rapporte un produit plus tard : faites un retour (Retours & avoirs → Nouveau retour).',
      'Si un retour a déjà été fait sur cette vente, elle n’est plus annulable : faites un retour complémentaire.',
    ],
    link: '/returns',
  },
  {
    id: 'return-delay',
    question:
      'Le client veut rendre un produit mais le délai est dépassé, ou le produit n’est pas retournable',
    roles: [...BOTH],
    answer: [
      'Le délai de retour se règle dans Paramètres → Retours. Passé ce délai, ou pour un produit marqué non retournable (chaîne du froid, stupéfiant…), seul un administrateur peut accepter le retour, avec un motif.',
      'Dans l’assistant de retour, vous indiquez l’état du produit rendu : seul un produit revendable retourne au stock vendable ; un lot périmé ou en quarantaine reste en quarantaine.',
    ],
    link: '/returns',
  },
  {
    id: 'cash-refund',
    question: 'Puis-je rembourser un client en espèces ?',
    roles: [...BOTH],
    answer: [
      'Par défaut, un retour donne un avoir (crédit sur le compte du client) ou un remboursement sur le mode de paiement d’origine. Le remboursement en espèces est réservé à un administrateur et à l’autorisation prévue dans les Paramètres.',
    ],
    link: '/returns',
  },
  // --------------------------------------------------------------------------- Caisse (clôture)
  {
    id: 'cash-discrepancy',
    question: 'Il y a un écart à la clôture de la caisse',
    roles: [...BOTH],
    answer: [
      'Vous comptez les espèces par coupures sans voir le montant attendu : c’est voulu, pour que le comptage reste honnête.',
      '1. Recomptez calmement, coupure par coupure.',
      '2. Vérifiez qu’aucun mouvement d’espèces (retrait, dépense) n’a été oublié.',
      '3. Si l’écart demeure, validez et indiquez un commentaire : l’administrateur voit le montant attendu et l’écart, et décide de la suite. Ne « corrigez » jamais en trafiquant un comptage.',
    ],
    link: '/cash',
  },
  // --------------------------------------------------------------------------- Compte
  {
    id: 'forgot-pin',
    question: 'J’ai oublié mon code (PIN)',
    roles: [...BOTH],
    answer: [
      'Le PIN ne peut pas être retrouvé, personne ne le connaît : il est stocké de manière irréversible. Un administrateur en définit un nouveau : Administration → Utilisateurs → menu de votre ligne → « Réinitialiser mot de passe / PIN ».',
      'Il vous remet le nouveau PIN ; changez-le ensuite vous-même dans Mon compte → PIN personnel, pour qu’il reste secret.',
    ],
    link: '/account',
  },
  {
    id: 'forgot-password',
    question: 'J’ai oublié mon mot de passe',
    roles: [...BOTH],
    answer: [
      'Demandez à un administrateur de le réinitialiser (Administration → Utilisateurs → « Réinitialiser mot de passe / PIN »). Vous recevrez un mot de passe provisoire et le logiciel vous demandera d’en choisir un nouveau à la première connexion.',
      'Si c’est l’unique administrateur qui a oublié son mot de passe : la commande de secours « reset-credentials » se lance sur le serveur (guide d’exploitation, « Commandes d’exploitation »).',
    ],
  },
  {
    id: 'account-locked',
    question: 'Mon compte est verrouillé (« Compte temporairement verrouillé »)',
    roles: [...BOTH],
    answer: [
      'Après plusieurs mots de passe ou PIN incorrects, le compte se verrouille pour quelques minutes (durée réglée dans Paramètres → Sécurité).',
      'Attendez la fin du délai, ou demandez à un administrateur de le déverrouiller : Administration → Utilisateurs → « Déverrouiller le compte ».',
    ],
  },
  {
    id: 'screen-locked',
    question: 'L’écran s’est verrouillé tout seul',
    roles: [...BOTH],
    answer: [
      'Le logiciel se verrouille après quelques minutes sans activité (réglable dans Paramètres → Sécurité). Saisissez votre PIN pour reprendre là où vous étiez : votre panier est conservé.',
      'Vous pouvez aussi verrouiller vous-même en quittant le poste : menu du profil en haut à droite → « Verrouiller l’écran ».',
    ],
  },
  {
    id: 'session-expired',
    question: '« Votre session a expiré. Reconnectez-vous. »',
    roles: [...BOTH],
    answer: [
      'Reconnectez-vous avec votre identifiant et votre mot de passe. Si vous étiez en train de saisir une vente, elle est conservée en brouillon : reprenez-la depuis la caisse.',
      'Si cela se produit souvent, vérifiez que l’heure du poste est correcte et signalez-le à un administrateur.',
    ],
  },
  {
    id: 'device-pending',
    question: '« Ce poste est en attente d’approbation »',
    roles: [...BOTH],
    answer: [
      'Un nouvel ordinateur, téléphone ou navigateur doit être approuvé une fois. Prévenez un administrateur : Administration → Postes de travail → menu de la ligne → « Approuver ».',
      'Si le message dit que le poste a été révoqué, il ne servira plus tant qu’un administrateur ne l’a pas approuvé de nouveau.',
    ],
  },
  {
    id: 'version-conflict',
    question: '« Cet élément a été modifié par un autre utilisateur entre-temps »',
    roles: [...BOTH],
    answer: [
      'Quelqu’un d’autre a enregistré une modification sur le même élément (produit, client…) avant vous. Rechargez la page pour voir la dernière version, puis refaites votre modification.',
    ],
  },
  // --------------------------------------------------------------------------- E-mail
  {
    id: 'email-not-received',
    question: 'Le client n’a pas reçu sa facture par e-mail',
    roles: [...BOTH],
    answer: [
      '1. Vérifiez l’adresse sur la fiche du client : une faute de frappe est la cause la plus fréquente. Corrigez-la.',
      '2. Demandez au client de regarder ses courriers indésirables (spam).',
      '3. Ouvrez la vente puis touchez « Renvoyer par e-mail » (ou « Envoyer par e-mail » s’il n’est jamais parti). Si le client n’a pas donné son consentement, le logiciel demande de confirmer l’envoi. Le bouton est absent pour un « client comptoir », ou tant que l’envoi d’e-mails n’est pas actif.',
      '4. Si rien ne part du tout, prévenez un administrateur : l’envoi d’e-mails est peut-être désactivé, ou le serveur SMTP en panne. Il consulte Administration → Journal des e-mails : l’erreur exacte y est écrite, et il peut « Renvoyer » le message.',
      'En attendant, imprimez la facture : une panne d’e-mail ne bloque jamais la vente.',
    ],
    link: '/sales',
  },
  {
    id: 'smtp-test-fails',
    question: 'Le test du serveur SMTP échoue',
    roles: [...ADMIN],
    answer: [
      'Vérifiez dans l’ordre :',
      '1. L’hôte et le port : 465 avec « SSL/TLS », 587 avec « STARTTLS ».',
      '2. L’identifiant (souvent l’adresse e-mail complète) et le mot de passe. Certains hébergeurs exigent un « mot de passe d’application ».',
      '3. L’adresse de l’expéditeur : elle doit appartenir au domaine autorisé par le serveur.',
      '4. Le pare-feu du VPS : les ports SMTP sortants sont parfois bloqués par l’hébergeur.',
      'Le message d’erreur renvoyé par le serveur s’affiche sous le bouton de test et dans le Journal des e-mails.',
    ],
    link: '/admin/email',
  },
  // --------------------------------------------------------------------------- Stock et achats
  {
    id: 'stock-not-matching',
    question: 'Le stock affiché ne correspond pas à ce qu’il y a sur l’étagère',
    roles: [...BOTH],
    answer: [
      'Ne modifiez jamais le stock « pour arranger » : chaque écart doit avoir une trace.',
      '1. Ouvrez la fiche de mouvement du produit (Stock → Fiche de mouvement) : elle montre chaque entrée et sortie, avec l’auteur et l’heure.',
      '2. Si vous avez compté, créez un ajustement (Inventaire & ajustements → Ajustements) avec un motif ; un administrateur le valide.',
      '3. Pour plusieurs produits, l’administrateur ouvre un inventaire (comptage par lot).',
    ],
    link: '/stock/movements',
  },
  {
    id: 'receipt-mistake',
    question: 'J’ai validé une réception avec une erreur',
    roles: [...BOTH],
    answer: [
      'Une réception validée ne se modifie pas. Un administrateur peut l’annuler (contre-mouvements et traçabilité) tant que les unités reçues n’ont pas été sorties du stock ; sinon utilisez un retour fournisseur ou un ajustement.',
      'Pour une erreur de quantité ou de prix, l’administrateur annule puis vous refaites la réception correctement.',
    ],
    link: '/receipts',
  },
  {
    id: 'expiry-in-past',
    question: 'À la réception : « La date de péremption est déjà passée »',
    roles: [...BOTH],
    answer: [
      'Contrôlez la date lue sur la boîte : le format est mois/année. Si le lot est réellement périmé à l’arrivée, ne le réceptionnez pas : refusez-le auprès du fournisseur.',
    ],
    link: '/receipts/new',
  },
  {
    id: 'duplicate-barcode',
    question: '« Ce code-barres est déjà attribué à un autre produit »',
    roles: [...ADMIN],
    answer: [
      'Un code-barres identifie un seul produit. Cherchez le produit qui l’utilise déjà : c’est soit un doublon à archiver, soit une erreur de saisie sur l’un des deux. Corrigez la fiche fautive.',
    ],
    link: '/products',
  },
  {
    id: 'wrong-price',
    question: 'Le prix d’un produit est faux',
    roles: [...BOTH],
    answer: [
      'Seul un administrateur modifie les prix : Catalogue → Produits → fiche du produit. Le changement est tracé et n’affecte pas les ventes déjà faites.',
      'Ne changez pas le prix au comptoir pour « arranger » un client : utilisez la remise dans son plafond.',
    ],
    link: '/products',
  },
  // --------------------------------------------------------------------------- Installation, impression
  {
    id: 'install-button-missing',
    question: 'Le bouton « Installer » n’apparaît pas sur mon téléphone',
    roles: [...BOTH],
    answer: [
      '1. Utilisez Chrome sur Android, ou Safari sur iPhone : les autres navigateurs ne le proposent pas.',
      '2. L’adresse doit commencer par https://. Sans connexion sécurisée, l’installation est refusée.',
      '3. Sortez de la navigation privée.',
      '4. Sur iPhone, il n’y a pas de bouton automatique : touchez Partager, puis « Sur l’écran d’accueil ». Le bouton « Installer » en haut à droite affiche ces étapes.',
      '5. Si l’application est déjà installée, le bouton disparaît : cherchez l’icône sur l’écran d’accueil.',
    ],
  },
  {
    id: 'print-problem',
    question: 'Le ticket ou la facture ne s’imprime pas',
    roles: [...BOTH],
    answer: [
      '1. Dans le navigateur, la fenêtre d’impression s’ouvre : choisissez la bonne imprimante et le bon format (ticket ou A4). Si elle ne s’ouvre pas, autorisez les fenêtres pop-up pour le site.',
      '2. Vérifiez que l’imprimante est allumée, avec du papier, et choisie comme imprimante par défaut du poste.',
      '3. Dans l’application Windows, l’impression est silencieuse : l’imprimante de tickets se choisit dans les réglages de l’application.',
      '4. Ouvrez la vente concernée et utilisez « Ticket » ou « Facture A4 » : chaque réimpression est tracée au mouchard.',
    ],
    link: '/sales',
  },
  // --------------------------------------------------------------------------- Administration
  {
    id: 'leaver',
    question: 'Un employé quitte l’établissement',
    roles: [...ADMIN],
    answer: [
      '1. Administration → Utilisateurs → menu de sa ligne → « Désactiver ». Ses sessions sont fermées aussitôt.',
      '2. Si l’employé avait un téléphone personnel enregistré, révoquez ce poste dans Administration → Postes de travail.',
      'Ne supprimez rien : son historique de ventes et d’opérations reste consultable et son code n’est pas réattribué.',
    ],
    link: '/admin/users',
  },
  {
    id: 'last-admin',
    question: '« Il doit rester au moins un administrateur actif »',
    roles: [...ADMIN],
    answer: [
      'Le logiciel refuse de désactiver ou de rétrograder le dernier administrateur, pour éviter de vous enfermer dehors. Créez d’abord un second administrateur, puis modifiez le premier.',
    ],
    link: '/admin/users',
  },
  {
    id: 'backup-failed',
    question: 'La sauvegarde de cette nuit est en échec',
    roles: [...ADMIN],
    answer: [
      '1. Ouvrez Administration → Sauvegardes et lisez le message de la dernière ligne.',
      '2. Vérifiez l’espace disque du serveur : c’est la cause la plus fréquente.',
      '3. Touchez « Sauvegarder maintenant » pour relancer. Une sauvegarde n’est valide qu’après vérification automatique (état « Réussie »).',
      '4. Téléchargez ensuite une copie et rangez-la hors du serveur.',
    ],
    link: '/admin/backups',
  },
  {
    id: 'site-unreachable',
    question: 'Personne ne peut ouvrir le site',
    roles: [...ADMIN],
    answer: [
      '1. Vérifiez la connexion Internet du poste, puis essayez depuis un autre appareil (téléphone en 4G).',
      '2. Si le site répond ailleurs, le problème vient de la connexion de l’établissement.',
      '3. S’il ne répond nulle part, le serveur est peut-être arrêté : contactez la personne qui l’héberge. Le guide d’exploitation (« Dépannage ») donne les commandes à lui demander : état des conteneurs, journaux, redémarrage.',
      'Les données ne sont pas perdues : elles sont dans la base de données du serveur, sauvegardée chaque nuit.',
    ],
  },
  {
    id: 'new-device',
    question: 'Je veux ajouter un nouvel ordinateur ou téléphone',
    roles: [...ADMIN],
    answer: [
      '1. Sur l’appareil, ouvrez le site, connectez-vous et donnez un nom au poste.',
      '2. Sur un poste déjà approuvé, ouvrez Administration → Postes de travail : le nouveau poste est « En attente ».',
      '3. Menu de sa ligne → « Approuver ».',
      '4. Sur téléphone, installez ensuite l’application avec le bouton « Installer ».',
    ],
    link: '/admin/devices',
  },
];
