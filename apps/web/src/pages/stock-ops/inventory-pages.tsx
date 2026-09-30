import {
  formatStockQty,
  INVENTORY_SCOPE_KINDS,
  productLabel,
  type InventoryScopeKind,
  type Paginated,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField } from '@/components/form';
import { LotPicker } from '@/components/lot-picker';
import { ErrorState, Field, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/misc';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useReferences } from '@/lib/catalog';
import { useFormat } from '@/lib/format';
import type { LotRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { InventoryDetail, InventoryLine, InventoryRow, ProductLite } from './types';

const STATUS = {
  COUNTING: <Badge variant="blue">Comptage en cours</Badge>,
  VALIDATED: <Badge variant="green">Validé</Badge>,
  CANCELLED: <Badge variant="gray">Annulé</Badge>,
} as const;

async function download(path: string, query: Record<string, string>, filename: string) {
  const blob = await api.blob(path, { query });
  const url = URL.createObjectURL(blob);
  if (query.format === 'pdf') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Liste et ouverture
// ---------------------------------------------------------------------------

function OpenInventoryDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const refs = useReferences();
  const [kind, setKind] = React.useState<InventoryScopeKind>('ALL');
  const [ids, setIds] = React.useState<string[]>([]);
  const [locations, setLocations] = React.useState('');
  const [includeEmpty, setIncludeEmpty] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [products, setProducts] = React.useState<ProductLite[]>([]);
  const [search, setSearch] = React.useState('');
  const [found, setFound] = React.useState<ProductLite[]>([]);

  React.useEffect(() => {
    if (kind !== 'PRODUCTS' || !search.trim()) {
      setFound([]);
      return;
    }
    const handle = window.setTimeout(() => {
      api
        .get<ProductLite[]>('/products/search', { query: { q: search, all: '0' } })
        .then(setFound)
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [kind, search]);

  const options =
    kind === 'CATEGORY'
      ? (refs.data?.categories ?? []).filter((c) => c.isActive)
      : kind === 'LABORATORY'
        ? (refs.data?.laboratories ?? []).filter((l) => l.isActive)
        : [];

  const submit = async () => {
    let scope: Record<string, unknown> = { kind };
    if (kind === 'CATEGORY' || kind === 'LABORATORY') {
      if (ids.length === 0) return toast.error('Sélectionnez au moins un élément.');
      scope = { kind, ids };
    } else if (kind === 'LOCATION') {
      const list = locations
        .split(/[,;\n]/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (list.length === 0) return toast.error('Saisissez au moins un emplacement.');
      scope = { kind, locations: list };
    } else if (kind === 'PRODUCTS') {
      if (products.length === 0) return toast.error('Sélectionnez au moins un produit.');
      scope = { kind, ids: products.map((p) => p.id) };
    }
    setBusy(true);
    try {
      const inv = await api.post<InventoryDetail>('/inventories', {
        scope,
        includeEmptyLots: includeEmpty,
        notes: notes || undefined,
      });
      toast.success(`Inventaire ${inv.number} ouvert : ${inv.stats.lines} lot(s) à compter`);
      void navigate(`/inventories/${inv.id}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ouvrir un inventaire</DialogTitle>
          <DialogDescription>
            Une photographie du stock par lot est prise à l’ouverture ; le comptage se fait ensuite
            à l’aveugle, sur plusieurs postes en parallèle.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FormField label="Périmètre">
            <NativeSelect
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as InventoryScopeKind);
                setIds([]);
              }}
            >
              {Object.entries(INVENTORY_SCOPE_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {(kind === 'CATEGORY' || kind === 'LABORATORY') && (
            <div className="max-h-48 overflow-auto rounded-md border p-2">
              {options.map((o) => (
                <label key={o.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <Checkbox
                    checked={ids.includes(o.id)}
                    onCheckedChange={(c) =>
                      setIds((prev) =>
                        c === true ? [...prev, o.id] : prev.filter((i) => i !== o.id),
                      )
                    }
                  />
                  {o.name}
                </label>
              ))}
            </div>
          )}
          {kind === 'LOCATION' && (
            <FormField label="Emplacements" hint="Séparés par des virgules (ex. Rayon A, Frigo).">
              <Input value={locations} onChange={(e) => setLocations(e.target.value)} />
            </FormField>
          )}
          {kind === 'PRODUCTS' && (
            <div className="flex flex-col gap-2">
              <Input
                placeholder="Rechercher un produit à ajouter…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {found.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-md border">
                  {found
                    .filter((f) => !products.some((p) => p.id === f.id))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          setProducts((prev) => [...prev, p]);
                          setSearch('');
                        }}
                      >
                        {productLabel(p)}{' '}
                        <span className="text-xs text-muted-foreground">{p.internalCode}</span>
                      </button>
                    ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {products.map((p) => (
                  <Badge key={p.id} variant="gray" className="gap-1">
                    {p.name}
                    <button
                      type="button"
                      aria-label={`Retirer ${p.name}`}
                      onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeEmpty} onCheckedChange={(c) => setIncludeEmpty(c === true)} />
            Inclure les lots épuisés (retrouver du stock non enregistré)
          </label>
          <FormField label="Remarque">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Ouvrir l’inventaire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InventoriesPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const state = useTableState();
  const [opening, setOpening] = React.useState(false);
  const status = state.filter('status');
  const list = useQuery({
    queryKey: ['inventories', 'list', state.page, state.pageSize, state.q, status],
    queryFn: () =>
      api.get<Paginated<InventoryRow>>('/inventories', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, status },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<InventoryRow>[] = [
    {
      id: 'number',
      header: 'Inventaire',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
    },
    { id: 'scope', header: 'Périmètre', cell: ({ row }) => row.original.scopeLabel },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => STATUS[row.original.status],
    },
    {
      id: 'progress',
      header: 'Comptage',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular">
          {row.original.countedCount} / {row.original.lineCount}
        </span>
      ),
    },
    {
      id: 'startedAt',
      header: 'Ouvert le',
      cell: ({ row }) => (
        <span className="tabular">
          {fmt.dateTime(row.original.startedAt)}{' '}
          <span className="text-xs text-muted-foreground">{row.original.startedBy?.code}</span>
        </span>
      ),
    },
    {
      id: 'validatedAt',
      header: 'Validé le',
      cell: ({ row }) =>
        row.original.validatedAt ? (
          <span className="tabular">
            {fmt.dateTime(row.original.validatedAt)}{' '}
            <span className="text-xs text-muted-foreground">{row.original.validatedBy?.code}</span>
          </span>
        ) : (
          '—'
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Inventaires"
        description="Comptage physique par lot, écarts et corrections du stock."
        actions={
          can('inventory.manage') && (
            <Button onClick={() => setOpening(true)}>
              <Plus /> Ouvrir un inventaire
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
        searchPlaceholder="N° d’inventaire…"
        onRowClick={(r) => void navigate(`/inventories/${r.id}`)}
        emptyTitle="Aucun inventaire"
        toolbar={
          <NativeSelect
            className="w-48"
            value={status}
            onChange={(e) => state.update({ status: e.target.value })}
            aria-label="Statut"
          >
            <option value="">Tous les statuts</option>
            <option value="COUNTING">Comptage en cours</option>
            <option value="VALIDATED">Validés</option>
            <option value="CANCELLED">Annulés</option>
          </NativeSelect>
        }
      />
      {opening && <OpenInventoryDialog onClose={() => setOpening(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Comptage
// ---------------------------------------------------------------------------

/** Saisie d'une quantité : boîtes + unités pour un produit vendu à l'unité, sinon un seul champ. */
function CountInput({
  product,
  value,
  disabled,
  onCommit,
  inputRef,
}: {
  product: ProductLite;
  value: number | null;
  disabled?: boolean;
  onCommit: (qty: number) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const split = product.sellByUnit && product.unitsPerPack > 1;
  const initialPacks =
    value === null ? '' : String(split ? Math.floor(value / product.unitsPerPack) : value);
  const initialUnits = value === null || !split ? '' : String(value % product.unitsPerPack);
  const [packs, setPacks] = React.useState(initialPacks);
  const [units, setUnits] = React.useState(initialUnits);
  React.useEffect(() => {
    setPacks(initialPacks);
    setUnits(initialUnits);
  }, [initialPacks, initialUnits]);

  const commit = () => {
    if (packs === '' && units === '') return;
    const p = Number(packs || 0);
    const u = Number(units || 0);
    if (!Number.isInteger(p) || !Number.isInteger(u) || p < 0 || u < 0) {
      toast.error('Quantité invalide');
      return;
    }
    const total = split ? p * product.unitsPerPack + u : p;
    if (total !== value) onCommit(total);
  };
  const keyHandler = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.currentTarget as HTMLElement).blur();
    }
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        ref={inputRef}
        type="number"
        min={0}
        inputMode="numeric"
        className="h-8 w-20 text-right tabular"
        placeholder={split ? 'boîtes' : 'qté'}
        value={packs}
        disabled={disabled}
        onChange={(e) => setPacks(e.target.value)}
        onBlur={commit}
        onKeyDown={keyHandler}
      />
      {split && (
        <Input
          type="number"
          min={0}
          max={product.unitsPerPack - 1}
          inputMode="numeric"
          className="h-8 w-16 text-right tabular"
          placeholder="unités"
          value={units}
          disabled={disabled}
          onChange={(e) => setUnits(e.target.value)}
          onBlur={commit}
          onKeyDown={keyHandler}
        />
      )}
    </div>
  );
}

function ValidateDialog({ inv, onClose }: { inv: InventoryDetail; onClose: () => void }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const [ignore, setIgnore] = React.useState(false);
  const mutate = useMutation({
    mutationFn: () => api.post(`/inventories/${inv.id}/validate`, { ignoreUncounted: ignore }),
    onSuccess: () => {
      toast.success('Inventaire validé : les écarts ont été corrigés dans le stock');
      void qc.invalidateQueries({ queryKey: ['inventories'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const uncounted = inv.stats.uncounted;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Valider l’inventaire {inv.number}</DialogTitle>
          <DialogDescription>
            Les écarts sont corrigés par des mouvements « ajustement d’inventaire » datés de la
            validation. Les ventes faites pendant le comptage restent valides.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <Field label="Lots avec écart">{inv.stats.differences ?? 0}</Field>
          <Field label="Unités en plus / en moins">
            +{inv.stats.unitsPlus ?? 0} / −{inv.stats.unitsMinus ?? 0}
          </Field>
          {inv.stats.valueDifference !== null && (
            <Field label="Écart valorisé au coût">{fmt.money(inv.stats.valueDifference)}</Field>
          )}
          {uncounted > 0 && (
            <label className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <Checkbox checked={ignore} onCheckedChange={(c) => setIgnore(c === true)} />
              <span>
                {uncounted} ligne(s) n’ont pas été comptées. Cochez pour les laisser inchangées et
                valider quand même.
              </span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Retour
          </Button>
          <Button
            onClick={() => mutate.mutate()}
            disabled={mutate.isPending || (uncounted > 0 && !ignore)}
          >
            {mutate.isPending && <Loader2 className="animate-spin" />} Valider et corriger le stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLotDialog({ inv, onClose }: { inv: InventoryDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [lot, setLot] = React.useState<LotRow | null>(null);
  const [qty, setQty] = React.useState('');
  const mutate = useMutation({
    mutationFn: () =>
      api.post(`/inventories/${inv.id}/lots`, { lotId: lot!.id, countedQty: Number(qty) }),
    onSuccess: () => {
      toast.success('Lot ajouté et compté');
      void qc.invalidateQueries({ queryKey: ['inventory', inv.id] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un lot absent de la liste</DialogTitle>
          <DialogDescription>
            Pour un lot reçu ou trouvé après l’ouverture de l’inventaire.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <LotPicker onSelect={setLot} autoFocus />
          {lot && (
            <div className="rounded-md border p-2 text-sm">
              {productLabel(lot.product)} — lot <span className="font-mono">{lot.lotNumber}</span>
            </div>
          )}
          <FormField label="Quantité comptée (unités)">
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => mutate.mutate()} disabled={!lot || qty === '' || mutate.isPending}>
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InventoryDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const state = useTableState({ pageSize: 50 });
  const filter = state.filter('filter') || 'ALL';
  const [validating, setValidating] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const firstInput = React.useRef<HTMLInputElement>(null);

  const inv = useQuery({
    queryKey: ['inventory', id],
    queryFn: () => api.get<InventoryDetail>(`/inventories/${id}`),
    enabled: !!id,
    refetchInterval: 15_000,
  });
  const lines = useQuery({
    queryKey: ['inventory', id, 'lines', state.page, state.pageSize, state.q, filter],
    queryFn: () =>
      api.get<Paginated<InventoryLine>>(`/inventories/${id}/lines`, {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, filter },
      }),
    enabled: !!id,
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['inventory', id] });
  const count = useMutation({
    mutationFn: (v: { lineId: string; countedQty: number }) =>
      api.post(`/inventories/${id}/count`, { counts: [v] }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorText(err)),
  });
  const finish = useMutation({
    mutationFn: () => api.post(`/inventories/${id}/finish`),
    onSuccess: () => toast.success('Comptage terminé : l’administrateur est prévenu'),
    onError: (err) => toast.error(errorText(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/inventories/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      toast.success('Inventaire annulé');
      setCancelling(false);
      void qc.invalidateQueries({ queryKey: ['inventories'] });
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });

  // Un scan qui ne laisse qu'une ligne place le curseur sur sa quantité.
  const items = lines.data?.items ?? [];
  React.useEffect(() => {
    if (state.q && items.length === 1 && inv.data?.status === 'COUNTING')
      firstInput.current?.focus();
  }, [state.q, items.length, inv.data?.status]);

  if (inv.error) return <ErrorState error={inv.error} onRetry={() => void inv.refetch()} />;
  if (!inv.data) return <Skeleton className="h-96" />;
  const d = inv.data;
  const counting = d.status === 'COUNTING';
  const manage = can('inventory.manage');
  const percent = d.stats.lines === 0 ? 0 : Math.round((d.stats.counted / d.stats.lines) * 100);

  const columns: Column<InventoryLine>[] = [
    {
      id: 'product',
      header: 'Produit',
      cell: ({ row }) =>
        row.original.product ? (
          <div>
            <div className="font-medium">{productLabel(row.original.product)}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.product.internalCode}
              {row.original.product.location ? ` · ${row.original.product.location}` : ''}
            </div>
          </div>
        ) : (
          '—'
        ),
    },
    {
      id: 'lot',
      header: 'Lot',
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-xs">{row.original.lot?.lotNumber}</span>
          <div className="text-xs text-muted-foreground">
            exp. {row.original.lot ? fmt.isoDate(row.original.lot.expiryDate) : ''}
          </div>
        </div>
      ),
    },
    ...(manage
      ? ([
          {
            id: 'theoretical',
            header: 'Théorique',
            meta: { align: 'right' },
            cell: ({ row }) =>
              row.original.product && row.original.theoreticalAtCount !== null ? (
                <span className="tabular">
                  {formatStockQty(
                    row.original.theoreticalAtCount,
                    row.original.product.unitsPerPack,
                    row.original.product.sellByUnit,
                  )}
                </span>
              ) : row.original.snapshotQty !== null && row.original.product ? (
                <span className="tabular text-muted-foreground">
                  {formatStockQty(
                    row.original.snapshotQty,
                    row.original.product.unitsPerPack,
                    row.original.product.sellByUnit,
                  )}
                </span>
              ) : (
                '—'
              ),
          },
        ] satisfies Column<InventoryLine>[])
      : []),
    {
      id: 'counted',
      header: 'Compté',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.product ? (
          <CountInput
            product={row.original.product}
            value={row.original.countedQty}
            disabled={!counting || count.isPending}
            inputRef={row.index === 0 ? firstInput : undefined}
            onCommit={(qty) => count.mutate({ lineId: row.original.id, countedQty: qty })}
          />
        ) : null,
    },
    ...(manage
      ? ([
          {
            id: 'difference',
            header: 'Écart',
            meta: { align: 'right' },
            cell: ({ row }) => {
              const diff = row.original.difference;
              if (diff === null || !row.original.product) return '—';
              if (diff === 0) return <Check className="ml-auto size-4 text-emerald-600" />;
              return (
                <span
                  className={cn(
                    'font-medium tabular',
                    diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600',
                  )}
                >
                  {diff > 0 ? '+' : '−'}
                  {formatStockQty(
                    Math.abs(diff),
                    row.original.product.unitsPerPack,
                    row.original.product.sellByUnit,
                  )}
                </span>
              );
            },
          },
        ] satisfies Column<InventoryLine>[])
      : []),
    {
      id: 'by',
      header: 'Compté par',
      cell: ({ row }) =>
        row.original.countedBy ? (
          <span className="text-xs">
            <span className="font-mono">{row.original.countedBy.code}</span>
            {row.original.countCount > 1 && (
              <span className="text-muted-foreground"> · {row.original.countCount}× </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">non compté</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Inventaire {d.number} {STATUS[d.status]}
          </span>
        }
        description={`${d.scopeLabel} — ouvert le ${fmt.dateTime(d.startedAt)} par ${d.startedBy?.code ?? ''}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/inventories">
                <ArrowLeft /> Inventaires
              </Link>
            </Button>
            {counting && (
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus /> Ajouter un lot
              </Button>
            )}
            {counting && (
              <Button variant="outline" onClick={() => finish.mutate()} disabled={finish.isPending}>
                <ClipboardCheck /> Terminer le comptage
              </Button>
            )}
            {manage && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    void download(
                      `/inventories/${d.id}/report`,
                      { format: 'xlsx', differencesOnly: 'false' },
                      `${d.number}.xlsx`,
                    ).catch((e: unknown) => toast.error(errorText(e)))
                  }
                >
                  <FileSpreadsheet /> Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void download(
                      `/inventories/${d.id}/report`,
                      { format: 'pdf', differencesOnly: 'true' },
                      `${d.number}.pdf`,
                    ).catch((e: unknown) => toast.error(errorText(e)))
                  }
                >
                  <FileText /> Rapport des écarts
                </Button>
              </>
            )}
            {counting && manage && (
              <>
                <Button variant="destructive" onClick={() => setCancelling(true)}>
                  <Ban /> Annuler
                </Button>
                <Button onClick={() => setValidating(true)}>
                  <CheckCheck /> Valider
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Avancement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-1 flex justify-between text-sm">
              <span>
                {d.stats.counted} / {d.stats.lines} lignes comptées
              </span>
              <span className="tabular">{percent} %</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            {!manage && counting && (
              <p className="mt-2 text-xs text-muted-foreground">
                Comptage à l’aveugle : les quantités théoriques ne sont pas affichées.
              </p>
            )}
          </CardContent>
        </Card>
        {manage && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Écarts constatés</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Lots avec écart">{d.stats.differences ?? 0}</Field>
              <Field label="Unités en plus">+{d.stats.unitsPlus ?? 0}</Field>
              <Field label="Unités en moins">−{d.stats.unitsMinus ?? 0}</Field>
              <Field label="Valeur (coût)">
                {d.stats.valueDifference === null ? '—' : fmt.money(d.stats.valueDifference)}
              </Field>
            </CardContent>
          </Card>
        )}
        {d.notes && (
          <Card className={manage ? 'lg:col-span-3' : 'lg:col-span-2'}>
            <CardContent className="pt-4 text-sm">{d.notes}</CardContent>
          </Card>
        )}
      </div>
      <DataTable
        columns={columns}
        data={lines.data}
        isLoading={lines.isLoading}
        error={lines.error}
        state={state}
        dense
        searchPlaceholder="Scanner un code-barres, produit ou lot…"
        emptyTitle="Aucune ligne"
        toolbar={
          <NativeSelect
            className="w-48"
            value={filter}
            onChange={(e) => state.update({ filter: e.target.value })}
            aria-label="Filtre"
          >
            <option value="ALL">Toutes les lignes</option>
            <option value="UNCOUNTED">Non comptées</option>
            <option value="COUNTED">Comptées</option>
            {manage && <option value="DIFFERENCES">Avec écart</option>}
          </NativeSelect>
        }
      />
      {validating && <ValidateDialog inv={d} onClose={() => setValidating(false)} />}
      {adding && <AddLotDialog inv={d} onClose={() => setAdding(false)} />}
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler l’inventaire {d.number}</DialogTitle>
            <DialogDescription>Aucun ajustement de stock ne sera effectué.</DialogDescription>
          </DialogHeader>
          <FormField label="Motif" required>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Retour
            </Button>
            <Button
              variant="destructive"
              disabled={cancelReason.trim().length < 3 || cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Annuler l’inventaire
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
