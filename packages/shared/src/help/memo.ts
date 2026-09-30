import type { CheatSheetBlock } from './types.js';

/**
 * Fiche mémo d’une page pour les préparateurs (à imprimer et poser près du poste).
 * Le PDF est généré par `tools/docs` ; la page Aide l’affiche à l’écran.
 */
export const CHEAT_SHEET_TITLE = 'Aide-mémoire du préparateur';
export const CHEAT_SHEET_SUBTITLE = 'À poser à côté du poste de caisse';

export const CHEAT_SHEET: CheatSheetBlock[] = [
  {
    title: 'Faire une vente',
    kind: 'steps',
    items: [
      'Caisse ouverte ? (Sessions de caisse → « Ouvrir la caisse » + fond de caisse)',
      'F12 ou menu « Caisse ». F3 : choisir le client (obligatoire).',
      'F2 : scanner ou taper le produit, Entrée. F6 : quantité.',
      'Ordonnance ou tableau : noter prescripteur et n° d’ordonnance.',
      'F9 : Paiement. Espèces : « Montant remis ». Plusieurs modes possibles.',
      'F10 : « Valider la vente ». Ticket ou facture A4. Le stock est mis à jour.',
    ],
  },
  {
    title: 'Raccourcis de la caisse',
    kind: 'keys',
    items: [
      ['F1', 'Aide de la caisse'],
      ['F2', 'Produit (scan / recherche)'],
      ['F3', 'Client'],
      ['F4', 'Remise ou prix de la ligne'],
      ['F6', 'Quantité de la ligne'],
      ['F8', 'Mettre la vente en attente'],
      ['F9', 'Paiement'],
      ['F10', 'Valider la vente'],
      ['↑ ↓', 'Choisir une ligne'],
      ['Suppr', 'Retirer la ligne'],
      ['Échap', 'Fermer la fenêtre'],
      ['Ctrl K', 'Recherche partout'],
    ],
  },
  {
    title: 'Faire un retour',
    kind: 'steps',
    items: [
      'Menu « Retours & avoirs » → « Nouveau retour ».',
      'Retrouver la vente (n° de facture, nom ou téléphone du client).',
      'Quantité rendue par lot + état du produit (revendable ou non).',
      'Motif, puis « Avoir sur le compte du client » (recommandé).',
      '« Enregistrer le retour ». Hors délai, à froid ou en espèces : appeler un administrateur.',
    ],
  },
  {
    title: 'Fermer la caisse le soir',
    kind: 'steps',
    items: [
      'Sessions de caisse → « Clôturer ».',
      'Compter les espèces par coupures, sans chercher le montant attendu.',
      'Valider. Écart : recompter, sinon écrire un commentaire.',
    ],
  },
  {
    title: 'Si ça ne marche pas',
    kind: 'list',
    items: [
      '« Stock insuffisant » alors que la boîte est là : lot périmé, bloqué, ou réception non validée → voir Stock → Lots.',
      'Demande de code administrateur 🔑 : l’administrateur saisit lui-même son code, son PIN et le motif.',
      'PIN oublié ou compte verrouillé : demander à un administrateur (Administration → Utilisateurs).',
      'Le client n’a pas reçu sa facture : vérifier l’adresse sur sa fiche, puis « Renvoyer par e-mail » dans la vente.',
      'Vente en attente : Ventes → Ventes en attente. Erreur sur une vente validée : administrateur.',
      'Besoin d’aide sur un écran : bouton « ? » en haut, ou touche F1 à la caisse.',
    ],
  },
  {
    title: 'À ne jamais faire',
    kind: 'list',
    items: [
      'Donner son mot de passe ou son PIN, même à un collègue.',
      'Vendre un lot périmé ou une boîte sans l’enregistrer.',
      'Laisser la session ouverte en quittant le poste : « Verrouiller l’écran ».',
      'Corriger un écart de caisse ou de stock « à la main » : tout se justifie et se trace.',
    ],
  },
];
