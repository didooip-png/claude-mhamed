import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';
import { LockScreen } from '@/components/layout/app-shell';
import { TooltipProvider } from '@/components/ui/misc';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queries';
import { ThemeProvider, useTheme } from '@/lib/theme';
import {
  BootScreen,
  ForcedPasswordChangePage,
  LoginPage,
  RegisterDevicePage,
} from '@/pages/auth/auth-pages';
import { router } from './router';

function Root() {
  const { state } = useAuth();
  const userId = state.status === 'authenticated' ? state.user.id : null;
  const previousUser = useRef<string | null>(null);
  useEffect(() => {
    // Changement d'utilisateur sur le poste : retour au tableau de bord du nouvel utilisateur.
    if (userId && previousUser.current && previousUser.current !== userId)
      void router.navigate('/');
    if (userId) previousUser.current = userId;
  }, [userId]);
  switch (state.status) {
    case 'booting':
      return <BootScreen />;
    case 'needsDevice':
      return <RegisterDevicePage />;
    case 'anonymous':
      return <LoginPage devicePending={state.devicePending} deviceName={state.deviceName} />;
    case 'locked':
      return <LockScreen />;
    case 'authenticated':
      return state.user.mustChangePassword ? (
        <ForcedPasswordChangePage user={state.user} />
      ) : (
        <RouterProvider router={router} />
      );
  }
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster richColors closeButton position="bottom-right" theme={theme} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Root />
          </AuthProvider>
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
