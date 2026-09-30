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
const ReturnsPage = lazyPage(() => import('@/pages/returns/returns-pages'), 'ReturnsPage');
const ReturnDetailPage = lazyPage(
  () => import('@/pages/returns/returns-pages'),
  'ReturnDetailPage',
);
const ReturnWizardPage = lazyPage(
  () => import('@/pages/returns/return-wizard'),
  'ReturnWizardPage',
);
const PaymentsPage = lazyPage(() => import('@/pages/payments/payments-pages'), 'PaymentsPage');
const PaymentDetailPage = lazyPage(
  () => import('@/pages/payments/payments-pages'),
  'PaymentDetailPage',
);
const ChequesPage = lazyPage(() => import('@/pages/payments/payments-pages'), 'ChequesPage');
const AgingPage = lazyPage(() => import('@/pages/payments/payments-pages'), 'AgingPage');
const NotificationsPage = lazyPage(
  () => import('@/pages/notifications/notifications'),
  'NotificationsPage',
);
const InventoriesPage = lazyPage(
  () => import('@/pages/stock-ops/inventory-pages'),
  'InventoriesPage',
);
const InventoryDetailPage = lazyPage(
  () => import('@/pages/stock-ops/inventory-pages'),
  'InventoryDetailPage',
);
const AdjustmentsPage = lazyPage(
  () => import('@/pages/stock-ops/adjustment-pages'),
  'AdjustmentsPage',
);
const AdjustmentDetailPage = lazyPage(
  () => import('@/pages/stock-ops/adjustment-pages'),
  'AdjustmentDetailPage',
);
const SupplierReturnsPage = lazyPage(
  () => import('@/pages/stock-ops/supplier-return-pages'),
  'SupplierReturnsPage',
);
const NewSupplierReturnPage = lazyPage(
  () => import('@/pages/stock-ops/supplier-return-pages'),
  'NewSupplierReturnPage',
);
const SupplierReturnDetailPage = lazyPage(
  () => import('@/pages/stock-ops/supplier-return-pages'),
  'SupplierReturnDetailPage',
);
const RecallPage = lazyPage(() => import('@/pages/stock-ops/recall-reorder-pages'), 'RecallPage');
const ReorderPage = lazyPage(() => import('@/pages/stock-ops/recall-reorder-pages'), 'ReorderPage');
const MyNotificationsPage = lazyPage(
  () => import('@/pages/notifications/my-notifications-page'),
  'MyNotificationsPage',
);
const JobsPage = lazyPage(() => import('@/pages/admin/jobs-page'), 'JobsPage');
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
      {
        path: 'returns',
        element: (
          <RequirePermission anyOf={['returns.create']}>
            <ReturnsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'returns/new',
        element: (
          <RequirePermission anyOf={['returns.create']}>
            <ReturnWizardPage />
          </RequirePermission>
        ),
      },
      {
        path: 'returns/:id',
        element: (
          <RequirePermission anyOf={['returns.create']}>
            <ReturnDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'payments',
        element: (
          <RequirePermission anyOf={['payments.create']}>
            <PaymentsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'payments/cheques',
        element: (
          <RequirePermission anyOf={['payments.create']}>
            <ChequesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'payments/aging',
        element: (
          <RequirePermission anyOf={['payments.create']}>
            <AgingPage />
          </RequirePermission>
        ),
      },
      {
        path: 'payments/:id',
        element: (
          <RequirePermission anyOf={['payments.create']}>
            <PaymentDetailPage />
          </RequirePermission>
        ),
      },
      { path: 'notifications', element: <NotificationsPage /> },
      {
        path: 'inventories',
        element: (
          <RequirePermission anyOf={['inventory.count', 'inventory.manage']}>
            <InventoriesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'inventories/:id',
        element: (
          <RequirePermission anyOf={['inventory.count', 'inventory.manage']}>
            <InventoryDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'adjustments',
        element: (
          <RequirePermission anyOf={['adjustments.create', 'adjustments.validate']}>
            <AdjustmentsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'adjustments/:id',
        element: (
          <RequirePermission anyOf={['adjustments.create', 'adjustments.validate']}>
            <AdjustmentDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'supplier-returns',
        element: (
          <RequirePermission anyOf={['supplier_returns.manage']}>
            <SupplierReturnsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'supplier-returns/new',
        element: (
          <RequirePermission anyOf={['supplier_returns.manage']}>
            <NewSupplierReturnPage />
          </RequirePermission>
        ),
      },
      {
        path: 'supplier-returns/:id',
        element: (
          <RequirePermission anyOf={['supplier_returns.manage']}>
            <SupplierReturnDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'stock/recall',
        element: (
          <RequirePermission anyOf={['lots.manage']}>
            <RecallPage />
          </RequirePermission>
        ),
      },
      {
        path: 'reorder',
        element: (
          <RequirePermission anyOf={['receipts.create']}>
            <ReorderPage />
          </RequirePermission>
        ),
      },
      {
        path: 'account/notifications',
        element: (
          <RequirePermission anyOf={['notifications.email.receive']}>
            <MyNotificationsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/jobs',
        element: (
          <RequirePermission anyOf={['admin.settings']}>
            <JobsPage />
          </RequirePermission>
        ),
      },
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
