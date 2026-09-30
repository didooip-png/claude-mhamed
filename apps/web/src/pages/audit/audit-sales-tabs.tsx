import type { Paginated } from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { EmptyState, ErrorState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';

interface UserRef {
  id: string;
  code: string;
  fullName: string;
}

interface CancelledRow {
  id: string;
  number: string;
  validatedAt: string;
  cancelledAt: string;
  reason: string | null;
  totalTtc: number;
  client: { id: string; code: string; name: string } | null;
  soldBy: UserRef | null;
  cancelledBy: UserRef | null;
  authorizedBy: UserRef | null;
  replacedBy: { id: string; number: string; totalTtc: number } | null;
  lines: { product: string; qty: number; unit: string; total: number }[];
}

interface IndicatorRow {
  user: UserRef;
  salesCount: number;
  salesTotal: number;
  cancellationsDone: number;
  modificationsDone: number;
  ownSalesCancelled: number;
  ownSalesCancelledAmount: number;
  lineRemovals: number;
  draftsDiscarded: number;
  discountsOverLimit: number;
  priceOverrides: number;
  reprints: number;
  drawerOpenings: number;
}

function PeriodFilters({ state }: { state: ReturnType<typeof useTableState> }) {
  return (
    <>
      <Input
        type="date"
        className="w-40"
        value={state.filter('from')}
        onChange={(e) => state.update({ from: e.target.value })}
        aria-label="Du"
      />
      <Input
        type="date"
        className="w-40"
        value={state.filter('to')}
        onChange={(e) => state.update({ to: e.target.value })}
        aria-label="Au"
      />
    </>
  );
}

/** Onglet « Ventes annulées » (§6.16) : total annulé sur la période. */
export function CancelledSalesTab() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const filters = {
    from: state.filter('from'),
    to: state.filter('to'),
    userId: state.filter('userId'),
  };
  const list = useQuery({
    queryKey: ['sales', 'cancelled', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<CancelledRow> & { totalCancelled: number }>('/sales/cancelled', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<CancelledRow>[] = [
    {
      id: 'date',
      header: 'Annulée le',
      cell: ({ row }) => (
        <span className="tabular whitespace-nowrap">{fmt.dateTime(row.original.cancelledAt)}</span>
      ),
    },
    {
      id: 'number',
      header: 'N° facture',
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-xs">{row.original.number}</span>
          {row.original.replacedBy && (
            <div className="text-[11px] text-muted-foreground">
              modifiée →{' '}
              <Link
                to={`/sales/${row.original.replacedBy.id}`}
                className="text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {row.original.replacedBy.number}
              </Link>
            </div>
          )}
        </div>
      ),
    },
    { id: 'client', header: 'Client', cell: ({ row }) => row.original.client?.name ?? '—' },
    {
      id: 'amount',
      header: 'Montant',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.totalTtc)}</span>,
    },
    {
      id: 'lines',
      header: 'Lignes',
      cell: ({ row }) => (
        <ul className="max-w-72 text-xs">
          {row.original.lines.slice(0, 4).map((l, i) => (
            <li key={i} className="truncate">
              {l.qty}
              {l.unit === 'UNIT' ? ' u' : ''} × {l.product}
            </li>
          ))}
          {row.original.lines.length > 4 && (
            <li className="text-muted-foreground">+ {row.original.lines.length - 4} ligne(s)</li>
          )}
        </ul>
      ),
    },
    {
      id: 'reason',
      header: 'Motif',
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-60 text-xs">{row.original.reason}</span>
      ),
    },
    {
      id: 'soldBy',
      header: 'Vendue par',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.soldBy?.code}</span>,
    },
    {
      id: 'cancelledBy',
      header: 'Annulée par',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.cancelledBy?.code}</span>
      ),
    },
    {
      id: 'authorizedBy',
      header: 'Autorisée par',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.authorizedBy?.code ?? '—'}</span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={list.data}
      isLoading={list.isLoading}
      error={list.error}
      onRetry={() => void list.refetch()}
      state={state}
      searchPlaceholder="N° de facture, client…"
      onRowClick={(r) => void navigate(`/sales/${r.id}`)}
      toolbar={<PeriodFilters state={state} />}
      footer={
        list.data && (
          <TR>
            <TD colSpan={columns.length} className="text-right text-sm">
              {list.data.total} vente(s) annulée(s) sur la période — total annulé :{' '}
              <strong className="tabular">{fmt.money(list.data.totalCancelled)}</strong>
            </TD>
          </TR>
        )
      }
      emptyTitle="Aucune vente annulée sur la période"
    />
  );
}

/** Indicateurs par utilisateur (§6.16) : annulations, retraits de lignes… sur la période. */
export function IndicatorsTab() {
  const fmt = useFormat();
  const state = useTableState();
  const filters = { from: state.filter('from'), to: state.filter('to') };
  const data = useQuery({
    queryKey: ['sales', 'indicators', filters],
    queryFn: () => api.get<IndicatorRow[]>('/sales/indicators', { query: filters }),
  });
  const cell = (v: number, warn = 1) => (
    <span
      className={cn(
        'tabular',
        v >= warn && v > 0 && 'font-semibold text-amber-700 dark:text-amber-400',
      )}
    >
      {v || '—'}
    </span>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <PeriodFilters state={state} />
        {!filters.from && !filters.to && <Badge variant="gray">Toute la période</Badge>}
      </div>
      {data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : !data.data ? (
        <Skeleton className="h-40" />
      ) : data.data.length === 0 ? (
        <EmptyState title="Aucune activité sur la période" />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Utilisateur</TH>
                <TH className="text-right">Ventes</TH>
                <TH className="text-right">Montant vendu</TH>
                <TH className="text-right">Ses ventes annulées</TH>
                <TH className="text-right">Annulations faites</TH>
                <TH className="text-right">Modifications faites</TH>
                <TH className="text-right">Lignes retirées</TH>
                <TH className="text-right">Paniers abandonnés</TH>
                <TH className="text-right">Remises hors plafond</TH>
                <TH className="text-right">Prix modifiés</TH>
                <TH className="text-right">Réimpressions</TH>
                <TH className="text-right">Tiroir sans vente</TH>
              </TR>
            </THead>
            <TBody>
              {data.data.map((r) => (
                <TR key={r.user.id}>
                  <TD className="whitespace-nowrap">
                    <Link
                      to={`/audit?userId=${r.user.id}${filters.from ? `&from=${filters.from}` : ''}${filters.to ? `&to=${filters.to}` : ''}`}
                      className="hover:underline"
                    >
                      <span className="font-mono">{r.user.code}</span> — {r.user.fullName}
                    </Link>
                  </TD>
                  <TD className="text-right tabular">{r.salesCount}</TD>
                  <TD className="text-right tabular">{fmt.money(r.salesTotal)}</TD>
                  <TD className="text-right">
                    {cell(r.ownSalesCancelled)}
                    {r.ownSalesCancelledAmount > 0 && (
                      <div className="text-[11px] text-muted-foreground tabular">
                        {fmt.money(r.ownSalesCancelledAmount)}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right">{cell(r.cancellationsDone)}</TD>
                  <TD className="text-right">{cell(r.modificationsDone)}</TD>
                  <TD className="text-right">{cell(r.lineRemovals, 5)}</TD>
                  <TD className="text-right">{cell(r.draftsDiscarded, 3)}</TD>
                  <TD className="text-right">{cell(r.discountsOverLimit)}</TD>
                  <TD className="text-right">{cell(r.priceOverrides)}</TD>
                  <TD className="text-right">{cell(r.reprints, 3)}</TD>
                  <TD className="text-right">{cell(r.drawerOpenings)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
