import { formatBp, htFromTtc, marginBp, type Paginated } from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, History, Pencil, Snowflake } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { DataTable, type Column } from '@/components/data-table';
import { ErrorState, Field, PageHeader } from '@/components/page';
import { ExpiryBadge, LotStatusBadge, Qty, StockStatusBadge } from '@/components/stock-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import type { LotRow, Product } from '@/lib/types';
import { ProductFormDialog } from './product-form';

const PRICE_FIELD: Record<string, string> = {
  refPurchasePriceHt: 'Prix d’achat HT',
  salePriceTtc: 'Prix de vente TTC',
  unitSalePriceTtc: 'Prix unitaire TTC',
};

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const [editing, setEditing] = React.useState(false);
  const product = useQuery({
    queryKey: ['products', id],
    queryFn: () => api.get<Product>(`/products/${id}`),
  });
  const lots = useQuery({
    queryKey: ['products', id, 'lots'],
    queryFn: () =>
      api.get<Paginated<LotRow>>('/stock/lots', {
        query: { productId: id, withStock: '0', pageSize: 200, sort: 'expiryDate:asc' },
      }),
    enabled: can('stock.view'),
  });
  const history = useQuery({
    queryKey: ['products', id, 'prices'],
    queryFn: () =>
      api.get<
        {
          id: string;
          field: string;
          oldValue: number | null;
          newValue: number | null;
          changedAt: string;
          changedById: string;
        }[]
      >(`/products/${id}/price-history`),
  });
  const equivalents = useQuery({
    queryKey: ['products', id, 'equivalents'],
    queryFn: () => api.get<Product[]>(`/products/${id}/equivalents`),
  });
  const users = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => api.get<{ id: string; code: string; fullName: string }[]>('/users/directory'),
  });

  if (product.error)
    return <ErrorState error={product.error} onRetry={() => void product.refetch()} />;
  if (!product.data) return <Skeleton className="h-96" />;
  const p = product.data;
  const saleHt = htFromTtc(p.salePriceTtc, p.tvaRate.rateBp);
  const margin = p.refPurchasePriceHt !== undefined ? marginBp(saleHt, p.refPurchasePriceHt) : null;

  const lotColumns: Column<LotRow>[] = [
    {
      id: 'lot',
      header: 'Lot',
      cell: ({ row }) => <span className="font-mono">{row.original.lotNumber}</span>,
    },
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
      id: 'received',
      header: 'Reçu le',
      cell: ({ row }) => <span className="tabular">{fmt.date(row.original.receivedAt)}</span>,
    },
    {
      id: 'initial',
      header: 'Qté initiale',
      meta: { align: 'right' },
      cell: ({ row }) => <Qty value={row.original.initialQty} product={p} />,
    },
    {
      id: 'remaining',
      header: 'Restant',
      meta: { align: 'right' },
      cell: ({ row }) => <Qty value={row.original.remainingQty} product={p} />,
    },
    ...(can('catalog.view_costs')
      ? [
          {
            id: 'cost',
            header: 'Coût unitaire HT',
            meta: { align: 'right' as const },
            cell: ({ row }: { row: { original: LotRow } }) => fmt.money(row.original.unitCostHt),
          },
        ]
      : []),
    { id: 'supplier', header: 'Fournisseur', cell: ({ row }) => row.original.supplierName ?? '—' },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => <LotStatusBadge status={row.original.status} />,
    },
  ];
  const userCode = (uid: string) => users.data?.find((u) => u.id === uid)?.code ?? '—';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name}
            {p.dosage && (
              <span className="text-base font-normal text-muted-foreground">{p.dosage}</span>
            )}
            {!p.isActive && <Badge variant="gray">Archivé</Badge>}
          </span>
        }
        description={`${p.internalCode} · ${[p.dci, p.form, p.presentation].filter(Boolean).join(' · ')}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/products">
                <ArrowLeft /> Produits
              </Link>
            </Button>
            {can('stock.movements') && (
              <Button variant="outline" asChild>
                <Link to={`/stock/movements?productId=${p.id}`}>
                  <History /> Fiche de mouvement
                </Link>
              </Button>
            )}
            {can('catalog.manage') && (
              <Button onClick={() => setEditing(true)}>
                <Pencil /> Modifier
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Stock</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Vendable">
                <span className="text-lg font-semibold">
                  <Qty value={p.stock.sellable} product={p} />
                </span>
              </Field>
              <Field label="État">
                <StockStatusBadge status={p.stock.status} />
              </Field>
              <Field label="Bloqué / périmé">
                <Qty value={p.stock.unavailable} product={p} />
              </Field>
              <Field label="Lots en stock">{p.stock.lotCount}</Field>
              <Field label="Prochaine péremption">
                {p.stock.nextExpiry ? fmt.isoDate(p.stock.nextExpiry) : '—'}
              </Field>
              <Field label="Seuils (min / max / commande)">
                {p.minStock} / {p.maxStock ?? '—'} / {p.reorderPoint ?? '—'}
              </Field>
              {can('catalog.view_costs') && (
                <Field label="Valeur au coût">{fmt.money(p.stock.valueCost)}</Field>
              )}
              <Field label="Emplacement">{p.location ?? '—'}</Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Prix</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Prix de vente TTC">{fmt.money(p.salePriceTtc)}</Field>
              <Field label="Prix de vente HT">{fmt.money(saleHt)}</Field>
              <Field label="TVA">{p.tvaRate.label}</Field>
              {p.sellByUnit && (
                <Field label={`Prix unitaire TTC (${p.unitsPerPack} / boîte)`}>
                  {fmt.money(p.unitSalePriceTtc)}
                </Field>
              )}
              {p.refPurchasePriceHt !== undefined && (
                <Field label="Prix d’achat de référence HT">
                  {fmt.money(p.refPurchasePriceHt)}
                </Field>
              )}
              {margin !== null && (
                <Field label="Marge">
                  <span className={margin < 0 ? 'text-destructive' : undefined}>
                    {formatBp(margin)}
                  </span>
                </Field>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Caractéristiques</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Catégorie">{p.category.name}</Field>
              <Field label="Laboratoire">{p.laboratory?.name ?? '—'}</Field>
              <Field label="Famille thérapeutique">{p.therapeuticClass?.name ?? '—'}</Field>
              <Field label="Ordonnance">{p.requiresPrescription ? 'Obligatoire' : 'Non'}</Field>
              <Field label="Tableau">
                {p.controlledClass === 'NONE' ? 'Aucun' : `Tableau ${p.controlledClass}`}
              </Field>
              <Field label="Chaîne du froid">
                {p.coldChain ? (
                  <span className="inline-flex items-center gap-1 text-sky-700">
                    <Snowflake className="size-3.5" /> 2–8 °C
                  </span>
                ) : (
                  'Non'
                )}
              </Field>
              <Field label="Retour client">{p.returnable ? 'Autorisé' : 'Non autorisé'}</Field>
              <Field label="Codes-barres">
                <span className="font-mono text-xs">
                  {p.barcodes.map((b) => b.barcode).join(', ') || '—'}
                </span>
              </Field>
            </dl>
          </CardContent>
        </Card>
      </div>
      <Tabs defaultValue="lots" className="mt-4">
        <TabsList>
          {can('stock.view') && <TabsTrigger value="lots">Lots</TabsTrigger>}
          <TabsTrigger value="equivalents">
            Équivalents ({equivalents.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="prices">Historique des prix</TabsTrigger>
        </TabsList>
        {can('stock.view') && (
          <TabsContent value="lots">
            <DataTable
              columns={lotColumns}
              data={lots.data}
              isLoading={lots.isLoading}
              emptyTitle="Aucun lot"
              emptyDescription="Les lots sont créés à la validation des réceptions."
              dense
            />
          </TabsContent>
        )}
        <TabsContent value="equivalents">
          <DataTable
            columns={[
              {
                id: 'name',
                header: 'Produit',
                cell: ({ row }) => (
                  <Link
                    className="font-medium text-primary hover:underline"
                    to={`/products/${row.original.id}`}
                  >
                    {row.original.name}
                  </Link>
                ),
              },
              {
                id: 'lab',
                header: 'Laboratoire',
                cell: ({ row }) => row.original.laboratory?.name ?? '—',
              },
              {
                id: 'price',
                header: 'Prix TTC',
                meta: { align: 'right' },
                cell: ({ row }) => fmt.money(row.original.salePriceTtc),
              },
              {
                id: 'stock',
                header: 'Stock vendable',
                meta: { align: 'right' },
                cell: ({ row }) => (
                  <Qty value={row.original.stock.sellable} product={row.original} />
                ),
              },
            ]}
            data={equivalents.data}
            isLoading={equivalents.isLoading}
            emptyTitle="Aucun équivalent disponible"
            emptyDescription="Produits de même DCI, dosage et forme, avec du stock vendable."
            dense
          />
        </TabsContent>
        <TabsContent value="prices">
          <DataTable
            columns={[
              {
                id: 'date',
                header: 'Date',
                cell: ({ row }) => (
                  <span className="tabular">{fmt.dateTime(row.original.changedAt)}</span>
                ),
              },
              {
                id: 'field',
                header: 'Prix',
                cell: ({ row }) => PRICE_FIELD[row.original.field] ?? row.original.field,
              },
              {
                id: 'old',
                header: 'Ancien',
                meta: { align: 'right' },
                cell: ({ row }) => fmt.money(row.original.oldValue) || '—',
              },
              {
                id: 'new',
                header: 'Nouveau',
                meta: { align: 'right' },
                cell: ({ row }) => fmt.money(row.original.newValue) || '—',
              },
              {
                id: 'user',
                header: 'Par',
                cell: ({ row }) => (
                  <span className="font-mono">{userCode(row.original.changedById)}</span>
                ),
              },
            ]}
            data={history.data}
            isLoading={history.isLoading}
            emptyTitle="Aucun changement de prix"
            dense
          />
        </TabsContent>
      </Tabs>
      <ProductFormDialog
        product={p}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={() => void product.refetch()}
      />
    </>
  );
}
