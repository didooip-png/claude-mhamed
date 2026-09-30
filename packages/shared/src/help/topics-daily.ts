import type { HelpTopic } from './types.js';

const BOTH = ['ADMIN', 'PREPARER'] as const;
const ADMIN = ['ADMIN'] as const;

/** Premiers pas, caisse, ventes, retours, clients et règlements. */
export const TOPICS_DAILY: HelpTopic[] = [
  // --------------------------------------------------------------------------- Premiers pas
  {
    id: 'first-login',
    chapter: 'start',
    title: 'Se connecter',
    routes: [],
    roles: [...BOTH],
    summary:
      'Chaque personne a son propre code utilisateur, son mot de passe et son PIN. Tout ce que vous faites est enregistré à votre nom : ne prêtez jamais vos identifiants.',
    steps: [
      'Ouvrez PharmaStock (adresse fournie par l’administrateur, ou icône de l’application installée).',
      'La toute première fois sur un ordinateur ou un téléphone, saisissez un nom pour ce poste (par exemple « Comptoir 1 ») puis touchez « Enregistrer le poste ». Un administrateur doit ensuite l’approuver avant que vous puissiez vous connecter.',
      'Saisissez votre identifiant et votre mot de passe, puis touchez « Se connecter ».',
      'À la première connexion, choisissez un nouveau mot de passe personnel (8 caractères au moins, avec une lettre et un chiffre).',
      'Vous arrivez sur le tableau de bord : le menu de gauche (ou le bouton « Menu » sur téléphone) donne accès à tous vos écrans.',
    ],
    tips: [
      'Après 5 mots de passe erronés le compte se verrouille quelques minutes ; un administrateur peut le déverrouiller tout de suite.',
      'Le bouton « Installer » en haut à droite ajoute PharmaStock à l’écran d’accueil de votre téléphone ou de votre ordinateur.',
    ],
    warnings: [
      'Ne notez jamais votre mot de passe ou votre PIN à côté du poste. Le PIN autorise des actions en votre nom.',
    ],
    shot: 'login',
    shotCaption: 'Écran de connexion',
  },
  {
    id: 'help-page',
    chapter: 'start',
    title: 'Aide, FAQ et visite guidée',
    routes: ['/help'],
    roles: [...BOTH],
    summary:
      'Le bouton « ? » en haut de chaque écran explique la page où vous êtes. La page Aide rassemble tout : questions fréquentes, guide par écran, raccourcis, fiche mémo à imprimer et manuels PDF.',
    steps: [
      'Touchez « ? » en haut de l’écran (ou la touche F1) pour lire l’aide de l’écran affiché.',
      'Dans « Que faire si… », tapez quelques mots du problème (stock, e-mail, PIN…) : les réponses se filtrent.',
      'Dans « Guide par écran », ouvrez une procédure pour la lire pas à pas.',
      'Dans « Fiche mémo », touchez « Imprimer la fiche » pour obtenir l’aide-mémoire d’une page.',
      '« Visite guidée » rejoue la présentation des repères de l’écran.',
    ],
    tips: ['Les petites bulles « ? » à côté de certains champs expliquent ce qu’il faut saisir.'],
    shot: 'help',
    shotCaption: 'La page Aide',
  },
  {
    id: 'pin-lock',
    chapter: 'start',
    title: 'PIN, verrouillage de l’écran et changement d’utilisateur',
    routes: [],
    roles: [...BOTH],
    summary:
      'Sur un poste partagé, le PIN (4 à 6 chiffres) permet de verrouiller l’écran en s’absentant et de passer d’un utilisateur à un autre sans se reconnecter avec le mot de passe.',
    steps: [
      'Pour verrouiller : ouvrez le menu de votre profil (en haut à droite) puis « Verrouiller l’écran ». L’écran se verrouille aussi tout seul après une période d’inactivité.',
      'Pour déverrouiller : saisissez votre PIN. Si un collègue prend le poste, touchez « Autre utilisateur » et saisissez son code et son PIN.',
      'Pour changer d’utilisateur sans se déconnecter : menu du profil → « Changer d’utilisateur (PIN) », puis code utilisateur et PIN.',
    ],
    tips: [
      'Votre PIN se change dans « Mon compte ».',
      'Un PIN erroné plusieurs fois de suite bloque le PIN ; reconnectez-vous alors avec votre mot de passe.',
    ],
    shot: 'lock-screen',
    shotCaption: 'Écran verrouillé : PIN ou « Autre utilisateur »',
  },
  {
    id: 'dashboard',
    chapter: 'start',
    title: 'Tableau de bord',
    routes: ['/'],
    roles: [...BOTH],
    summary:
      'Le résumé de la journée : chiffre d’affaires, ventes, alertes de stock et de péremption, état de la caisse.',
    steps: [
      'Consultez les trois cartes « Aujourd’hui », « Cette semaine » et « Ce mois » : chiffre d’affaires, nombre de ventes, panier moyen, avec la comparaison à la période précédente.',
      'Parcourez les alertes : ruptures, produits sous leur seuil minimum, lots périmés à retirer, péremptions à moins de 30, 60 ou 90 jours.',
      'Touchez une alerte pour ouvrir directement la liste concernée (lots, réapprovisionnement, péremptions…).',
      'Le graphique « Ventes des 30 derniers jours » et le « Top 10 des produits » aident à repérer les tendances.',
    ],
    roleNotes: {
      ADMIN: [
        'Vous voyez aussi la marge, la valeur du stock, les créances, les factures échues et les écarts de caisse.',
      ],
      PREPARER: [
        'Votre tableau de bord est personnel : vos ventes du jour, les ventes en attente et les alertes de stock utiles au comptoir. Marges et coûts ne s’affichent pas.',
      ],
    },
    shot: 'dashboard',
    shotCaption: 'Tableau de bord',
  },
  {
    id: 'navigation',
    chapter: 'start',
    title: 'Se repérer dans le logiciel',
    routes: [],
    roles: [...BOTH],
    summary:
      'Le menu, la recherche rapide, les notifications et l’aide sont accessibles depuis n’importe quel écran.',
    steps: [
      'Le menu principal (à gauche sur ordinateur, bouton « Menu » en bas sur téléphone) regroupe les écrans par métier. Vous ne voyez que ce que votre rôle vous permet de faire.',
      'La loupe (ou Ctrl + K) lance la recherche rapide : un écran, un produit, un client, un numéro de document.',
      'La cloche affiche vos notifications (alertes de stock, échéances, activité selon vos réglages).',
      'Le point vert indique que la connexion au serveur est bonne. Rouge : la connexion est perdue, aucune opération ne peut être enregistrée tant qu’elle n’est pas rétablie.',
      'Le bouton « ? » ouvre l’aide de l’écran affiché : à quoi il sert et comment s’en servir, pas à pas.',
    ],
    tips: ['Le mode sombre se choisit dans le menu de votre profil.'],
    shot: 'navigation',
    shotCaption: 'Barre supérieure : recherche, installation, notifications, aide et profil',
  },

  // --------------------------------------------------------------------------- Vendre
  {
    id: 'pos',
    chapter: 'sell',
    title: 'Faire une vente (écran Caisse)',
    routes: ['/pos'],
    roles: [...BOTH],
    summary:
      'L’écran de caisse sert à enregistrer une vente : client, produits scannés ou recherchés, remises éventuelles, paiement, ticket. Tout se fait au clavier ou au scanner.',
    steps: [
      'Ouvrez la caisse de votre poste si ce n’est pas déjà fait (écran « Sessions de caisse » → « Ouvrir la caisse »). Les paiements en espèces l’exigent.',
      'Choisissez le client : tapez son nom, son code ou son téléphone (F3 pour changer de client). Le client est obligatoire ; « Client comptoir » sert aux ventes anonymes payées intégralement.',
      'Ajoutez les produits : scannez le code-barres, ou tapez quelques lettres du nom, de la molécule ou du dosage (F2), puis Entrée. Sur téléphone, l’icône caméra lit le code-barres.',
      'Ajustez la quantité de chaque ligne (F6, ou les boutons − et +). Le logiciel choisit tout seul le lot qui périme en premier (règle FEFO) et l’affiche sous le produit.',
      'Touchez « Paiement » (F9), enregistrez le ou les règlements puis « Valider la vente » (F10).',
      'Récupérez le ticket ou la facture A4 si vous avez choisi une impression. Le stock est décrémenté et la facture porte un numéro FAC-AAAA-NNNNNN.',
    ],
    tips: [
      'Un produit sans stock vendable, périmé ou dont le lot est bloqué ne peut pas être vendu : le logiciel propose des équivalents.',
      'Vous ne pouvez pas valider deux fois la même vente : un double clic est sans danger.',
      'Si le client réclame sa facture par e-mail, elle part automatiquement quand il a donné son accord et qu’une adresse est enregistrée.',
    ],
    warnings: [
      'Les produits sous ordonnance ou à tableau demandent le nom du prescripteur et le numéro d’ordonnance (voir « Ordonnance et produits à tableau »).',
    ],
    shortcuts: [
      ['F1', 'Aide et raccourcis de la caisse'],
      ['F2', 'Rechercher ou scanner un produit'],
      ['F3', 'Choisir ou changer le client'],
      ['F4', 'Remise ou prix de la ligne sélectionnée'],
      ['F6', 'Quantité de la ligne sélectionnée'],
      ['F8', 'Mettre la vente en attente'],
      ['F9', 'Paiement'],
      ['F10', 'Valider la vente (depuis le paiement)'],
      ['↑ ↓', 'Sélectionner une ligne'],
      ['Suppr', 'Retirer la ligne sélectionnée'],
      ['Échap', 'Fermer la fenêtre courante'],
    ],
    shot: 'pos-cart',
    shotCaption: 'Écran de caisse avec un panier de deux produits',
  },
  {
    id: 'pos-payment',
    chapter: 'sell',
    title: 'Encaisser : modes de paiement, crédit et avoir',
    routes: [],
    roles: [...BOTH],
    summary:
      'Le paiement peut combiner plusieurs modes, utiliser le crédit (avoir) du client ou laisser un reste à payer sur son compte.',
    steps: [
      'Touchez « Paiement » (F9). Le montant à payer s’affiche en grand.',
      'Espèces : saisissez le « Montant remis » ; le rendu de monnaie se calcule tout seul. Carte, chèque, virement ou traite : renseignez les informations demandées (numéro de chèque et banque, référence du virement, échéance de la traite).',
      'Pour payer avec plusieurs modes, touchez « + Espèces », « + Carte »… et répartissez les montants jusqu’à ce que « Réglé intégralement » s’affiche.',
      'Si le client possède un crédit (avoir), saisissez la part à utiliser dans « Montant du crédit utilisé ».',
      'Vente à crédit : retirez le règlement (icône corbeille). Le reste à payer est inscrit sur le compte du client, dans la limite de son plafond de crédit.',
      'Choisissez le document (ticket 80 mm, facture A4 ou aucun), saisissez votre PIN si le logiciel le demande, puis « Valider la vente ».',
    ],
    tips: [
      'Le « client comptoir » doit toujours payer la totalité.',
      'Une panne de messagerie ne bloque jamais une vente : l’e-mail est réessayé automatiquement.',
    ],
    warnings: [
      'Dépasser le plafond de crédit du client exige l’autorisation d’un administrateur (code, PIN et motif).',
    ],
    shot: 'pos-payment',
    shotCaption: 'Fenêtre de paiement',
  },
  {
    id: 'pos-discount',
    chapter: 'sell',
    title: 'Remises, prix modifié et code administrateur',
    routes: [],
    roles: [...BOTH],
    summary:
      'Un préparateur peut accorder une remise jusqu’à un plafond ; au-delà, ou pour changer un prix, l’autorisation d’un administrateur est demandée et tracée.',
    steps: [
      'Sélectionnez la ligne concernée puis touchez « Remise / prix » (F4).',
      'Saisissez la remise en pourcentage (ou le nouveau prix si vous y êtes autorisé), puis « Appliquer ».',
      'Si l’opération dépasse vos droits, la fenêtre « Autorisation administrateur » s’ouvre : un administrateur saisit son code, son PIN et le motif.',
      'La ligne porte alors le symbole 🔑 : l’autorisation est enregistrée au mouchard avec le nom de l’administrateur.',
    ],
    roleNotes: {
      ADMIN: [
        'C’est votre code et votre PIN que saisit le préparateur pour obtenir votre accord. Le motif que vous indiquez sera relu au mouchard : soyez précis.',
      ],
    },
    warnings: [
      'Ne donnez jamais votre code administrateur ou votre PIN à un préparateur : c’est à l’administrateur de le saisir lui-même.',
    ],
    shot: 'override',
    shotCaption: 'Autorisation administrateur',
  },
  {
    id: 'pos-prescription',
    chapter: 'sell',
    title: 'Ordonnance et produits à tableau',
    routes: [],
    roles: [...BOTH],
    summary:
      'Certains médicaments ne se délivrent que sur ordonnance. Le logiciel demande alors les informations légales et alimente le registre des produits à tableau.',
    steps: [
      'Ajoutez le produit : un encadré jaune « Ordonnance obligatoire » apparaît sous le panier.',
      'Saisissez le médecin prescripteur, le numéro d’ordonnance et la date.',
      'Terminez la vente normalement : la validation est refusée tant que les informations obligatoires manquent.',
    ],
    tips: [
      'Le registre des produits à tableau se consulte dans Statistiques et rapports → Journaux.',
    ],
    shot: 'pos-prescription',
  },
  {
    id: 'sales-on-hold',
    chapter: 'sell',
    title: 'Ventes en attente',
    routes: ['/sales/on-hold'],
    roles: [...BOTH],
    summary:
      'Mettre un panier de côté pour servir un autre client, puis le reprendre depuis n’importe quel poste.',
    steps: [
      'Sur l’écran de caisse, touchez « Attente » (F8) : le panier est conservé et un nouveau panier s’ouvre.',
      'Pour reprendre : touchez « En attente » sur l’écran de caisse, ou ouvrez Ventes → Ventes en attente.',
      'Choisissez la vente : elle devient votre panier en cours.',
    ],
    tips: ['Les ventes en attente n’ont pas de numéro de facture et ne modifient pas le stock.'],
    shot: 'sales-on-hold',
  },

  // --------------------------------------------------------------------------- Ventes, retours
  {
    id: 'sales',
    chapter: 'sales',
    title: 'Historique des ventes',
    routes: ['/sales'],
    roles: [...BOTH],
    summary: 'La liste de toutes les ventes validées et annulées, avec recherche et filtres.',
    steps: [
      'Tapez un numéro de facture, un nom de client ou un téléphone dans la zone de recherche.',
      'Affinez avec les filtres (statut, paiement, vendeur, période, produit). Sur téléphone, touchez « Filtres et tri ».',
      'Touchez une vente pour ouvrir son détail.',
    ],
    roleNotes: {
      PREPARER: ['Vous voyez toutes les ventes, mais jamais les coûts ni les marges.'],
    },
    shot: 'sales',
    shotCaption: 'Historique des ventes',
  },
  {
    id: 'sale-detail',
    chapter: 'sales',
    title: 'Détail d’une vente, réimpression et e-mail',
    routes: ['/sales/:id'],
    roles: [...BOTH],
    summary:
      'Le détail d’une facture : lignes, lots sortis, règlements, historique. C’est ici que l’on réimprime ou renvoie un document.',
    steps: [
      'Ouvrez la vente depuis l’historique.',
      'Touchez « Ticket » ou « Facture A4 » pour l’imprimer : un duplicata porte la mention « DUPLICATA ».',
      'Touchez « Envoyer par e-mail » pour transmettre la facture PDF au client (adresse modifiable avant l’envoi).',
      'Pour reprendre des produits, touchez « Retourner des produits » (voir « Retour d’un client »).',
    ],
    roleNotes: {
      ADMIN: [
        'Les boutons « Modifier » et « Annuler la vente » vous sont réservés (voir « Annuler ou modifier une vente »).',
      ],
    },
    shot: 'sale-detail',
    shotCaption: 'Détail d’une facture',
  },
  {
    id: 'sale-cancel',
    chapter: 'sales',
    title: 'Annuler ou modifier une vente',
    routes: [],
    roles: [...ADMIN],
    summary:
      'Une vente validée ne se supprime jamais : on l’annule (le stock revient dans les lots d’origine) ou on la modifie (annulation et nouvelle vente liée).',
    steps: [
      'Ouvrez la vente puis touchez « Annuler la vente » (ou « Modifier »).',
      'Choisissez le motif dans la liste et précisez-le dans la zone « Précisions » : il est obligatoire.',
      'S’il y a eu des règlements, choisissez de les convertir en crédit sur le compte du client ou de les rembourser.',
      'Confirmez. La facture reste numérotée mais apparaît « ANNULÉE » ; l’opération est inscrite au mouchard et l’état complet de la vente est conservé.',
    ],
    warnings: [
      'Une vente qui a fait l’objet d’un retour ne peut plus être annulée ni modifiée : faites un retour complémentaire.',
      'Remboursement en espèces : une session de caisse doit être ouverte sur ce poste.',
    ],
    shot: 'sale-cancel',
    shotCaption: 'Annulation d’une vente',
  },
  {
    id: 'returns',
    chapter: 'sales',
    title: 'Retours et avoirs',
    routes: ['/returns', '/returns/:id'],
    roles: [...BOTH],
    summary:
      'La liste des retours de clients, chacun avec son avoir (crédit) ou son remboursement, et le mouvement de stock associé.',
    steps: [
      'Touchez « Nouveau retour » pour enregistrer un retour.',
      'Touchez un retour pour voir son détail : produits repris, état, montant, avoir généré.',
      'Imprimez ou envoyez l’avoir par e-mail si le client le souhaite.',
    ],
    shot: 'returns',
  },
  {
    id: 'return-new',
    chapter: 'sales',
    title: 'Retour d’un client',
    routes: ['/returns/new'],
    roles: [...BOTH],
    summary:
      'Reprendre des produits vendus : le client reçoit un avoir sur son compte, utilisable à sa prochaine visite.',
    steps: [
      'Retrouvez la vente d’origine : numéro de facture, nom ou téléphone du client, puis touchez la vente.',
      'Pour chaque lot vendu, saisissez la quantité retournée et l’état du produit (revendable ou non).',
      'Indiquez le motif du retour et le mode de remboursement : « Avoir sur le compte du client » (recommandé) ou espèces.',
      'Touchez « Enregistrer le retour ». Un code administrateur est demandé si votre rôle ne permet pas de valider seul.',
      'Un avoir AV-AAAA-NNNNNN est émis. Les produits revendables retournent en stock dans leur lot d’origine.',
    ],
    tips: [
      'Le montant repris est le prix réellement payé (remises comprises), au prorata des quantités.',
      'Si la facture n’est pas entièrement payée, le retour réduit d’abord le reste à payer ; l’excédent devient un avoir.',
    ],
    warnings: [
      'Un produit hors délai de retour, à froid ou à tableau, ou un retour en espèces, exige un administrateur.',
    ],
    shot: 'return-new',
    shotCaption: 'Nouveau retour client',
  },

  // --------------------------------------------------------------------------- Clients et règlements
  {
    id: 'clients',
    chapter: 'clients',
    title: 'Liste des clients',
    routes: ['/clients'],
    roles: [...BOTH],
    summary:
      'Tous les clients, leur solde et leur plafond. Solde positif : le client vous doit de l’argent ; solde négatif : il a un crédit (avoir).',
    steps: [
      'Recherchez par nom, code, téléphone ou CIN.',
      'Touchez « Nouveau client » pour créer une fiche (nom, type, téléphone, e-mail, consentement).',
      'Touchez un client pour ouvrir sa fiche complète.',
    ],
    tips: [
      'L’adresse e-mail ne sert que si le client a donné son accord : sans consentement, aucun document ne lui est envoyé automatiquement.',
    ],
    shot: 'clients',
  },
  {
    id: 'client-detail',
    chapter: 'clients',
    title: 'Fiche client et compte',
    routes: ['/clients/:id'],
    roles: [...BOTH],
    summary:
      'La situation d’un client : solde, plafond de crédit, factures ouvertes, historique complet du compte, relevé PDF.',
    steps: [
      'Consultez le solde, le crédit disponible, le plafond restant et les factures échues.',
      'Ouvrez l’historique du compte pour voir chaque facture, règlement et avoir.',
      'Touchez « Encaisser » pour enregistrer un règlement, ou « Relevé » pour éditer ou envoyer le relevé de compte.',
      'Touchez « Modifier » pour corriger les coordonnées et les préférences d’e-mail.',
    ],
    roleNotes: {
      ADMIN: ['Vous seul pouvez modifier le plafond de crédit et la remise habituelle du client.'],
    },
    shot: 'client-detail',
    shotCaption: 'Fiche client',
  },
  {
    id: 'payments',
    chapter: 'clients',
    title: 'Encaissements',
    routes: ['/payments', '/payments/:id'],
    roles: [...BOTH],
    summary:
      'La liste des règlements reçus des clients, avec le lettrage sur les factures et les acomptes non affectés.',
    steps: [
      'Touchez « Nouvel encaissement » pour enregistrer un règlement (voir « Encaisser un règlement »).',
      'Touchez un règlement pour voir les factures qu’il solde et imprimer le reçu.',
    ],
    roleNotes: {
      ADMIN: ['Vous pouvez annuler un règlement ou déclarer un chèque impayé depuis sa fiche.'],
    },
    shot: 'payments',
  },
  {
    id: 'payment-new',
    chapter: 'clients',
    title: 'Encaisser un règlement (lettrage)',
    routes: [],
    roles: [...BOTH],
    summary:
      'Un règlement s’affecte aux factures du client : c’est le « lettrage ». Une facture peut être soldée en plusieurs règlements.',
    steps: [
      'Ouvrez Règlements → Encaissements puis « Nouvel encaissement » (ou « Encaisser » depuis la fiche du client).',
      'Choisissez le client : son solde et ses factures ouvertes s’affichent.',
      'Indiquez le mode (espèces, chèque, virement…) et le montant reçu.',
      'Choisissez le lettrage : « Automatique » (factures les plus anciennes d’abord), « Manuel » (vous répartissez facture par facture) ou « Acompte » (aucune facture, le montant reste en crédit).',
      'Touchez « Enregistrer le règlement ». Un reçu REG-AAAA-NNNNNN est émis ; les factures soldées passent à « Payée ».',
    ],
    tips: ['Un règlement partiel laisse la facture « Partiellement payée » avec le reste à payer.'],
    shot: 'payment-new',
    shotCaption: 'Nouvel encaissement avec lettrage',
  },
  {
    id: 'cheques',
    chapter: 'clients',
    title: 'Chèques et traites',
    routes: ['/payments/cheques'],
    roles: [...BOTH],
    summary: 'Le portefeuille des chèques et traites reçus, classés par date d’échéance.',
    steps: [
      'Repérez les chèques à remettre en banque avec leur échéance.',
      'Touchez un chèque pour changer son statut : remis en banque, encaissé.',
    ],
    roleNotes: {
      ADMIN: [
        'Vous seul pouvez déclarer un chèque « impayé » : le compte du client est alors rétabli.',
      ],
    },
    shot: 'cheques',
  },
  {
    id: 'aging',
    chapter: 'clients',
    title: 'Balance âgée',
    routes: ['/payments/aging'],
    roles: [...BOTH],
    summary:
      'Les créances par client selon l’ancienneté des factures (0–30, 31–60, 61–90 et plus de 90 jours).',
    steps: [
      'Repérez les clients dont les factures sont les plus anciennes.',
      'Touchez un client pour ouvrir sa fiche et enregistrer un règlement ou envoyer un relevé.',
    ],
    shot: 'aging',
  },
];
