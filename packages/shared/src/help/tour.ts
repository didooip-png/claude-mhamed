import type { TourStep } from './types.js';

/**
 * Visite guidée du premier lancement. Chaque étape désigne un élément par son attribut
 * `data-tour` ; s’il est absent ou masqué (téléphone, droits), l’étape s’affiche au centre.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Bienvenue dans PharmaStock',
    text: 'Cette visite de moins d’une minute présente les repères de l’écran. Vous pouvez la quitter à tout moment et la relancer depuis le bouton « ? ».',
  },
  {
    target: 'nav',
    title: 'Le menu',
    text: 'Tous vos écrans sont ici : caisse, ventes, stock, clients… Vous ne voyez que ce que votre rôle vous permet de faire.',
  },
  {
    target: 'nav-pos',
    title: 'La caisse',
    text: 'C’est l’écran du comptoir. Raccourci clavier : F12. Une vente se fait en quelques secondes, au scanner ou au clavier.',
    roles: ['ADMIN', 'PREPARER'],
  },
  {
    target: 'search',
    title: 'Recherche partout',
    text: 'Retrouvez un produit, un client, une vente ou un écran en tapant quelques lettres. Raccourci : Ctrl K.',
  },
  {
    target: 'bell',
    title: 'Les alertes',
    text: 'La cloche prévient des ruptures, des péremptions proches, des chèques à échéance… Le chiffre indique les alertes non lues.',
  },
  {
    target: 'user',
    title: 'Votre compte',
    text: 'Changez votre mot de passe ou votre PIN, verrouillez l’écran en quittant le poste, ou changez d’utilisateur avec un PIN.',
  },
  {
    target: 'nav-admin',
    title: 'L’administration',
    text: 'Le menu « Administration » regroupe les utilisateurs, les rôles, les postes de travail, les paramètres, les e-mails et les sauvegardes. Commencez par Paramètres → Établissement.',
    roles: ['ADMIN'],
  },
  {
    target: 'nav-reports',
    title: 'Statistiques et mouchard',
    text: 'Les entrées « Statistiques & rapports » (ventes, marges, stock…) et « Mouchard » (journal infalsifiable des opérations sensibles) sont réservées aux administrateurs.',
    roles: ['ADMIN'],
  },
  {
    target: 'help',
    title: 'Besoin d’aide ?',
    text: 'Le bouton « ? » explique l’écran où vous êtes, pas à pas. Il donne aussi l’accès à la FAQ « Que faire si… », à la fiche mémo à imprimer et à cette visite.',
  },
  {
    title: 'À vous de jouer',
    text: 'Pour vendre : ouvrez la caisse de votre poste (Sessions de caisse), puis rendez-vous dans « Caisse ». Les bulles « ? » à côté des champs difficiles vous guident au fil de l’eau.',
  },
];

/** Clé de mémorisation (par utilisateur) de la visite déjà vue. */
export const TOUR_STORAGE_KEY = 'pharmastock.tour.v1';
