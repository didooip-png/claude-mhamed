import type { HelpTopic } from './types.js';

const BOTH = ['ADMIN', 'PREPARER'] as const;
const ADMIN = ['ADMIN'] as const;

/** Stock, achats, inventaires, ajustements, caisse et catalogue. */
export const TOPICS_STOCK: HelpTopic[] = [
  // --------------------------------------------------------------------------- Stock
  {
    id: 'stock-state',
    chapter: 'stock',
    title: 'État du stock',
    routes: ['/stock'],
    roles: [...BOTH],
    summary:
      'La quantité vendable de chaque produit. Le stock vendable ne compte que les lots actifs et non périmés : un lot bloqué, en quarantaine ou périmé n’est jamais vendu.',
    steps: [
      'Recherchez un produit par nom, molécule, code ou code-barres.',
      'Filtrez par niveau (OK, bas, rupture), catégorie, laboratoire ou emplacement.',
      'Touchez un produit pour voir sa fiche et ses lots.',
    ],
    tips: [
      'Sur ordinateur, « Colonnes » permet d’afficher ou masquer des colonnes ; sur téléphone, chaque produit est une carte.',
    ],
    roleNotes: {
      ADMIN: ['Vous voyez aussi la valeur du stock au coût réel et au prix de vente.'],
    },
    shot: 'stock',
    shotCaption: 'État du stock',
  },
  {
    id: 'lots',
    chapter: 'stock',
    title: 'Lots',
    routes: ['/stock/lots'],
    roles: [...BOTH],
    summary:
      'Chaque réception crée des lots, avec leur numéro et leur date de péremption. Les couleurs indiquent l’urgence : rouge périmé, orange moins de 30 jours, jaune moins de 90 jours, vert OK.',
    steps: [
      'Recherchez un produit ou un numéro de lot.',
      'Filtrez par niveau de péremption pour voir ce qui presse.',
    ],
    roleNotes: {
      ADMIN: [
        'Touchez « Bloquer » pour retirer un lot de la vente en cas de doute qualité ou de rappel ; « Débloquer » le remet en vente. Le motif est obligatoire et tracé.',
      ],
    },
    shot: 'lots',
  },
  {
    id: 'expiries',
    chapter: 'stock',
    title: 'Péremptions',
    routes: ['/stock/expiries'],
    roles: [...BOTH],
    summary: 'Les lots à écouler en priorité ou à retirer, du plus urgent au moins urgent.',
    steps: [
      'Choisissez l’horizon (30, 60, 90 jours ou plus).',
      'Écoulez d’abord les lots les plus proches : la règle FEFO le fait automatiquement en caisse.',
      'Pour les lots périmés : déclarez la destruction (Ajustements) ou le retour au fournisseur (Retours fournisseurs).',
    ],
    warnings: ['Un lot périmé ne peut jamais être vendu, même en forçant.'],
    shot: 'expiries',
  },
  {
    id: 'movements',
    chapter: 'stock',
    title: 'Fiche de mouvement d’un produit',
    routes: ['/stock/movements'],
    roles: [...BOTH],
    summary:
      'L’historique complet d’un produit depuis une date : stock initial, chaque entrée et sortie (qui, quand, quel lot, quel document) et stock final. C’est l’outil pour comprendre un écart.',
    steps: [
      'Choisissez le produit dans la zone de recherche.',
      'Indiquez la date de départ (« Du ») et éventuellement la date de fin.',
      'Lisez le stock initial, puis chaque mouvement : type, document, lot, tiers, utilisateur, poste, quantité et solde.',
      'Exportez en Excel ou PDF si besoin.',
    ],
    tips: [
      'Les mouvements ne se modifient jamais : une erreur se corrige par un mouvement inverse.',
    ],
    shot: 'movements',
    shotCaption: 'Fiche de mouvement',
  },
  {
    id: 'at-date',
    chapter: 'stock',
    title: 'Stock à une date',
    routes: ['/stock/at-date'],
    roles: [...BOTH],
    summary: 'Reconstitue le stock tel qu’il était à la fin d’une journée passée.',
    steps: [
      'Choisissez la date.',
      'Consultez les quantités et, pour l’administrateur, leur valeur.',
    ],
    shot: 'at-date',
  },
  {
    id: 'recall',
    chapter: 'stock',
    title: 'Rappel de lot',
    routes: ['/stock/recall'],
    roles: [...ADMIN],
    summary:
      'Quand un laboratoire ou l’autorité rappelle un lot : retrouvez-le, bloquez-le et identifiez les clients qui l’ont reçu.',
    steps: [
      'Saisissez le numéro de lot rappelé puis « Rechercher ».',
      'Vérifiez les produits concernés, les quantités en stock et les clients servis.',
      'Touchez « Bloquer » : le lot n’est plus vendable, quel que soit le produit.',
      'Touchez « Retour fournisseur » pour préparer le renvoi, ou « Imprimer la liste » des clients à prévenir.',
    ],
    shot: 'recall',
  },

  // --------------------------------------------------------------------------- Achats
  {
    id: 'receipts',
    chapter: 'buy',
    title: 'Réceptions',
    routes: ['/receipts', '/receipts/:id'],
    roles: [...BOTH],
    summary:
      'Les entrées en stock. Un brouillon n’a pas de numéro ; le numéro REC-AAAA-NNNNNN est attribué à la validation.',
    steps: [
      'Touchez « Nouvelle réception » pour saisir une livraison.',
      'Touchez un brouillon pour le reprendre, ou une réception validée pour la consulter et l’imprimer.',
    ],
    roleNotes: {
      ADMIN: [
        'Vous pouvez annuler une réception validée (motif obligatoire) tant que les lots n’ont pas été vendus.',
      ],
    },
    shot: 'receipts',
  },
  {
    id: 'receipt-new',
    chapter: 'buy',
    title: 'Recevoir de la marchandise',
    routes: ['/receipts/new'],
    roles: [...BOTH],
    summary:
      'Chaque ligne de réception crée un lot : numéro de lot, péremption, quantité et source d’approvisionnement.',
    steps: [
      'Choisissez la source (fournisseur, don, transfert…) et le fournisseur ; renseignez la référence et la date de la facture fournisseur.',
      'Ajoutez les produits en scannant leur code-barres ou en les cherchant par nom. Un produit reçu en deux lots s’ajoute deux fois.',
      'Pour chaque ligne, saisissez le numéro de lot, la péremption comme sur la boîte (MM/AAAA), la quantité, les unités gratuites, le prix d’achat HT, la remise et la TVA.',
      'Touchez « Enregistrer le brouillon » pour reprendre plus tard, ou « Valider la réception ».',
      'Vérifiez le récapitulatif (avertissements de péremption courte, de prix inhabituel) puis confirmez.',
    ],
    tips: [
      'Vous pouvez joindre le scan de la facture fournisseur (PDF ou photo).',
      'Si la réception vient d’une commande fournisseur, ouvrez-la depuis la commande : les lignes commandées sont préremplies.',
    ],
    warnings: [
      'Une réception validée ne se modifie plus. En cas d’erreur, demandez à l’administrateur de l’annuler puis refaites-la.',
    ],
    shot: 'receipt-new',
    shotCaption: 'Nouvelle réception avec deux lots',
  },
  {
    id: 'suppliers',
    chapter: 'buy',
    title: 'Fournisseurs',
    routes: ['/suppliers'],
    roles: [...BOTH],
    summary: 'La liste des fournisseurs, leurs coordonnées et leurs délais de paiement.',
    steps: [
      'Recherchez un fournisseur par nom.',
      'Touchez « Nouveau fournisseur » pour en créer un (nom, adresse e-mail pour les commandes, délai de paiement).',
    ],
    roleNotes: {
      PREPARER: [
        'Vous pouvez consulter les fournisseurs ; la gestion est réservée à l’administrateur.',
      ],
    },
    shot: 'suppliers',
  },
  {
    id: 'reorder',
    chapter: 'buy',
    title: 'Réapprovisionnement',
    routes: ['/reorder'],
    roles: [...BOTH],
    summary:
      'Les produits sous leur point de commande, avec la quantité conseillée d’après la consommation moyenne et le délai du fournisseur.',
    steps: [
      'Consultez les suggestions triées par urgence (rupture d’abord).',
      'Cochez les lignes à commander (vous pouvez ajuster les quantités).',
    ],
    roleNotes: {
      ADMIN: [
        'Touchez « Créer la commande » : un bon de commande brouillon est préparé, groupé par fournisseur.',
      ],
    },
    shot: 'reorder',
  },
  {
    id: 'purchase-orders',
    chapter: 'buy',
    title: 'Commandes fournisseurs',
    routes: [
      '/purchase-orders',
      '/purchase-orders/new',
      '/purchase-orders/:id',
      '/purchase-orders/:id/edit',
    ],
    roles: [...BOTH],
    summary:
      'Les bons de commande : préparation, envoi par e-mail au fournisseur avec le PDF, suivi des livraisons et réceptions rattachées.',
    steps: [
      'Touchez « Nouvelle commande », choisissez le fournisseur et ajoutez les produits et quantités.',
      'Touchez « Envoyer » : le numéro BC-AAAA-NNNNNN est attribué et le PDF part par e-mail au fournisseur.',
      'À la livraison, touchez « Réceptionner » : la réception est préremplie avec les lignes commandées ; les écarts (surplus, produit non commandé) sont signalés.',
      'Touchez « Clôturer » pour solder le reliquat d’une commande partiellement livrée.',
    ],
    roleNotes: {
      PREPARER: [
        'Vous pouvez consulter les commandes et réceptionner ; la création et l’envoi sont réservés à l’administrateur.',
      ],
    },
    shot: 'purchase-orders',
  },
  {
    id: 'supplier-returns',
    chapter: 'buy',
    title: 'Retours fournisseurs',
    routes: ['/supplier-returns', '/supplier-returns/new', '/supplier-returns/:id'],
    roles: [...ADMIN],
    summary:
      'Renvoyer au fournisseur des produits périmés, défectueux, en erreur de livraison ou rappelés. Le stock sort dès l’enregistrement ; le retour reste en attente d’avoir.',
    steps: [
      'Touchez « Nouveau retour », choisissez le fournisseur et le motif.',
      'Sélectionnez les lots et les quantités à renvoyer (le lot doit provenir de ce fournisseur).',
      'Enregistrez, puis imprimez le « Bon de retour » à joindre au colis.',
      'À réception de l’avoir du fournisseur, ouvrez le retour et touchez « Avoir reçu » pour le solder.',
    ],
    shot: 'supplier-returns',
  },

  // --------------------------------------------------------------------------- Inventaire
  {
    id: 'inventories',
    chapter: 'inventory',
    title: 'Inventaires',
    routes: ['/inventories'],
    roles: [...BOTH],
    summary:
      'Comptage physique du stock par lot, comparaison avec le stock théorique et correction des écarts.',
    steps: [
      'Repérez l’inventaire « Comptage en cours » et touchez-le pour participer au comptage.',
    ],
    roleNotes: {
      ADMIN: [
        'Touchez « Ouvrir un inventaire » : complet, par catégorie, par laboratoire, par emplacement ou sur une sélection de produits.',
      ],
    },
    shot: 'inventories',
  },
  {
    id: 'inventory-detail',
    chapter: 'inventory',
    title: 'Compter le stock (inventaire)',
    routes: ['/inventories/:id'],
    roles: [...BOTH],
    summary:
      'Le comptage est « à l’aveugle » : vous saisissez ce que vous trouvez sur l’étagère sans voir le stock théorique. Plusieurs personnes peuvent compter en même temps, y compris avec un téléphone.',
    steps: [
      'Repérez la ligne du produit et du lot (scannez le code-barres ou cherchez le lot dans la zone de recherche).',
      'Saisissez la quantité comptée puis Entrée : la ligne est enregistrée avec votre code.',
      'Un lot trouvé sur l’étagère mais absent de la liste : touchez « Ajouter un lot ».',
      'Quand tout est compté, touchez « Terminer le comptage ».',
    ],
    roleNotes: {
      ADMIN: [
        'Touchez « Valider » : le récapitulatif montre les lots en écart, les unités en plus ou en moins et leur valeur. La validation crée les ajustements de stock (un mouvement par lot en écart). Les ventes réalisées pendant le comptage sont prises en compte.',
        '« Rapport des écarts » et « Excel » exportent le résultat ; « Annuler » abandonne l’inventaire (motif obligatoire).',
      ],
    },
    warnings: [
      'Ne modifiez pas le stock (réceptions, retours) dans la zone comptée pendant l’inventaire.',
    ],
    shot: 'inventory-detail',
    shotCaption: 'Comptage d’un inventaire',
  },
  {
    id: 'adjustments',
    chapter: 'inventory',
    title: 'Ajustements : casses, pertes, destructions',
    routes: ['/adjustments', '/adjustments/:id'],
    roles: [...BOTH],
    summary:
      'Déclarer une casse, une perte, un vol ou la destruction de produits périmés, ou corriger une quantité hors inventaire. Chaque ajustement exige un motif.',
    steps: [
      'Touchez « Déclarer » puis choisissez le type d’ajustement.',
      'Sélectionnez le lot et la quantité concernés, et écrivez le motif.',
      'Enregistrez : l’ajustement attend la validation d’un administrateur (il ne touche pas encore le stock).',
    ],
    roleNotes: {
      ADMIN: [
        'Ouvrez la déclaration et touchez « Valider » (ou « Rejeter » avec un motif). À la validation, le stock est corrigé et un numéro AJ-AAAA-NNNNNN est attribué.',
        'Pour les lots périmés, l’écran propose d’ajouter tous les lots périmés d’un coup.',
      ],
    },
    shot: 'adjustments',
  },

  // --------------------------------------------------------------------------- Caisse
  {
    id: 'cash',
    chapter: 'cash',
    title: 'Ouvrir la caisse et suivre la session',
    routes: ['/cash'],
    roles: [...BOTH],
    summary:
      'Une session de caisse regroupe les encaissements en espèces d’un poste entre l’ouverture (avec un fond de caisse) et la clôture (comptage).',
    steps: [
      'En début de journée, saisissez le « Fond de caisse » (espèces déjà dans le tiroir) puis touchez « Ouvrir la caisse ».',
      'Vendez normalement : les encaissements en espèces alimentent la session.',
      'En fin de journée, touchez « Clôturer » (voir « Clôturer la caisse à l’aveugle »).',
    ],
    roleNotes: {
      ADMIN: [
        '« Mouvement de caisse » enregistre une dépense, un apport ou un retrait avec son motif. « Rapport X » édite l’état en cours de journée. L’historique des sessions montre les écarts.',
      ],
    },
    warnings: ['Une seule caisse peut être ouverte par poste.'],
    shot: 'cash',
    shotCaption: 'Ouverture de la caisse',
  },
  {
    id: 'cash-close',
    chapter: 'cash',
    title: 'Clôturer la caisse à l’aveugle',
    routes: [],
    roles: [...BOTH],
    summary:
      'À la clôture, vous comptez les espèces sans connaître le montant attendu. Le serveur calcule seul l’écart : impossible de « tomber juste » en trichant.',
    steps: [
      'Touchez « Clôturer ».',
      'Comptez les billets et les pièces du tiroir et saisissez le nombre de chaque coupure. Le total compté s’affiche.',
      'Ajoutez une remarque si besoin, touchez « Clôturer » puis « Confirmer la clôture ».',
      'Le montant compté s’affiche. L’écart éventuel est transmis à l’administrateur.',
    ],
    warnings: [
      'Ne recommencez pas une clôture pour « corriger » un écart : signalez-le à l’administrateur.',
    ],
    shot: 'cash-close',
    shotCaption: 'Comptage par coupure',
  },
  {
    id: 'cash-session',
    chapter: 'cash',
    title: 'Détail d’une session de caisse',
    routes: ['/cash/:id'],
    roles: [...BOTH],
    summary: 'Le détail d’une session : ouverture, mouvements, montant attendu, compté et écart.',
    steps: [
      'Ouvrez une session depuis l’historique.',
      'Consultez les ventes en espèces, les mouvements et, pour une session clôturée, l’écart.',
    ],
    roleNotes: {
      PREPARER: ['Le montant attendu et l’écart ne sont pas affichés pour un préparateur.'],
    },
    shot: 'cash-session',
  },

  // --------------------------------------------------------------------------- Catalogue
  {
    id: 'products',
    chapter: 'catalog',
    title: 'Catalogue des produits',
    routes: ['/products'],
    roles: [...BOTH],
    summary:
      'La liste des produits. La recherche tolère les accents et les petites fautes de frappe (par nom, molécule, code interne ou code-barres).',
    steps: [
      'Tapez quelques lettres dans la zone de recherche.',
      'Filtrez par catégorie, laboratoire, niveau de stock ou emplacement.',
      'Touchez un produit pour ouvrir sa fiche.',
    ],
    roleNotes: {
      ADMIN: [
        'Touchez « Nouveau produit » pour en créer un (nom, catégorie, TVA, prix de vente TTC, conditionnement). Le code interne est attribué automatiquement. « Importer » et « Exporter » gèrent le catalogue par fichier Excel.',
      ],
    },
    shot: 'products',
  },
  {
    id: 'product-detail',
    chapter: 'catalog',
    title: 'Fiche produit',
    routes: ['/products/:id'],
    roles: [...BOTH],
    summary:
      'Les caractéristiques d’un produit : molécule, dosage, forme, laboratoire, TVA, prix, codes-barres, seuils de stock et stock par lot.',
    steps: [
      'Consultez le stock vendable, les lots et la prochaine péremption.',
      'Touchez « Fiche de mouvement » pour voir tout l’historique du produit.',
    ],
    roleNotes: {
      ADMIN: [
        'Touchez « Modifier » pour changer les informations. Chaque changement de prix est historisé. Un produit s’archive (décochez « Actif ») au lieu de se supprimer.',
      ],
    },
    tips: [
      'Si quelqu’un a modifié la fiche pendant que vous l’éditiez, un message propose de la recharger.',
    ],
    shot: 'product-detail',
  },
  {
    id: 'references',
    chapter: 'catalog',
    title: 'Catégories, laboratoires et TVA',
    routes: ['/catalog/references'],
    roles: [...ADMIN],
    summary:
      'Les listes de référence du catalogue : catégories, laboratoires, familles thérapeutiques, taux de TVA.',
    steps: [
      'Choisissez l’onglet (catégories, laboratoires, familles, TVA).',
      'Touchez « Ajouter » pour créer une entrée, ou une ligne pour la modifier ou la désactiver.',
    ],
    warnings: ['Une entrée utilisée par des produits se désactive mais ne se supprime pas.'],
    shot: 'references',
  },
];
