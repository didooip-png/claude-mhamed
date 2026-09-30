import { defaultSettings, type SettingsMap } from '@pharmastock/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

/** Paramètres publics (affichage, règles de caisse). */
export function useSettings(): SettingsMap {
  const { data } = useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api.get<Partial<SettingsMap>>('/settings/public'),
    staleTime: 60_000,
  });
  return { ...defaultSettings(), ...(data ?? {}) } as SettingsMap;
}
