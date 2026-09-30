import { CLIENT_TYPES, type Paginated } from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { MailCheck, Plus } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import type { Client } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ClientFormDialog } from './client-form';

export function ClientsPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const state = useTableState({ sort: 'name:asc' });
  const [creating, setCreating] = React.useState(false);
  const filters = {
    active: state.filter('active') || 'true',
    type: state.filter('type'),
    balance: state.filter('balance'),
  };
  const list = useQuery({
    queryKey: ['clients', state.page, state.pageSize, state.q, state.sort, filters],
    queryFn: () =>
      api.get<Paginated<Client>>('/clients', {
        query: {
          page: state.page,
          pageSize: state.pageSize,
          q: state.q,
          sort: state.sort,
          ...filters,
        },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<Client>[] = [
    {
      accessorKey: 'code',
      header: 'Code',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      accessorKey: 'name',
      header: 'Client',
      cell: ({ row }) => (
        <div>
          <div className="flex items-center gap-1.5 font-medium">
            {row.original.name}
            {row.original.emailConsent && (
              <MailCheck className="size-3.5 text-emerald-600" aria-label="Documents par e-mail" />
            )}
            {!row.original.isActive && <Badge variant="gray">Inactif</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            {CLIENT_TYPES[row.original.type as keyof typeof CLIENT_TYPES]}
          </div>
        </div>
      ),
    },
    { id: 'phone', header: 'Téléphone', cell: ({ row }) => row.original.phone ?? '—' },
    {
      id: 'id',
      header: 'CIN / MF',
      meta: { label: 'CIN / matricule' },
      cell: ({ row }) => row.original.nationalIdOrTaxId ?? '—',
    },
    {
      id: 'limit',
      header: 'Plafond',
      meta: { align: 'right' },
      cell: ({ row }) => (row.original.creditLimit > 0 ? fmt.money(row.original.creditLimit) : '—'),
    },
    {
      accessorKey: 'balance',
      header: 'Solde',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const b = row.original.balance;
        if (b === 0) return <span className="text-muted-foreground">0</span>;
        return (
          <span
            className={cn(
              'font-medium',
              b > 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {b > 0 ? fmt.money(b) : `Crédit ${fmt.money(-b)}`}
          </span>
        );
      },
    },
  ];
  return (
    <>
      <PageHeader
        title="Clients"
        description="Solde positif : le client doit ; solde négatif : crédit (avoir) disponible."
        actions={
          can('clients.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nouveau client
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="Nom, code, téléphone, CIN / matricule…"
        onRowClick={(c) => void navigate(`/clients/${c.id}`)}
        toolbar={
          <>
            <NativeSelect
              className="w-40"
              value={filters.type}
              onChange={(e) => state.update({ type: e.target.value })}
              aria-label="Type"
            >
              <option value="">Tous types</option>
              {Object.entries(CLIENT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-40"
              value={filters.balance}
              onChange={(e) => state.update({ balance: e.target.value })}
              aria-label="Solde"
            >
              <option value="">Tous soldes</option>
              <option value="debt">Débiteurs</option>
              <option value="credit">Avec crédit</option>
            </NativeSelect>
            <NativeSelect
              className="w-32"
              value={filters.active}
              onChange={(e) => state.update({ active: e.target.value })}
              aria-label="Statut"
            >
              <option value="true">Actifs</option>
              <option value="false">Inactifs</option>
              <option value="all">Tous</option>
            </NativeSelect>
          </>
        }
      />
      <ClientFormDialog
        client={null}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(c) => void navigate(`/clients/${c.id}`)}
      />
    </>
  );
}
