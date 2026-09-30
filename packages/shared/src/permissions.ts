/**
 * Catalogue des permissions (RBAC) — cahier des charges §5.
 *
 * `preparer` : valeur par défaut pour le rôle système « Préparateur ».
 * `overridable` : si le rôle n'a pas la permission, l'action reste possible avec
 * le code + PIN d'un administrateur (🔑, §5.4).
 */

export interface PermissionDefinition {
  module: PermissionModule;
  label: string;
  preparer: boolean;
  overridable?: boolean;
}

export const PERMISSION_MODULES = {
  sales: 'Ventes',
  returns: 'Retours et avoirs',
  payments: 'Règlements',
  stock: 'Stock et achats',
  catalog: 'Catalogue',
  clients: 'Clients',
  suppliers: 'Fournisseurs',
  cash: 'Caisse',
  reports: 'Statistiques et rapports',
  admin: 'Administration',
  email: 'E-mail et notifications',
} as const;

export type PermissionModule = keyof typeof PERMISSION_MODULES;

const definitions = {
  // Ventes
  'sales.create': { module: 'sales', label: 'Créer une vente, scanner, choisir l’acheteur', preparer: true },
  'sales.hold': { module: 'sales', label: 'Mettre une vente en attente / la reprendre', preparer: true },
  'sales.credit': { module: 'sales', label: 'Vente à crédit dans la limite du plafond client', preparer: true },
  'sales.credit_over_limit': { module: 'sales', label: 'Dépasser le plafond de crédit', preparer: false, overridable: true },
  'sales.discount_over_limit': { module: 'sales', label: 'Remise au-delà du plafond préparateur', preparer: false, overridable: true },
  'sales.price_override': { module: 'sales', label: 'Modifier le prix unitaire en vente', preparer: false, overridable: true },
  'sales.force_lot': { module: 'sales', label: 'Forcer un lot hors règle FEFO/FIFO', preparer: false, overridable: true },
  'sales.below_cost': { module: 'sales', label: 'Vendre sous le coût du lot', preparer: false, overridable: true },
  'sales.reprint': { module: 'sales', label: 'Réimprimer un ticket / une facture', preparer: true },
  'sales.view_all': { module: 'sales', label: 'Voir toutes les ventes (sans coûts ni marges)', preparer: true },
  'sales.cancel': { module: 'sales', label: 'Annuler une vente validée', preparer: false },
  'sales.modify': { module: 'sales', label: 'Modifier une vente validée', preparer: false },
  'sales.walk_in': { module: 'sales', label: 'Vendre au « client comptoir » (si activé)', preparer: true },
  // Retours
  'returns.create': { module: 'returns', label: 'Saisir un retour client (avoir sur compte)', preparer: true },
  'returns.approve': { module: 'returns', label: 'Valider un retour sans code administrateur', preparer: false, overridable: true },
  'returns.late': { module: 'returns', label: 'Accepter un retour hors délai', preparer: false, overridable: true },
  'returns.cash_refund': { module: 'returns', label: 'Rembourser un retour en espèces', preparer: false },
  'returns.without_sale': { module: 'returns', label: 'Retour sans vente d’origine', preparer: false },
  // Règlements
  'payments.create': { module: 'payments', label: 'Enregistrer un règlement et le lettrer', preparer: true },
  'payments.cancel': { module: 'payments', label: 'Annuler un règlement / déclarer un chèque impayé', preparer: false },
  // Stock et achats
  'stock.view': { module: 'stock', label: 'Consulter stock, lots, péremptions', preparer: true },
  'stock.movements': { module: 'stock', label: 'Consulter la fiche de mouvement d’un produit', preparer: true },
  'receipts.create': { module: 'stock', label: 'Saisir une réception (brouillon)', preparer: true },
  'receipts.validate': { module: 'stock', label: 'Valider une réception', preparer: true },
  'receipts.cancel': { module: 'stock', label: 'Annuler une réception validée', preparer: false },
  'adjustments.create': { module: 'stock', label: 'Déclarer une casse / perte (à valider)', preparer: true },
  'adjustments.validate': { module: 'stock', label: 'Valider un ajustement, une perte, une destruction', preparer: false },
  'inventory.count': { module: 'stock', label: 'Saisir les comptages d’inventaire', preparer: true },
  'inventory.manage': { module: 'stock', label: 'Ouvrir / valider un inventaire', preparer: false },
  'lots.manage': { module: 'stock', label: 'Bloquer / débloquer un lot, lancer un rappel de lot', preparer: false },
  'supplier_returns.manage': { module: 'stock', label: 'Retours fournisseurs', preparer: false },
  // Catalogue
  'catalog.view': { module: 'catalog', label: 'Consulter le catalogue', preparer: true },
  'catalog.manage': { module: 'catalog', label: 'Créer / modifier un produit, modifier un prix', preparer: false },
  'catalog.view_costs': { module: 'catalog', label: 'Voir prix d’achat, coûts et marges', preparer: false },
  // Clients
  'clients.view': { module: 'clients', label: 'Consulter les clients', preparer: true },
  'clients.create': { module: 'clients', label: 'Créer un client', preparer: true },
  'clients.edit': { module: 'clients', label: 'Modifier un client (coordonnées)', preparer: true },
  'clients.edit_credit': { module: 'clients', label: 'Modifier plafond de crédit / remise habituelle', preparer: false },
  // Fournisseurs
  'suppliers.view': { module: 'suppliers', label: 'Consulter les fournisseurs', preparer: true },
  'suppliers.manage': { module: 'suppliers', label: 'Gérer les fournisseurs', preparer: false },
  // Caisse
  'cash.operate': { module: 'cash', label: 'Ouvrir / clôturer sa caisse (comptage à l’aveugle)', preparer: true },
  'cash.view_expected': { module: 'cash', label: 'Voir montants théoriques, écarts, rapports X/Z', preparer: false },
  'cash.expense': { module: 'cash', label: 'Sortie de caisse (dépense), apport, ouverture du tiroir', preparer: false },
  // Statistiques
  'dashboard.full': { module: 'reports', label: 'Tableau de bord complet (CA, marges, valeur du stock)', preparer: false },
  'dashboard.personal': { module: 'reports', label: 'Tableau de bord personnel', preparer: true },
  'reports.view': { module: 'reports', label: 'Statistiques, rapports et exports', preparer: false },
  // Administration
  'audit.view': { module: 'admin', label: 'Mouchard / journal d’audit', preparer: false },
  'admin.users': { module: 'admin', label: 'Gérer les utilisateurs et les sessions', preparer: false },
  'admin.roles': { module: 'admin', label: 'Gérer les rôles et permissions', preparer: false },
  'admin.devices': { module: 'admin', label: 'Gérer les postes de travail', preparer: false },
  'admin.settings': { module: 'admin', label: 'Modifier les paramètres', preparer: false },
  'admin.backups': { module: 'admin', label: 'Sauvegardes', preparer: false },
  // E-mail
  'email.configure': { module: 'email', label: 'Configurer SMTP, modèles et envois automatiques', preparer: false },
  'notifications.email.receive': { module: 'email', label: 'Choisir ses notifications sur l’activité des employés', preparer: false },
  'email.send_documents': { module: 'email', label: 'Envoyer / renvoyer un document au client par e-mail', preparer: true },
  'email.view_log': { module: 'email', label: 'Consulter le journal des e-mails', preparer: false },
} as const satisfies Record<string, PermissionDefinition>;

export type Permission = keyof typeof definitions;

export const PERMISSIONS: Record<Permission, PermissionDefinition> = definitions;

export const ALL_PERMISSIONS = Object.keys(definitions) as Permission[];

export const PREPARER_DEFAULT_PERMISSIONS = ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].preparer);

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(definitions, value);
}

export const SYSTEM_ROLES = {
  ADMIN: 'Administrateur',
  PREPARER: 'Préparateur',
} as const;
