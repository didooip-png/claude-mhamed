import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { EmptyState } from '@/components/page';
import { AccountPage } from '@/pages/account/account-page';
import { DevicesPage } from '@/pages/admin/devices-page';
import { RolesPage } from '@/pages/admin/roles-page';
import { SessionsPage } from '@/pages/admin/sessions-page';
import { SettingsPage } from '@/pages/admin/settings-page';
import { UsersPage } from '@/pages/admin/users-page';
import { AuditPage } from '@/pages/audit/audit-page';
import { ProductDetailPage } from '@/pages/catalog/product-detail-page';
import { ProductsPage } from '@/pages/catalog/products-page';
import { ReferencesPage } from '@/pages/catalog/references-page';
import { ReceiptPage } from '@/pages/receipts/receipt-page';
import { ReceiptsPage } from '@/pages/receipts/receipts-page';
import { MovementSheetPage } from '@/pages/stock/movement-sheet-page';
import { ExpiriesPage, LotsPage, StockAtDatePage, StockStatePage } from '@/pages/stock/stock-pages';
import { ClientDetailPage } from '@/pages/tiers/client-detail-page';
import { ClientsPage } from '@/pages/tiers/clients-page';
import { SuppliersPage } from '@/pages/tiers/suppliers-page';
import { DashboardPage } from '@/pages/dashboard/dashboard-page';
import { RequirePermission } from './guards';

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
