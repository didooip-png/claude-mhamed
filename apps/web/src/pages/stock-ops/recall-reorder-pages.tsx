import { formatStockQty, productLabel } from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Printer, Search, ShieldAlert, Truck } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FormField } from '@/components/form';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { LotStatusBadge } from '@/components/stock-badges';
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
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useSupplierOptions } from '@/lib/catalog';
import { useFormat } from '@/lib/format';
import type { SupplierReturnPrefill } from './supplier-return-pages';
import type { RecallReport, ReorderItem } from './types';

// ---------------------------------------------------------------------------
// Rappel de lot
// ---------------------------------------------------------------------------

/** Rappel de lot : blocage des lots concernés et liste des clients à contacter. */
export function RecallPage() {
  const fmt = useFormat();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lotNumber = params.get('lot') ?? '';
  const [input, setInput] = React.useState(lotNumber);
  const [blocking, setBlocking] = React.useState(false);
  const [reason, setReason] = React.useState('');

  const report = useQuery({
    queryKey: ['recall', lotNumber],
    queryFn: () => api.get<RecallReport>('/recalls', { query: { lotNumber } }),
    enabled: lotNumber.trim().length > 0,
  });
  const execute = useMutation({
    mutationFn: () => api.post<RecallReport>('/recalls', { lotNumber, reason }),
    onSuccess: (res) => {
      toast.success('Lots bloqués : ils ne peuvent plus être vendus');
      qc.setQueryData(['recall', lotNumber], res);
      setBlocking(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const data = report.data;
  const toBlock =
    data?.lots.filter((l) => l.status !== 'BLOCKED' && (l.remainingQty > 0 || l.soldQty > 0)) ?? [];
  const inStock = data?.lots.filter((l) => l.remainingQty > 0) ?? [];

  const createSupplierReturn = () => {
    if (!data) return;
    const supplierIds = [...new Set(inStock.map((l) => l.supplier?.id).filter(Boolean))];
    const prefill: SupplierReturnPrefill = {
      supplierId: supplierIds.length === 1 ? (supplierIds[0] ?? undefined) : undefined,
      reason: `Rappel du lot ${data.lotNumber}`,
      lots: inStock.map((l) => ({
        id: l.id,
        lotNumber: l.lotNumber,
        expiryDate: l.expiryDate,
        remainingQty: l.remainingQty,
        product: l.product,
      })),
    };
    void navigate('/supplier-returns/new', { state: { prefill } });
  };

  return (
    <>
      <PageHeader
        title="Rappel de lot"
        description="Retrouvez un lot rappelé par le laboratoire ou l’autorité : blocage à la vente, clients concernés, retour au fournisseur."
      />
      <form
        className="mb-4 flex max-w-xl items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(input.trim() ? { lot: input.trim() } : {});
        }}
      >
        <FormField label="Numéro de lot" className="flex-1">
          <Input
            value={input}
            autoFocus
            placeholder="Numéro inscrit sur la boîte"
            onChange={(e) => setInput(e.target.value)}
          />
        </FormField>
        <Button type="submit">
          <Search /> Rechercher
        </Button>
      </form>

      {!lotNumber && (
        <EmptyState
          title="Saisissez un numéro de lot"
          description="Tous les produits portant ce numéro de lot seront retrouvés."
          icon={<ShieldAlert />}
        />
      )}
      {report.isLoading && <Skeleton className="h-48" />}
      {report.error && <ErrorState error={report.error} onRetry={() => void report.refetch()} />}
      {data && data.lots.length === 0 && (
        <EmptyState
          title={`Aucun lot « ${data.lotNumber} »`}
          description="Vérifiez le numéro saisi."
        />
      )}
      {data && data.lots.length > 0 && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Lots portant le numéro {data.lotNumber}</CardTitle>
              <div className="flex gap-2">
                {inStock.length > 0 && (
                  <Button variant="outline" onClick={createSupplierReturn}>
                    <Truck /> Retour fournisseur
                  </Button>
                )}
                {toBlock.length > 0 && (
                  <Button variant="destructive" onClick={() => setBlocking(true)}>
                    <ShieldAlert /> Bloquer{' '}
                    {toBlock.length > 1 ? `les ${toBlock.length} lots` : 'le lot'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Produit</TH>
                  <TH>Fournisseur</TH>
                  <TH>Péremption</TH>
                  <TH>Statut</TH>
                  <TH className="text-right">En stock</TH>
                  <TH className="text-right">Vendu (net des retours)</TH>
                </TR>
              </THead>
              <TBody>
                {data.lots.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Link to={`/products/${l.product.id}`} className="hover:underline">
                        {productLabel(l.product)}
                      </Link>
                    </TD>
                    <TD>{l.supplier?.name ?? '—'}</TD>
                    <TD className="tabular">{fmt.isoDate(l.expiryDate)}</TD>
                    <TD>
                      <LotStatusBadge status={l.status} />
                      {l.blockReason && (
                        <div className="text-xs text-muted-foreground">{l.blockReason}</div>
                      )}
                    </TD>
                    <TD className="text-right tabular">
                      {formatStockQty(l.remainingQty, l.product.unitsPerPack, l.product.sellByUnit)}
                    </TD>
                    <TD className="text-right tabular">
                      {formatStockQty(l.soldQty, l.product.unitsPerPack, l.product.sellByUnit)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card className="print:shadow-none">
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>
                Clients concernés{' '}
                <Badge variant={data.customers.length > 0 ? 'orange' : 'gray'}>
                  {data.customers.length}
                </Badge>
              </CardTitle>
              {data.customers.length > 0 && (
                <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
                  <Printer /> Imprimer la liste
                </Button>
              )}
            </CardHeader>
            {data.customers.length === 0 ? (
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Aucun client n’a reçu d’unité de ce lot (ou tout a été retourné).
                </p>
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Client</TH>
                    <TH>Téléphone</TH>
                    <TH>E-mail</TH>
                    <TH className="text-right">Unités reçues</TH>
                    <TH>Factures</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.customers.map((c) => (
                    <TR key={c.clientId}>
                      <TD>
                        <Link to={`/clients/${c.clientId}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>{' '}
                        <span className="text-xs text-muted-foreground">{c.code}</span>
                        {c.isWalkIn && <Badge variant="gray">Comptoir</Badge>}
                      </TD>
                      <TD className="tabular">{c.phone ?? '—'}</TD>
                      <TD>{c.email ?? '—'}</TD>
                      <TD className="text-right tabular">{c.qty}</TD>
                      <TD className="text-xs">
                        {c.sales.map((s) => (
                          <Link
                            key={s.id}
                            to={`/sales/${s.id}`}
                            className="mr-2 font-mono text-primary hover:underline"
                          >
                            {s.number}
                          </Link>
                        ))}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      <Dialog open={blocking} onOpenChange={setBlocking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquer les lots {data?.lotNumber}</DialogTitle>
            <DialogDescription>
              {toBlock.length} lot(s) ne pourront plus être vendus. L’opération est tracée au
              mouchard et notifiée aux administrateurs.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Motif du rappel" required>
            <Textarea
              value={reason}
              placeholder="Ex. Rappel du laboratoire du 12/09 : défaut de conservation"
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlocking(false)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || execute.isPending}
              onClick={() => execute.mutate()}
            >
              {execute.isPending && <Loader2 className="animate-spin" />} Bloquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Réapprovisionnement
// ---------------------------------------------------------------------------

/** Suggestions de réapprovisionnement, groupées par fournisseur habituel. */
export function ReorderPage() {
  const fmt = useFormat();
  const can = useCan();
  const suppliers = useSupplierOptions();
  const [supplierId, setSupplierId] = React.useState('');
  const list = useQuery({
    queryKey: ['reorder', supplierId],
    queryFn: () =>
      api.get<{ items: ReorderItem[]; total: number }>('/reorder-suggestions', {
        query: supplierId ? { supplierId } : {},
      }),
  });
  const groups = React.useMemo(() => {
    const map = new Map<string, { name: string; items: ReorderItem[] }>();
    for (const item of list.data?.items ?? []) {
      const key = item.supplier?.id ?? 'none';
      const group = map.get(key) ?? {
        name: item.supplier?.name ?? 'Sans fournisseur habituel',
        items: [],
      };
      group.items.push(item);
      map.set(key, group);
    }
    return [...map.entries()].map(([key, g]) => ({ key, ...g }));
  }, [list.data]);
  const costs = can('catalog.view_costs');

  return (
    <>
      <PageHeader
        title="Réapprovisionnement"
        description="Produits sous leur point de commande : stock maximum, consommation moyenne et délai fournisseur."
        actions={
          <>
            <NativeSelect
              className="w-56"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              aria-label="Fournisseur"
            >
              <option value="">Tous les fournisseurs</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
              <Printer /> Imprimer
            </Button>
          </>
        }
      />
      {list.isLoading && <Skeleton className="h-64" />}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.total === 0 && (
        <EmptyState
          title="Rien à commander"
          description="Tous les produits suivis ont un stock suffisant."
        />
      )}
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader>
              <CardTitle>
                {g.name} <Badge variant="gray">{g.items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Produit</TH>
                  <TH className="text-right">Stock vendable</TH>
                  <TH className="text-right">Min / Max</TH>
                  <TH className="text-right">Conso. / jour</TH>
                  <TH className="text-right">Couverture</TH>
                  <TH className="text-right">À commander</TH>
                  {costs && <TH className="text-right">Coût estimé HT</TH>}
                </TR>
              </THead>
              <TBody>
                {g.items.map((i) => (
                  <TR key={i.productId}>
                    <TD>
                      <Link to={`/products/${i.productId}`} className="hover:underline">
                        {productLabel(i)}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">{i.internalCode}</span>
                    </TD>
                    <TD className="text-right tabular">
                      {i.sellable === 0 ? (
                        <Badge variant="red">Rupture</Badge>
                      ) : (
                        formatStockQty(i.sellable, i.unitsPerPack, i.sellByUnit)
                      )}
                    </TD>
                    <TD className="text-right tabular">
                      {i.minStock} / {i.maxStock ?? '—'}
                    </TD>
                    <TD className="text-right tabular">{i.avgDaily.toLocaleString('fr-FR')}</TD>
                    <TD className="text-right tabular">
                      {i.daysOfStock === null ? '—' : `${i.daysOfStock.toLocaleString('fr-FR')} j`}
                    </TD>
                    <TD className="text-right font-semibold tabular">
                      {formatStockQty(i.suggestedQty, i.unitsPerPack, i.sellByUnit)}
                    </TD>
                    {costs && (
                      <TD className="text-right tabular">
                        {i.estimatedCostHt === null ? '—' : fmt.money(i.estimatedCostHt)}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}
