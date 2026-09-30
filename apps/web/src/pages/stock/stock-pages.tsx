import {
  addDaysIso,
  formatStockQty,
  STOCK_MOVEMENT_TYPES,
  todayIso,
  type Paginated,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField } from '@/components/form';
import { PageHeader } from '@/components/page';
import { ExpiryBadge, LotStatusBadge, Qty, StockStatusBadge } from '@/components/stock-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useReferences, useSupplierOptions } from '@/lib/catalog';
import { useFormat } from '@/lib/format';
import type { LotRow } from '@/lib/types';

interface StateRow {
  id: string;
  internalCode: string;
  name: string;
  dosage: string | null;
  form: string | null;
  location: string | null;
  category: string;
  laboratory: string | null;
  minStock: number;
  unitsPerPack: number;
  sellByUnit: boolean;
  total: number;
  sellable: number;
  unavailable: number;
  lotCount: number;
  nextExpiry: string | null;
  valueCost: number | null;
  valueSale: number;
  status: 'OK' | 'LOW' | 'OUT';
}

type WithTotals<T, K> = Paginated<T> & { totals: K };

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'red' | 'yellow';
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={
            tone === 'red'
              ? 'text-lg font-semibold text-destructive'
              : tone === 'yellow'
                ? 'text-lg font-semibold text-warning'
                : 'text-lg font-semibold'
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

/** État du stock par produit (§6.4). */
export function StockStatePage() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState({ sort: 'name:asc' });
  const refs = useReferences();
  const filters = {
    categoryId: state.filter('categoryId'),
    laboratoryId: state.filter('laboratoryId'),
    status: state.filter('status'),
    onlyWithStock: state.filter('onlyWithStock'),
  };
  const list = useQuery({
    queryKey: ['stock', 'state', state.page, state.pageSize, state.q, state.sort, filters],
    queryFn: () =>
      api.get<
        WithTotals<
          StateRow,
          { valueCost: number | null; valueSale: number; outOfStock: number; low: number }
        >
      >('/stock/state', {
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
  const t = list.data?.totals;
  const columns: Column<StateRow>[] = [
    {
      accessorKey: 'name',
      header: 'Produit',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            {row.original.name}{' '}
            <span className="text-xs font-normal text-muted-foreground">{row.original.dosage}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {row.original.internalCode} · {row.original.category}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'location',
      header: 'Emplacement',
      cell: ({ row }) => row.original.location ?? '—',
    },
    {
      accessorKey: 'total',
      header: 'Stock total',
      meta: { align: 'right' },
      cell: ({ row }) => <Qty value={row.original.total} product={row.original} />,
    },
    {
      accessorKey: 'sellable',
      header: 'Vendable',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <strong>
          <Qty value={row.original.sellable} product={row.original} />
        </strong>
      ),
    },
    {
      id: 'unavailable',
      header: 'Bloqué / périmé',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.unavailable ? (
          <span className="text-destructive">
            <Qty value={row.original.unavailable} product={row.original} />
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'lots',
      header: 'Lots',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.lotCount,
    },
    {
      accessorKey: 'nextExpiry',
      header: 'Prochaine péremption',
      cell: ({ row }) =>
        row.original.nextExpiry ? <ExpiryBadge date={row.original.nextExpiry} level="OK" /> : '—',
    },
    ...(t?.valueCost !== null && t !== undefined
      ? [
          {
            accessorKey: 'valueCost',
            header: 'Valeur au coût',
            meta: { align: 'right' as const },
            cell: ({ row }: { row: { original: StateRow } }) => fmt.money(row.original.valueCost),
          },
        ]
      : []),
    {
      id: 'status',
      header: 'État',
      cell: ({ row }) => <StockStatusBadge status={row.original.status} />,
    },
  ];
  return (
    <>
      <PageHeader
        title="État du stock"
        description="Stock vendable = lots actifs non périmés. Les lots bloqués, en quarantaine ou périmés ne sont jamais vendus."
      />
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t?.valueCost !== null && (
          <Kpi label="Valeur du stock (coût d’achat réel)" value={fmt.money(t?.valueCost ?? 0)} />
        )}
        <Kpi label="Valeur au prix de vente (vendable)" value={fmt.money(t?.valueSale ?? 0)} />
        <Kpi label="Produits en rupture" value={t?.outOfStock ?? 0} tone="red" />
        <Kpi label="Produits sous le seuil" value={t?.low ?? 0} tone="yellow" />
      </div>
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="Produit, DCI, code, code-barres…"
        onRowClick={(r) => void navigate(`/products/${r.id}`)}
        rowClassName={(r) => (r.status === 'OUT' ? 'bg-red-50/40 dark:bg-red-950/20' : undefined)}
        toolbar={
          <>
            <NativeSelect
              className="w-44"
              value={filters.categoryId}
              onChange={(e) => state.update({ categoryId: e.target.value })}
              aria-label="Catégorie"
            >
              <option value="">Toutes catégories</option>
              {refs.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-44"
              value={filters.laboratoryId}
              onChange={(e) => state.update({ laboratoryId: e.target.value })}
              aria-label="Laboratoire"
            >
              <option value="">Tous laboratoires</option>
              {refs.data?.laboratories.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-40"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="État"
            >
              <option value="">Tous états</option>
              <option value="OUT">Rupture</option>
              <option value="LOW">Sous le seuil</option>
              <option value="OK">OK</option>
            </NativeSelect>
            <NativeSelect
              className="w-40"
              value={filters.onlyWithStock}
              onChange={(e) => state.update({ onlyWithStock: e.target.value })}
              aria-label="Stock"
            >
              <option value="">Tous produits</option>
              <option value="1">Avec stock</option>
            </NativeSelect>
          </>
        }
      />
    </>
  );
}

/** Tous les lots, avec code couleur de péremption (§6.4). */
export function LotsPage() {
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const state = useTableState({ sort: 'expiryDate:asc' });
  const suppliers = useSupplierOptions();
  const [action, setAction] = React.useState<{ lot: LotRow; block: boolean } | null>(null);
  const [reason, setReason] = React.useState('');
  const filters = {
    status: state.filter('status'),
    level: state.filter('level'),
    supplierId: state.filter('supplierId'),
    withStock: state.filter('withStock') || '1',
  };
  const list = useQuery({
    queryKey: ['stock', 'lots', state.page, state.pageSize, state.q, state.sort, filters],
    queryFn: () =>
      api.get<WithTotals<LotRow, { valueCost: number | null }>>('/stock/lots', {
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
  const mutate = useMutation({
    mutationFn: () =>
      api.post(`/stock/lots/${action!.lot.id}/${action!.block ? 'block' : 'unblock'}`, { reason }),
    onSuccess: () => {
      toast.success(action!.block ? 'Lot bloqué : il ne peut plus être vendu' : 'Lot débloqué');
      setAction(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const columns: Column<LotRow>[] = [
    {
      accessorKey: 'product',
      header: 'Produit',
      cell: ({ row }) => (
        <Link
          to={`/products/${row.original.product.id}`}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.product.name}{' '}
          <span className="text-xs font-normal text-muted-foreground">
            {row.original.product.dosage}
          </span>
        </Link>
      ),
    },
    {
      accessorKey: 'lotNumber',
      header: 'Lot',
      cell: ({ row }) => <span className="font-mono">{row.original.lotNumber}</span>,
    },
    {
      accessorKey: 'expiryDate',
      header: 'Péremption',
      cell: ({ row }) => (
        <ExpiryBadge
          date={row.original.expiryDate}
          level={row.original.level}
          days={row.original.daysToExpiry}
        />
      ),
    },
    {
      accessorKey: 'receivedAt',
      header: 'Reçu le',
      cell: ({ row }) => <span className="tabular">{fmt.date(row.original.receivedAt)}</span>,
    },
    {
      accessorKey: 'remainingQty',
      header: 'Restant',
      meta: { align: 'right' },
      cell: ({ row }) => <Qty value={row.original.remainingQty} product={row.original.product} />,
    },
    ...(list.data?.totals.valueCost !== null
      ? [
          {
            id: 'value',
            header: 'Valeur',
            meta: { align: 'right' as const },
            cell: ({ row }: { row: { original: LotRow } }) => fmt.money(row.original.valueCost),
          },
        ]
      : []),
    { id: 'supplier', header: 'Fournisseur', cell: ({ row }) => row.original.supplierName ?? '—' },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => (
        <span title={row.original.blockReason ?? undefined}>
          <LotStatusBadge status={row.original.status} />
        </span>
      ),
    },
    ...(can('lots.manage')
      ? [
          {
            id: 'actions',
            header: '',
            meta: { align: 'right' as const },
            cell: ({ row }: { row: { original: LotRow } }) =>
              row.original.status === 'BLOCKED' || row.original.status === 'QUARANTINE' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAction({ lot: row.original, block: false })}
                >
                  <LockOpen /> Débloquer
                </Button>
              ) : row.original.remainingQty > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAction({ lot: row.original, block: true })}
                >
                  <Lock /> Bloquer
                </Button>
              ) : null,
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        title="Lots"
        description="Rouge : périmé · orange : moins de 30 jours · jaune : moins de 90 jours · vert : OK (seuils paramétrables)."
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="Produit ou n° de lot…"
        dense
        toolbar={
          <>
            <NativeSelect
              className="w-40"
              value={filters.level}
              onChange={(e) => state.update({ level: e.target.value })}
              aria-label="Péremption"
            >
              <option value="">Toutes péremptions</option>
              <option value="EXPIRED">Périmés</option>
              <option value="CRITICAL">Moins de 30 j</option>
              <option value="WARNING">Moins de 90 j</option>
              <option value="OK">OK</option>
            </NativeSelect>
            <NativeSelect
              className="w-36"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous statuts</option>
              <option value="ACTIVE">Actifs</option>
              <option value="BLOCKED">Bloqués</option>
              <option value="QUARANTINE">Quarantaine</option>
              <option value="EXHAUSTED">Épuisés</option>
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
            <NativeSelect
              className="w-36"
              value={filters.withStock}
              onChange={(e) => state.update({ withStock: e.target.value })}
              aria-label="Stock"
            >
              <option value="1">En stock</option>
              <option value="0">Tous les lots</option>
            </NativeSelect>
          </>
        }
      />
      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {action?.block ? 'Bloquer le lot' : 'Débloquer le lot'} {action?.lot.lotNumber}
            </DialogTitle>
            <DialogDescription>
              {action?.lot.product.name} —{' '}
              {action &&
                formatStockQty(
                  action.lot.remainingQty,
                  action.lot.product.unitsPerPack,
                  action.lot.product.sellByUnit,
                )}{' '}
              en stock. Action tracée au mouchard.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Motif" required>
            <Textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action?.block ? 'Rappel, doute qualité…' : 'Contrôle conforme…'}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Annuler
            </Button>
            <Button
              variant={action?.block ? 'destructive' : 'default'}
              onClick={() => mutate.mutate()}
              loading={mutate.isPending}
              disabled={reason.trim().length < 3}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ExpiryRow {
  id: string;
  lotNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  level: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK';
  remainingQty: number;
  valueCost: number | null;
  status: string;
  supplier: { id: string; name: string } | null;
  product: {
    id: string;
    internalCode: string;
    name: string;
    dosage: string | null;
    location: string | null;
    unitsPerPack: number;
    sellByUnit: boolean;
  };
}

/** Lots à échéance dans les N prochains jours (et périmés encore en stock). */
export function ExpiriesPage() {
  const fmt = useFormat();
  const state = useTableState();
  const days = Number(state.filter('days') || '90');
  const list = useQuery({
    queryKey: ['stock', 'expiries', days, state.page, state.pageSize, state.q],
    queryFn: () =>
      api.get<
        WithTotals<
          ExpiryRow,
          { valueCost: number | null; expiredValueCost: number | null; expiredCount: number }
        >
      >('/stock/expiries', {
        query: { days, page: state.page, pageSize: state.pageSize, q: state.q },
      }),
    placeholderData: (prev) => prev,
  });
  const t = list.data?.totals;
  const columns: Column<ExpiryRow>[] = [
    {
      id: 'expiry',
      header: 'Péremption',
      cell: ({ row }) => (
        <ExpiryBadge
          date={row.original.expiryDate}
          level={row.original.level}
          days={row.original.daysToExpiry}
        />
      ),
    },
    {
      id: 'days',
      header: 'Délai',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.daysToExpiry <= 0 ? (
          <span className="font-medium text-destructive">Périmé</span>
        ) : (
          `${row.original.daysToExpiry} j`
        ),
    },
    {
      id: 'product',
      header: 'Produit',
      cell: ({ row }) => (
        <Link to={`/products/${row.original.product.id}`} className="font-medium hover:underline">
          {row.original.product.name}{' '}
          <span className="text-xs font-normal text-muted-foreground">
            {row.original.product.dosage}
          </span>
        </Link>
      ),
    },
    {
      id: 'lot',
      header: 'Lot',
      cell: ({ row }) => <span className="font-mono">{row.original.lotNumber}</span>,
    },
    {
      id: 'qty',
      header: 'Quantité',
      meta: { align: 'right' },
      cell: ({ row }) => <Qty value={row.original.remainingQty} product={row.original.product} />,
    },
    ...(t?.valueCost !== null
      ? [
          {
            id: 'value',
            header: 'Valeur',
            meta: { align: 'right' as const },
            cell: ({ row }: { row: { original: ExpiryRow } }) => fmt.money(row.original.valueCost),
          },
        ]
      : []),
    {
      id: 'location',
      header: 'Emplacement',
      cell: ({ row }) => row.original.product.location ?? '—',
    },
    {
      id: 'supplier',
      header: 'Fournisseur',
      cell: ({ row }) => row.original.supplier?.name ?? '—',
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => <LotStatusBadge status={row.original.status} />,
    },
  ];
  return (
    <>
      <PageHeader
        title="Péremptions"
        description="Lots à retirer ou à écouler en priorité. La destruction et le retour fournisseur se déclarent depuis les ajustements et les retours fournisseurs."
      />
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Kpi label="Lots périmés encore en stock" value={t?.expiredCount ?? 0} tone="red" />
        {t?.expiredValueCost !== null && (
          <Kpi
            label="Valeur des lots périmés"
            value={fmt.money(t?.expiredValueCost ?? 0)}
            tone="red"
          />
        )}
        {t?.valueCost !== null && (
          <Kpi label={`Valeur concernée (${days} jours)`} value={fmt.money(t?.valueCost ?? 0)} />
        )}
      </div>
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="Produit ou n° de lot…"
        dense
        emptyTitle="Aucun lot à échéance sur la période"
        toolbar={
          <NativeSelect
            className="w-44"
            value={days}
            onChange={(e) => state.update({ days: e.target.value })}
            aria-label="Horizon"
          >
            {[30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} prochains jours
              </option>
            ))}
          </NativeSelect>
        }
      />
    </>
  );
}

/** Stock reconstitué à une date passée. */
export function StockAtDatePage() {
  const fmt = useFormat();
  const state = useTableState();
  const date = state.filter('date') || addDaysIso(todayIso(fmt.tz), -1);
  const list = useQuery({
    queryKey: ['stock', 'at-date', date, state.page, state.pageSize, state.q],
    queryFn: () =>
      api.get<
        WithTotals<
          {
            id: string;
            internalCode: string;
            name: string;
            dosage: string | null;
            unitsPerPack: number;
            sellByUnit: boolean;
            qty: number;
            lotCount: number;
            valueCost: number | null;
          },
          { valueCost: number | null }
        >
      >('/stock/at-date', {
        query: { date, page: state.page, pageSize: state.pageSize, q: state.q },
      }),
    placeholderData: (prev) => prev,
  });
  return (
    <>
      <PageHeader
        title="Stock à une date"
        description="État du stock tel qu’il était à la fin de la journée choisie, reconstitué à partir des mouvements."
      />
      {list.data?.totals.valueCost !== null && list.data && (
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <Kpi
            label={`Valeur au coût le ${fmt.isoDate(date)}`}
            value={fmt.money(list.data.totals.valueCost)}
          />
        </div>
      )}
      <DataTable
        columns={[
          {
            id: 'code',
            header: 'Code',
            cell: ({ row }) => (
              <span className="font-mono text-xs">{row.original.internalCode}</span>
            ),
          },
          {
            id: 'name',
            header: 'Produit',
            cell: ({ row }) => (
              <span className="font-medium">
                {row.original.name}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {row.original.dosage}
                </span>
              </span>
            ),
          },
          {
            id: 'qty',
            header: 'Quantité',
            meta: { align: 'right' },
            cell: ({ row }) => <Qty value={row.original.qty} product={row.original} />,
          },
          {
            id: 'lots',
            header: 'Lots',
            meta: { align: 'right' },
            cell: ({ row }) => row.original.lotCount,
          },
          ...(list.data?.totals.valueCost !== null
            ? [
                {
                  id: 'value',
                  header: 'Valeur au coût',
                  meta: { align: 'right' as const },
                  cell: ({ row }: { row: { original: { valueCost: number | null } } }) =>
                    fmt.money(row.original.valueCost),
                },
              ]
            : []),
        ]}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="Produit…"
        emptyTitle="Aucun stock à cette date"
        toolbar={
          <Input
            type="date"
            className="w-44"
            max={todayIso(fmt.tz)}
            value={date}
            onChange={(e) => state.update({ date: e.target.value })}
            aria-label="Date"
          />
        }
      />
    </>
  );
}

export const MOVEMENT_TYPE_OPTIONS = Object.entries(STOCK_MOVEMENT_TYPES);
