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
