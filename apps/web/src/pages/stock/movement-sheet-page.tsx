import { formatStockQty, STOCK_MOVEMENT_TYPES, todayIso } from '@pharmastock/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/product-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { api, errorText } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';

interface MovementRow {
  id: number;
  createdAt: string;
  type: keyof typeof STOCK_MOVEMENT_TYPES;
  documentType: string;
  documentId: string;
  documentNumber: string | null;
  lotId: string;
  lotNumber: string;
  expiryDate: string | null;
  qtyIn: number;
  qtyOut: number;
  balanceAfter: number;
  counterpartName: string | null;
  unitPriceTtc: number | null;
  unitCostHt: number | null;
  user: { code: string; fullName: string } | null;
  authorizedBy: { code: string; fullName: string } | null;
  device: string | null;
  reason: string | null;
}

interface Sheet {
  product: {
    id: string;
    internalCode: string;
    name: string;
    dosage: string | null;
    form: string | null;
    unitsPerPack: number;
    sellByUnit: boolean;
  };
  openingQty: number;
  totalIn: number;
  totalOut: number;
  closingQty: number;
  byType: {
    type: keyof typeof STOCK_MOVEMENT_TYPES;
    qtyIn: number;
    qtyOut: number;
    count: number;
  }[];
  items: MovementRow[];
  total: number;
  page: number;
  pageSize: number;
}

const IN_TYPES = new Set(['PURCHASE_IN', 'SALE_CANCEL', 'CUSTOMER_RETURN_IN']);

/** Lien vers le document source d'un mouvement (réception, vente, retour…). */
export function documentLink(type: string, id: string): string | null {
  switch (type) {
    case 'RECEIPT':
      return `/receipts/${id}`;
    case 'SALE':
      return `/sales/${id}`;
    case 'CUSTOMER_RETURN':
      return `/returns/${id}`;
    case 'SUPPLIER_RETURN':
      return `/supplier-returns/${id}`;
    case 'INVENTORY':
      return `/inventories/${id}`;
    case 'ADJUSTMENT':
      return `/adjustments/${id}`;
    default:
      return null;
  }
}

/** Fiche de mouvement d'un produit depuis une date choisie (§6.5) — écran central demandé par la cliente. */
export function MovementSheetPage() {
  const fmt = useFormat();
  const [params, setParams] = useSearchParams();
  const productId = params.get('productId') ?? '';
  const today = todayIso(fmt.tz);
  const from = params.get('from') ?? `${today.slice(0, 8)}01`;
  const to = params.get('to') ?? today;
  const type = params.get('type') ?? '';
  const lotId = params.get('lotId') ?? '';
  const userId = params.get('userId') ?? '';
  const page = Number(params.get('page') ?? '1');
  const set = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  const users = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => api.get<{ id: string; code: string; fullName: string }[]>('/users/directory'),
  });
  const sheet = useQuery({
    queryKey: ['stock', 'movements', productId, from, to, type, lotId, userId, page],
    queryFn: () =>
      api.get<Sheet>('/stock/movements', {
        query: { productId, from, to, type, lotId, userId, page, pageSize: 200 },
      }),
    enabled: !!productId,
    placeholderData: (prev) => (prev?.product.id === productId ? prev : undefined),
  });
  const lots = useQuery({
    queryKey: ['stock', 'lots', 'product', productId],
    queryFn: () =>
      api.get<{ items: { id: string; lotNumber: string }[] }>('/stock/lots', {
        query: { productId, withStock: '0', pageSize: 200 },
      }),
    enabled: !!productId,
  });
  const exportXlsx = useMutation({
    mutationFn: () =>
      api.blob('/stock/movements/export', { query: { productId, from, to, type, lotId, userId } }),
    onSuccess: (blob) =>
      platform.download(
        blob,
        `fiche-mouvement-${sheet.data?.product.internalCode ?? ''}-${from}-${to}.xlsx`,
      ),
    onError: (err) => toast.error(errorText(err)),
  });

  const s = sheet.data;
  const q = (v: number) =>
    s ? formatStockQty(v, s.product.unitsPerPack, s.product.sellByUnit) : String(v);
  const showCost = s?.items.some((i) => i.unitCostHt !== null);
  const columns: Column<MovementRow>[] = [
    {
      id: 'date',
      header: 'Date et heure',
      cell: ({ row }) => (
        <span className="tabular whitespace-nowrap">{fmt.dateTime(row.original.createdAt)}</span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <Badge
          variant={IN_TYPES.has(row.original.type) || row.original.qtyIn > 0 ? 'green' : 'orange'}
        >
          {STOCK_MOVEMENT_TYPES[row.original.type]}
        </Badge>
      ),
    },
    {
      id: 'doc',
      header: 'Document',
      cell: ({ row }) => {
        const link = documentLink(row.original.documentType, row.original.documentId);
        const label = row.original.documentNumber ?? '—';
        return link ? (
          <Link
            to={link}
            className="font-mono text-xs whitespace-nowrap text-primary hover:underline"
          >
            {label}
          </Link>
        ) : (
          <span className="font-mono text-xs">{label}</span>
        );
      },
    },
    {
      id: 'lot',
      header: 'Lot',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          <span className="font-mono">{row.original.lotNumber}</span>
          {row.original.expiryDate && (
            <span className="text-xs text-muted-foreground">
              {' '}
              · {fmt.isoDate(row.original.expiryDate)}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'in',
      header: 'Entrée',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.qtyIn ? (
          <span className="text-emerald-700 dark:text-emerald-400">+{q(row.original.qtyIn)}</span>
        ) : (
          ''
        ),
    },
    {
      id: 'out',
      header: 'Sortie',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.qtyOut ? (
          <span className="text-orange-700 dark:text-orange-400">−{q(row.original.qtyOut)}</span>
        ) : (
          ''
        ),
    },
    {
      id: 'balance',
      header: 'Solde',
      meta: { align: 'right' },
      cell: ({ row }) => <strong>{q(row.original.balanceAfter)}</strong>,
    },
    {
      id: 'counterpart',
      header: 'Client / fournisseur',
      cell: ({ row }) => row.original.counterpartName ?? '—',
    },
    {
      id: 'price',
      header: 'Prix TTC',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.unitPriceTtc !== null ? fmt.money(row.original.unitPriceTtc) : '',
    },
    ...(showCost
      ? [
          {
            id: 'cost',
            header: 'Coût HT',
            meta: { align: 'right' as const },
            cell: ({ row }: { row: { original: MovementRow } }) =>
              fmt.money(row.original.unitCostHt),
          },
        ]
      : []),
    {
      id: 'user',
      header: 'Utilisateur',
      cell: ({ row }) => (
        <span className="whitespace-nowrap" title={row.original.user?.fullName}>
          <span className="font-mono">{row.original.user?.code}</span>{' '}
          <span className="text-xs text-muted-foreground">{row.original.user?.fullName}</span>
          {row.original.authorizedBy && (
            <span className="block text-xs text-muted-foreground">
              autorisé par {row.original.authorizedBy.code}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'device',
      header: 'Poste',
      meta: { label: 'Poste' },
      cell: ({ row }) => row.original.device ?? '—',
    },
    {
      id: 'reason',
      header: 'Motif',
      meta: { label: 'Motif' },
      cell: ({ row }) => row.original.reason ?? '',
    },
  ];

  return (
    <>
      <PageHeader
        title="Fiche de mouvement"
        description="Tous les mouvements d’un produit depuis une date choisie : qui a fait l’opération, date et heure, lot, document."
        actions={
          s && (
            <Button
              variant="outline"
              onClick={() => exportXlsx.mutate()}
              loading={exportXlsx.isPending}
            >
              <Download /> Exporter (Excel)
            </Button>
          )
        }
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="flex min-w-72 flex-1 flex-col gap-1.5">
            <Label>Produit</Label>
            {s ? (
              <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                <span className="truncate font-medium">
                  {s.product.internalCode} — {s.product.name} {s.product.dosage}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Changer de produit"
                  onClick={() => set({ productId: '', lotId: '' })}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <ProductPicker
                includeInactive
                onSelect={(p) => set({ productId: p.id, lotId: '' })}
                autoFocus
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-from">Du</Label>
            <Input
              id="mv-from"
              type="date"
              className="w-40"
              value={from}
              max={to}
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-to">Au</Label>
            <Input
              id="mv-to"
              type="date"
              className="w-40"
              value={to}
              min={from}
              max={today}
              onChange={(e) => set({ to: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-type">Type</Label>
            <NativeSelect
              id="mv-type"
              className="w-48"
              value={type}
              onChange={(e) => set({ type: e.target.value })}
            >
              <option value="">Tous les mouvements</option>
              {Object.entries(STOCK_MOVEMENT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-lot">Lot</Label>
            <NativeSelect
              id="mv-lot"
              className="w-36"
              value={lotId}
              onChange={(e) => set({ lotId: e.target.value })}
              disabled={!productId}
            >
              <option value="">Tous</option>
              {lots.data?.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lotNumber}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-user">Utilisateur</Label>
            <NativeSelect
              id="mv-user"
              className="w-44"
              value={userId}
              onChange={(e) => set({ userId: e.target.value })}
            >
              <option value="">Tous</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>
      {!productId ? (
        <EmptyState
          title="Choisissez un produit"
          description="Recherchez un produit par nom, DCI, code ou code-barres pour afficher ses mouvements."
        />
      ) : (
        <>
          {s && (
            <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">
                    Stock initial au {fmt.isoDate(from)}
                  </div>
                  <div className="text-lg font-semibold tabular">{q(s.openingQty)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Total des entrées</div>
                  <div className="text-lg font-semibold text-emerald-700 tabular dark:text-emerald-400">
                    +{q(s.totalIn)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Total des sorties</div>
                  <div className="text-lg font-semibold text-orange-700 tabular dark:text-orange-400">
                    −{q(s.totalOut)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">
                    Stock final au {fmt.isoDate(to)}
                  </div>
                  <div className="text-lg font-semibold tabular">{q(s.closingQty)}</div>
                </CardContent>
              </Card>
            </div>
          )}
          <DataTable
            columns={columns}
            data={s?.items}
            isLoading={sheet.isLoading}
            error={sheet.error}
            emptyTitle="Aucun mouvement sur la période"
            dense
          />
          {s && s.total > s.pageSize && (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
              {s.total} mouvements — page {s.page} / {Math.ceil(s.total / s.pageSize)}
              <Button
                variant="outline"
                size="sm"
                disabled={s.page <= 1}
                onClick={() => set({ page: String(s.page - 1) })}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={s.page * s.pageSize >= s.total}
                onClick={() => set({ page: String(s.page + 1) })}
              >
                Suivant
              </Button>
            </div>
          )}
          {s && s.byType.length > 0 && (
            <Card className="mt-4">
              <CardContent className="pt-4">
                <h3 className="mb-2 text-sm font-semibold">Totaux par type de mouvement</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {s.byType.map((t) => (
                    <div
                      key={t.type}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {STOCK_MOVEMENT_TYPES[t.type]}{' '}
                        <span className="text-xs text-muted-foreground">({t.count})</span>
                      </span>
                      <span className="tabular">
                        {t.qtyIn > 0 && (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            +{q(t.qtyIn)}{' '}
                          </span>
                        )}
                        {t.qtyOut > 0 && (
                          <span className="text-orange-700 dark:text-orange-400">
                            −{q(t.qtyOut)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}
