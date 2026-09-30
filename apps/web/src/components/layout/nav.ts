import type { Permission } from '@pharmastock/shared';
import {
  Activity,
  BarChart3,
  Boxes,
  ClipboardList,
  Coins,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Receipt,
  RotateCcw,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Au moins une de ces permissions est nécessaire pour voir l'entrée. */
  anyOf?: Permission[];
  children?: { label: string; to: string; anyOf?: Permission[] }[];
  shortcut?: string;
}

/** Navigation (§10) — filtrée selon les permissions de l'utilisateur. */
export const NAV: NavItem[] = [
  { label: 'Tableau de bord', to: '/', icon: LayoutDashboard },
  { label: 'Caisse', to: '/pos', icon: ShoppingCart, anyOf: ['sales.create'], shortcut: 'F12' },
  {
    label: 'Ventes',
    to: '/sales',
    icon: Receipt,
    anyOf: ['sales.create', 'sales.view_all'],
    children: [
      { label: 'Historique', to: '/sales' },
      { label: 'Ventes en attente', to: '/sales/on-hold', anyOf: ['sales.hold'] },
    ],
  },
  {
    label: 'Retours & avoirs',
    to: '/returns',
    icon: RotateCcw,
    anyOf: ['returns.create', 'returns.approve'],
  },
  { label: 'Clients', to: '/clients', icon: Users, anyOf: ['clients.view'] },
  {
    label: 'Règlements',
    to: '/payments',
    icon: Wallet,
    anyOf: ['payments.create', 'payments.cancel'],
    children: [
      { label: 'Encaissements', to: '/payments' },
      { label: 'Chèques', to: '/payments/cheques' },
      { label: 'Balance âgée', to: '/payments/aging' },
    ],
  },
  {
    label: 'Stock',
    to: '/stock',
    icon: Boxes,
    anyOf: ['stock.view', 'stock.movements'],
    children: [
      { label: 'État du stock', to: '/stock', anyOf: ['stock.view'] },
      { label: 'Lots', to: '/stock/lots', anyOf: ['stock.view'] },
      { label: 'Péremptions', to: '/stock/expiries', anyOf: ['stock.view'] },
      { label: 'Fiche de mouvement', to: '/stock/movements', anyOf: ['stock.movements'] },
      { label: 'Rappel de lot', to: '/stock/recall', anyOf: ['lots.manage'] },
      { label: 'Stock à date', to: '/stock/at-date', anyOf: ['stock.view'] },
    ],
  },
  {
    label: 'Achats',
    to: '/receipts',
    icon: Truck,
    anyOf: ['receipts.create', 'suppliers.view', 'supplier_returns.manage'],
    children: [
      { label: 'Réceptions', to: '/receipts', anyOf: ['receipts.create'] },
      { label: 'Fournisseurs', to: '/suppliers', anyOf: ['suppliers.view'] },
      {
        label: 'Retours fournisseurs',
        to: '/supplier-returns',
        anyOf: ['supplier_returns.manage'],
      },
      { label: 'Réapprovisionnement', to: '/reorder', anyOf: ['receipts.create'] },
    ],
  },
  {
    label: 'Inventaire & ajustements',
    to: '/inventories',
    icon: ClipboardList,
    anyOf: ['inventory.count', 'inventory.manage', 'adjustments.create', 'adjustments.validate'],
    children: [
      { label: 'Inventaires', to: '/inventories', anyOf: ['inventory.count', 'inventory.manage'] },
      {
        label: 'Ajustements',
        to: '/adjustments',
        anyOf: ['adjustments.create', 'adjustments.validate'],
      },
    ],
  },
  {
    label: 'Catalogue',
    to: '/products',
    icon: Package,
    anyOf: ['catalog.view'],
    children: [
      { label: 'Produits', to: '/products' },
      { label: 'Catégories & laboratoires', to: '/catalog/references', anyOf: ['catalog.manage'] },
    ],
  },
  {
    label: 'Sessions de caisse',
    to: '/cash',
    icon: Coins,
    anyOf: ['cash.operate', 'cash.view_expected'],
  },
  { label: 'Statistiques & rapports', to: '/reports', icon: BarChart3, anyOf: ['reports.view'] },
  { label: 'Mouchard', to: '/audit', icon: ShieldAlert, anyOf: ['audit.view'] },
  {
    label: 'Administration',
    to: '/admin',
    icon: Settings,
    anyOf: [
      'admin.users',
      'admin.roles',
      'admin.devices',
      'admin.settings',
      'admin.backups',
      'email.configure',
      'email.view_log',
      'notifications.email.receive',
    ],
    children: [
      { label: 'Utilisateurs', to: '/admin/users', anyOf: ['admin.users'] },
      { label: 'Rôles et permissions', to: '/admin/roles', anyOf: ['admin.roles'] },
      { label: 'Postes de travail', to: '/admin/devices', anyOf: ['admin.devices'] },
      { label: 'Sessions actives', to: '/admin/sessions', anyOf: ['admin.users'] },
      { label: 'Paramètres', to: '/admin/settings', anyOf: ['admin.settings'] },
      { label: 'E-mail & notifications', to: '/admin/email', anyOf: ['email.configure'] },
      { label: 'Journal des e-mails', to: '/admin/email-log', anyOf: ['email.view_log'] },
      { label: 'Tâches planifiées', to: '/admin/jobs', anyOf: ['admin.settings'] },
      {
        label: 'Mes notifications',
        to: '/account/notifications',
        anyOf: ['notifications.email.receive'],
      },
      { label: 'Sauvegardes', to: '/admin/backups', anyOf: ['admin.backups'] },
    ],
  },
];

/** Routes réellement disponibles (les autres sont masquées tant qu'elles ne sont pas livrées). */
export const AVAILABLE_ROUTES = new Set<string>([
  '/',
  '/audit',
  '/admin/users',
  '/admin/roles',
  '/admin/devices',
  '/admin/sessions',
  '/admin/settings',
  '/products',
  '/catalog/references',
  '/suppliers',
  '/clients',
  '/receipts',
  '/stock',
  '/stock/lots',
  '/stock/expiries',
  '/stock/movements',
  '/stock/at-date',
  '/pos',
  '/sales',
  '/sales/on-hold',
  '/cash',
  '/admin/email',
  '/admin/email-log',
  '/returns',
  '/payments',
  '/payments/cheques',
  '/payments/aging',
  '/inventories',
  '/adjustments',
  '/supplier-returns',
  '/stock/recall',
  '/reorder',
  '/account/notifications',
  '/admin/jobs',
]);

export const ACTIVITY_ICON = Activity;
