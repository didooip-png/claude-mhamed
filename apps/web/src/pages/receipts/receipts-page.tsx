import { SUPPLY_SOURCES, type Paginated } from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useSupplierOptions } from '@/lib/catalog';
import { useFormat } from '@/lib/format';

interface ReceiptRow {
  id: string;
  number: string | null;
  status: 'DRAFT' | 'VALIDATED' | 'CANCELLED';
  sourceType: keyof typeof SUPPLY_SOURCES;
  supplier: { id: string; name: string } | null;
  supplierInvoiceRef: string | null;
  receivedAt: string;
  totalTtc: number;
  createdAt: string;
  validatedAt: string | null;
  createdByCode: string | null;
  validatedByCode: string | null;
  _count: { lines: number };
}

const STATUS = {
  DRAFT: <Badge variant="yellow">Brouillon</Badge>,
  VALIDATED: <Badge variant="green">Validée</Badge>,
  CANCELLED: <Badge variant="red">Annulée</Badge>,
};

export function ReceiptsPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const state = useTableState();
  const suppliers = useSupplierOptions();
  const filters = {
    status: state.filter('status'),
    supplierId: state.filter('supplierId'),
    from: state.filter('from'),
    to: state.filter('to'),
  };
  const list = useQuery({
    queryKey: ['receipts', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<ReceiptRow>>('/receipts', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<ReceiptRow>[] = [
    {
      id: 'number',
      header: 'N°',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number ?? '—'}</span>,
    },
    { id: 'status', header: 'Statut', cell: ({ row }) => STATUS[row.original.status] },
    {
      id: 'date',
      header: 'Réception',
      cell: ({ row }) => (
        <span className="tabular">{fmt.isoDate(row.original.receivedAt.slice(0, 10))}</span>
      ),
    },
    {
      id: 'source',
      header: 'Source / fournisseur',
      cell: ({ row }) => row.original.supplier?.name ?? SUPPLY_SOURCES[row.original.sourceType],
    },
    {
      id: 'ref',
      header: 'Réf. facture',
      cell: ({ row }) => row.original.supplierInvoiceRef ?? '—',
    },
    {
      id: 'lines',
      header: 'Lignes',
      meta: { align: 'right' },
      cell: ({ row }) => row.original._count.lines,
    },
    {
      id: 'total',
      header: 'Total TTC',
      meta: { align: 'right' },
      cell: ({ row }) => fmt.money(row.original.totalTtc),
    },
    {
      id: 'by',
      header: 'Saisie / validée par',
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.createdByCode}
          {row.original.validatedByCode ? ` / ${row.original.validatedByCode}` : ''}
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Réceptions"
        description="Entrées en stock (bons de réception). Les brouillons n’ont pas de numéro ; le numéro est attribué à la validation."
        actions={
          can('receipts.create') && (
            <Button asChild>
              <Link to="/receipts/new">
                <Plus /> Nouvelle réception
              </Link>
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
        searchPlaceholder="N°, réf. facture, fournisseur…"
        onRowClick={(r) => void navigate(`/receipts/${r.id}`)}
        toolbar={
          <>
            <NativeSelect
              className="w-36"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous statuts</option>
              <option value="DRAFT">Brouillons</option>
              <option value="VALIDATED">Validées</option>
              <option value="CANCELLED">Annulées</option>
            </NativeSelect>
            <NativeSelect
              className="w-48"
              value={filters.supplierId}
              onChange={(e) => state.update({ supplierId: e.target.value })}
              aria-label="Fournisseur"
            >
              <option value="">Tous fournisseurs</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            <Input
              type="date"
              className="w-40"
              value={filters.from}
              onChange={(e) => state.update({ from: e.target.value })}
              aria-label="Du"
            />
            <Input
              type="date"
              className="w-40"
              value={filters.to}
              onChange={(e) => state.update({ to: e.target.value })}
              aria-label="Au"
            />
          </>
        }
      />
    </>
  );
}
