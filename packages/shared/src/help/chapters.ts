import type { HelpChapter } from './types.js';

export const HELP_CHAPTERS: HelpChapter[] = [
  {
    id: 'start',
    title: 'Premiers pas',
    intro: {
      default:
        'Ce chapitre explique comment se connecter, se repérer dans le logiciel et utiliser le tableau de bord.',
    },
  },
  {
    id: 'sell',
    title: 'Vendre au comptoir',
    intro: {
      default:
        'L’écran de caisse est l’écran principal de la pharmacie : il permet de servir un client de la recherche du produit jusqu’au ticket.',
      PREPARER:
        'Vous passez l’essentiel de votre journée sur l’écran de caisse. Apprenez ses raccourcis : ils font gagner beaucoup de temps.',
      ADMIN:
        'Vous utilisez aussi l’écran de caisse, et c’est vous qui accordez les autorisations (code administrateur) demandées aux préparateurs.',
    },
  },
  {
    id: 'sales',
    title: 'Ventes, retours et avoirs',
    intro: {
      default:
        'Retrouver une vente, réimprimer un document, gérer le retour d’un client et l’avoir qui en découle.',
      ADMIN:
        'Vous seul pouvez annuler ou modifier une vente validée. Chaque action est tracée au mouchard avec son motif.',
    },
  },
  {
    id: 'clients',
    title: 'Clients et règlements',
    intro: {
      default:
        'Fiches clients, comptes, ventes à crédit, encaissement des règlements et lettrage sur les factures.',
    },
  },
  {
    id: 'stock',
    title: 'Stock et péremptions',
    intro: {
      default:
        'Suivre le stock par lot, surveiller les péremptions et retrouver l’historique d’un produit.',
    },
  },
  {
    id: 'buy',
    title: 'Achats et réceptions',
    intro: {
      default:
        'Recevoir la marchandise, gérer les fournisseurs, réapprovisionner, commander et renvoyer des produits.',
    },
  },
  {
    id: 'inventory',
    title: 'Inventaires et ajustements',
    intro: {
      default:
        'Compter le stock physique, corriger les écarts et déclarer les pertes ou les casses.',
      PREPARER:
        'Vous pouvez participer aux comptages et déclarer une casse ; l’administrateur valide ensuite.',
    },
  },
  {
    id: 'cash',
    title: 'Caisse et sessions',
    intro: {
      default:
        'Ouvrir la caisse avec son fond, enregistrer les mouvements d’espèces, puis la clôturer en comptant à l’aveugle.',
    },
  },
  {
    id: 'catalog',
    title: 'Catalogue produits',
    intro: {
      default: 'Consulter et tenir à jour la liste des produits, leurs prix et leurs codes-barres.',
    },
  },
  {
    id: 'reports',
    title: 'Statistiques et rapports',
    intro: {
      default: 'Analyser les ventes, les marges, le stock, les achats et les créances.',
    },
  },
  {
    id: 'audit',
    title: 'Mouchard et contrôle',
    intro: {
      default:
        'Le mouchard enregistre, sans possibilité de le modifier, qui a fait quoi, quand et depuis quel poste.',
    },
  },
  {
    id: 'admin',
    title: 'Administration',
    intro: {
      default:
        'Utilisateurs, rôles, postes de travail, paramètres, e-mails, tâches automatiques et sauvegardes.',
    },
  },
  {
    id: 'account',
    title: 'Mon compte et mes notifications',
    intro: {
      default: 'Changer son mot de passe ou son PIN, choisir de quoi être prévenu et comment.',
    },
  },
  {
    id: 'install',
    title: 'Installer l’application',
    intro: {
      default:
        'PharmaStock s’utilise dans un navigateur, mais peut aussi s’installer comme une application sur téléphone, sur tablette ou sur ordinateur.',
    },
  },
];
