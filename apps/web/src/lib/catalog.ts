import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { References, Supplier } from './types';

export function useReferences() {
  return useQuery({
    queryKey: ['catalog', 'references'],
    queryFn: () => api.get<References>('/catalog/references'),
    staleTime: 60_000,
  });
}

export function useSupplierOptions(enabled = true) {
  return useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () => api.get<Pick<Supplier, 'id' | 'code' | 'name'>[]>('/suppliers/options'),
    staleTime: 60_000,
    enabled,
  });
}
