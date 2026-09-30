import * as React from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { EmptyState } from '@/components/page';
import { Skeleton } from '@/components/ui/misc';
import { RequirePermission } from './guards';

/** Chargement à la demande d'une page (découpage du bundle par route). */
function lazyPage<K extends string>(
  load: () => Promise<Record<K, React.ComponentType<never>>>,
  name: K,
): React.ComponentType {
  const Page = React.lazy(async () => ({
    default: (await load())[name] as unknown as React.ComponentType,
  }));
  return function LazyPage() {
    return (
      <React.Suspense fallback={<Skeleton className="h-64" />}>
        <Page />
      </React.Suspense>
    );
  };
}

const AccountPage = lazyPage(() => import('@/pages/account/account-page'), 'AccountPage');
const DevicesPage = lazyPage(() => import('@/pages/admin/devices-page'), 'DevicesPage');
const RolesPage = lazyPage(() => import('@/pages/admin/roles-page'), 'RolesPage');
const SessionsPage = lazyPage(() => import('@/pages/admin/sessions-page'), 'SessionsPage');
const SettingsPage = lazyPage(() => import('@/pages/admin/settings-page'), 'SettingsPage');
const UsersPage = lazyPage(() => import('@/pages/admin/users-page'), 'UsersPage');
const AuditPage = lazyPage(() => import('@/pages/audit/audit-page'), 'AuditPage');
const ProductDetailPage = lazyPage(
  () => import('@/pages/catalog/product-detail-page'),
  'ProductDetailPage',
);
const ProductsPage = lazyPage(() => import('@/pages/catalog/products-page'), 'ProductsPage');
const ReferencesPage = lazyPage(() => import('@/pages/catalog/references-page'), 'ReferencesPage');
const ReceiptPage = lazyPage(() => import('@/pages/receipts/receipt-page'), 'ReceiptPage');
const ReceiptsPage = lazyPage(() => import('@/pages/receipts/receipts-page'), 'ReceiptsPage');
const MovementSheetPage = lazyPage(
  () => import('@/pages/stock/movement-sheet-page'),
  'MovementSheetPage',
);
const ExpiriesPage = lazyPage(() => import('@/pages/stock/stock-pages'), 'ExpiriesPage');
const LotsPage = lazyPage(() => import('@/pages/stock/stock-pages'), 'LotsPage');
const StockAtDatePage = lazyPage(() => import('@/pages/stock/stock-pages'), 'StockAtDatePage');
const StockStatePage = lazyPage(() => import('@/pages/stock/stock-pages'), 'StockStatePage');
const ClientDetailPage = lazyPage(
  () => import('@/pages/tiers/client-detail-page'),
  'ClientDetailPage',
);
const ClientsPage = lazyPage(() => import('@/pages/tiers/clients-page'), 'ClientsPage');
const SuppliersPage = lazyPage(() => import('@/pages/tiers/suppliers-page'), 'SuppliersPage');
const DashboardPage = lazyPage(() => import('@/pages/dashboard/dashboard-page'), 'DashboardPage');
const EmailLogPage = lazyPage(() => import('@/pages/admin/email-pages'), 'EmailLogPage');
const EmailSettingsPage = lazyPage(() => import('@/pages/admin/email-pages'), 'EmailSettingsPage');
const CashPage = lazyPage(() => import('@/pages/cash/cash-pages'), 'CashPage');
const CashSessionPage = lazyPage(() => import('@/pages/cash/cash-pages'), 'CashSessionPage');
const NotificationsPage = lazyPage(
  () => import('@/pages/notifications/notifications'),
  'NotificationsPage',
);
const PosPage = lazyPage(() => import('@/pages/sales/pos-page'), 'PosPage');
const OnHoldPage = lazyPage(() => import('@/pages/sales/sales-pages'), 'OnHoldPage');
const SaleDetailPage = lazyPage(() => import('@/pages/sales/sales-pages'), 'SaleDetailPage');
const SalesPage = lazyPage(() => import('@/pages/sales/sales-pages'), 'SalesPage');

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'account', element: <AccountPage /> },
      {
        path: 'audit',
        element: (
          <RequirePermission anyOf={['audit.view']}>
            <AuditPage />
          </RequirePermission>
        ),
      },
      {
        path: 'products',
        element: (
          <RequirePermission anyOf={['catalog.view']}>
            <ProductsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'products/:id',
        element: (
          <RequirePermission anyOf={['catalog.view']}>
            <ProductDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'catalog/references',
        element: (
          <RequirePermission anyOf={['catalog.manage']}>
            <ReferencesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'suppliers',
        element: (
          <RequirePermission anyOf={['suppliers.view']}>
            <SuppliersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'clients',
        element: (
          <RequirePermission anyOf={['clients.view']}>
            <ClientsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'clients/:id',
        element: (
          <RequirePermission anyOf={['clients.view']}>
            <ClientDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'receipts',
        element: (
          <RequirePermission anyOf={['receipts.create']}>
            <ReceiptsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'receipts/new',
        element: (
          <RequirePermission anyOf={['receipts.create']}>
            <ReceiptPage />
          </RequirePermission>
        ),
      },
      {
        path: 'receipts/:id',
        element: (
          <RequirePermission anyOf={['receipts.create']}>
            <ReceiptPage />
          </RequirePermission>
        ),
      },
      {
        path: 'stock',
        element: (
          <RequirePermission anyOf={['stock.view']}>
            <StockStatePage />
          </RequirePermission>
        ),
      },
      {
        path: 'stock/lots',
        element: (
          <RequirePermission anyOf={['stock.view']}>
            <LotsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'stock/expiries',
        element: (
          <RequirePermission anyOf={['stock.view']}>
            <ExpiriesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'stock/movements',
        element: (
          <RequirePermission anyOf={['stock.movements']}>
            <MovementSheetPage />
          </RequirePermission>
        ),
      },
      {
        path: 'stock/at-date',
        element: (
          <RequirePermission anyOf={['stock.view']}>
            <StockAtDatePage />
          </RequirePermission>
        ),
      },
      { path: 'notifications', element: <NotificationsPage /> },
      {
        path: 'pos',
        element: (
          <RequirePermission anyOf={['sales.create']}>
            <PosPage />
          </RequirePermission>
        ),
      },
      {
        path: 'sales',
        element: (
          <RequirePermission anyOf={['sales.create']}>
            <SalesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'sales/on-hold',
        element: (
          <RequirePermission anyOf={['sales.hold']}>
            <OnHoldPage />
          </RequirePermission>
        ),
      },
      {
        path: 'sales/:id',
        element: (
          <RequirePermission anyOf={['sales.create']}>
            <SaleDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'cash',
        element: (
          <RequirePermission anyOf={['cash.operate', 'cash.view_expected']}>
            <CashPage />
          </RequirePermission>
        ),
      },
      {
        path: 'cash/:id',
        element: (
          <RequirePermission anyOf={['cash.view_expected']}>
            <CashSessionPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/email',
        element: (
          <RequirePermission anyOf={['email.configure']}>
            <EmailSettingsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/email-log',
        element: (
          <RequirePermission anyOf={['email.view_log']}>
            <EmailLogPage />
          </RequirePermission>
        ),
      },
      { path: 'admin', element: <Navigate to="/admin/users" replace /> },
      {
        path: 'admin/users',
        element: (
          <RequirePermission anyOf={['admin.users']}>
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/roles',
        element: (
          <RequirePermission anyOf={['admin.roles']}>
            <RolesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/devices',
        element: (
          <RequirePermission anyOf={['admin.devices']}>
            <DevicesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/sessions',
        element: (
          <RequirePermission anyOf={['admin.users']}>
            <SessionsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/settings',
        element: (
          <RequirePermission anyOf={['admin.settings']}>
            <SettingsPage />
          </RequirePermission>
        ),
      },
      {
        path: '*',
        element: (
          <EmptyState
            title="Page introuvable"
            description="Cette page n’existe pas ou n’est pas encore disponible."
          />
        ),
      },
    ],
  },
]);
