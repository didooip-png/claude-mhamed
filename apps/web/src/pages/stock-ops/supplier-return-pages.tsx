import {
  formatStockQty,
  productLabel,
  SUPPLIER_RETURN_REASONS,
  type Paginated,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Loader2, Plus, Printer, Receipt, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField, MoneyInput } from '@/components/form';
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
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useSupplierOptions } from '@/lib/catalog';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import type { LotRow } from '@/lib/types';
import type { ProductLite, SupplierReturnDetail, SupplierReturnRow } from './types';

const STATUS = {
  PENDING_CREDIT: <Badge variant="orange">Avoir fournisseur attendu</Badge>,
  CREDIT_RECEIVED: <Badge variant="green">Avoir reçu</Badge>,
  CANCELLED: <Badge variant="gray">Annulé</Badge>,
} as const;

/** Lot proposé à la sortie (issu de la recherche de lots ou du rappel de lot). */
export interface ReturnableLot {
  id: string;
  lotNumber: string;
  expiryDate: string;
  remainingQty: number;
  product: ProductLite;
}

/** État transmis par le rappel de lot pour préremplir un retour fournisseur. */
export interface SupplierReturnPrefill {
  supplierId?: string;
  reason?: string;
  lots: ReturnableLot[];
}

export const toReturnable = (l: LotRow): ReturnableLot => ({
  id: l.id,
  lotNumber: l.lotNumber,
  expiryDate: l.expiryDate,
  remainingQty: l.remainingQty,
  product: l.product,
});

export function SupplierReturnsPage() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const suppliers = useSupplierOptions();
  const filters = { status: state.filter('status'), supplierId: state.filter('supplierId') };
  const list = useQuery({
    queryKey: ['supplier-returns', 'list', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<SupplierReturnRow> & { pendingCredit: { count: number; totalHt: number } }>(
        '/supplier-returns',
        {
          query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
        },
      ),
    placeholderData: (prev) => prev,
  });
  const columns: Column<SupplierReturnRow>[] = [
    {
      id: 'number',
      header: 'Retour',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
    },
    { id: 'supplier', header: 'Fournisseur', cell: ({ row }) => row.original.supplier.name },
    { id: 'status', header: 'Statut', cell: ({ row }) => STATUS[row.original.status] },
    {
      id: 'total',
      header: 'Montant HT',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.totalHt)}</span>,
    },
    {
      id: 'credit',
      header: 'Avoir reçu',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.creditAmount === null ? (
          '—'
        ) : (
          <span className="tabular">
            {fmt.money(row.original.creditAmount)}{' '}
            <span className="text-xs text-muted-foreground">{row.original.creditReference}</span>
          </span>
        ),
    },
    {
      id: 'reason',
      header: 'Motif',
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-60 text-xs">{row.original.reason}</span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Date',
      cell: ({ row }) => (
        <span className="tabular">
          {fmt.dateTime(row.original.createdAt)}{' '}
          <span className="text-xs text-muted-foreground">{row.original.createdBy?.code}</span>
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Retours fournisseurs"
        description="Lots périmés, défectueux, erreurs de livraison, rappels : sortie du stock et suivi de l’avoir."
        actions={
          <Button asChild>
            <Link to="/supplier-returns/new">
              <Plus /> Nouveau retour
            </Link>
          </Button>
        }
      >
        {list.data && list.data.pendingCredit.count > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {list.data.pendingCredit.count} retour(s) en attente d’avoir fournisseur, pour{' '}
            <strong>{fmt.money(list.data.pendingCredit.totalHt)}</strong> HT au coût.
          </div>
        )}
      </PageHeader>
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="N° de retour, fournisseur, référence d’avoir…"
        onRowClick={(r) => void navigate(`/supplier-returns/${r.id}`)}
        emptyTitle="Aucun retour fournisseur"
        toolbar={
          <>
            <NativeSelect
              className="w-52"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous les statuts</option>
              <option value="PENDING_CREDIT">Avoir attendu</option>
              <option value="CREDIT_RECEIVED">Avoir reçu</option>
              <option value="CANCELLED">Annulés</option>
            </NativeSelect>
            <NativeSelect
              className="w-52"
              value={filters.supplierId}
              onChange={(e) => state.update({ supplierId: e.target.value })}
              aria-label="Fournisseur"
            >
              <option value="">Tous les fournisseurs</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />
    </>
  );
}

interface DraftLine {
  lot: ReturnableLot;
  qty: string;
  reason: string;
}

export function NewSupplierReturnPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const suppliers = useSupplierOptions();
  const prefill = (useLocation().state as { prefill?: SupplierReturnPrefill } | null)?.prefill;
  const [supplierId, setSupplierId] = React.useState(prefill?.supplierId ?? '');
  const [reasonKey, setReasonKey] = React.useState<string>(prefill ? 'RECALL' : 'EXPIRED');
  const [reason, setReason] = React.useState(prefill?.reason ?? '');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>(
    (prefill?.lots ?? []).map((lot) => ({
      lot,
      qty: String(lot.remainingQty),
      reason: prefill?.reason ?? '',
    })),
  );
  const [busy, setBusy] = React.useState(false);

  const reasonText = (key: string) =>
    SUPPLIER_RETURN_REASONS[key as keyof typeof SUPPLIER_RETURN_REASONS] ?? '';
  const submit = async () => {
    if (!supplierId) return toast.error('Choisissez le fournisseur.');
    if (lines.length === 0) return toast.error('Ajoutez au moins un lot.');
    const payload = lines.map((l) => ({
      lotId: l.lot.id,
      qty: Number(l.qty),
      reason: l.reason.trim() || reason.trim(),
    }));
    if (payload.some((l) => !Number.isInteger(l.qty) || l.qty <= 0))
      return toast.error('Quantités invalides.');
    setBusy(true);
    try {
      const ret = await api.post<SupplierReturnDetail>('/supplier-returns', {
        supplierId,
        reason,
        notes: notes || undefined,
        lines: payload,
      });
      toast.success(`Retour ${ret.number} enregistré : le stock est mis à jour`);
      void qc.invalidateQueries({ queryKey: ['supplier-returns'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void navigate(`/supplier-returns/${ret.id}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nouveau retour fournisseur"
        description="Les quantités sont retirées du stock dès l’enregistrement."
        actions={
          <Button variant="outline" asChild>
            <Link to="/supplier-returns">
              <ArrowLeft /> Retours fournisseurs
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Lots retournés</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LotPicker
              supplierId={supplierId || undefined}
              excludeIds={lines.map((l) => l.lot.id)}
              placeholder={
                supplierId ? 'Lot de ce fournisseur…' : 'Choisissez d’abord le fournisseur…'
              }
              onSelect={(lot) =>
                setLines((prev) => [
                  ...prev,
                  { lot: toReturnable(lot), qty: String(lot.remainingQty), reason: reason },
                ])
              }
            />
            {lines.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Produit</TH>
                    <TH>Lot</TH>
                    <TH className="text-right">En stock</TH>
                    <TH className="w-28 text-right">Quantité</TH>
                    <TH>Motif de la ligne</TH>
                    <TH className="w-10" />
                  </TR>
                </THead>
                <TBody>
                  {lines.map((l, i) => (
                    <TR key={l.lot.id}>
                      <TD>{productLabel(l.lot.product)}</TD>
                      <TD className="font-mono text-xs">{l.lot.lotNumber}</TD>
                      <TD className="text-right tabular">
                        {formatStockQty(
                          l.lot.remainingQty,
                          l.lot.product.unitsPerPack,
                          l.lot.product.sellByUnit,
                        )}
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          min={1}
                          className="h-8 w-24 text-right tabular"
                          value={l.qty}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                            )
                          }
                        />
                      </TD>
                      <TD>
                        <Input
                          className="h-8"
                          value={l.reason}
                          placeholder={reason}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)),
                            )
                          }
                        />
                      </TD>
                      <TD>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Retirer"
                          onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <Trash2 />
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <FormField label="Fournisseur" required>
              <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— Choisir —</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Nature du retour">
              <NativeSelect
                value={reasonKey}
                onChange={(e) => {
                  setReasonKey(e.target.value);
                  if (e.target.value !== 'OTHER') setReason(reasonText(e.target.value));
                }}
              >
                {Object.entries(SUPPLIER_RETURN_REASONS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Motif" required>
              <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            <FormField label="Remarques">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
            <Button
              onClick={() => void submit()}
              disabled={busy || !supplierId || lines.length === 0 || reason.trim().length < 3}
            >
              {busy && <Loader2 className="animate-spin" />} Enregistrer le retour
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function SupplierReturnDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [crediting, setCrediting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [amount, setAmount] = React.useState<number | null>(null);
  const [reference, setReference] = React.useState('');
  const [cancelReason, setCancelReason] = React.useState('');
  const ret = useQuery({
    queryKey: ['supplier-returns', id],
    queryFn: () => api.get<SupplierReturnDetail>(`/supplier-returns/${id}`),
    enabled: !!id,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['supplier-returns'] });
    void qc.invalidateQueries({ queryKey: ['stock'] });
  };
  const credit = useMutation({
    mutationFn: () => api.post(`/supplier-returns/${id}/credit`, { amount, reference }),
    onSuccess: () => {
      toast.success('Avoir fournisseur enregistré');
      setCrediting(false);
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/supplier-returns/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      toast.success('Retour annulé : les lots sont réintégrés au stock');
      setCancelling(false);
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  if (ret.error) return <ErrorState error={ret.error} onRetry={() => void ret.refetch()} />;
  if (!ret.data) return <Skeleton className="h-96" />;
  const r = ret.data;
  const pending = r.status === 'PENDING_CREDIT';
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Retour fournisseur {r.number} {STATUS[r.status]}
          </span>
        }
        description={`Le ${fmt.dateTime(r.createdAt)} par ${r.createdBy?.code ?? ''} — ${r.supplier.name}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/supplier-returns">
                <ArrowLeft /> Retours
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void api
                  .blob(`/supplier-returns/${r.id}/print`)
                  .then((pdf) => platform.preview(pdf))
                  .catch((e: unknown) => toast.error(errorText(e)))
              }
            >
              <Printer /> Bon de retour
            </Button>
            {pending && (
              <>
                <Button variant="outline" onClick={() => setCancelling(true)}>
                  <Ban /> Annuler
                </Button>
                <Button onClick={() => setCrediting(true)}>
                  <Receipt /> Avoir reçu
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Lots retournés</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH>Lot</TH>
                <TH className="text-right">Quantité</TH>
                <TH className="text-right">Coût unit. HT</TH>
                <TH className="text-right">Montant HT</TH>
                <TH>Motif</TH>
              </TR>
            </THead>
            <TBody>
              {r.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.product ? productLabel(l.product) : '—'}</TD>
                  <TD className="font-mono text-xs">
                    {l.lot?.lotNumber}
                    {l.lot && (
                      <div className="font-sans text-muted-foreground">
                        exp. {fmt.isoDate(l.lot.expiryDate)}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right tabular">
                    {l.product
                      ? formatStockQty(l.qty, l.product.unitsPerPack, l.product.sellByUnit)
                      : l.qty}
                  </TD>
                  <TD className="text-right tabular">{fmt.amount(l.unitCostHt)}</TD>
                  <TD className="text-right tabular">{fmt.amount(l.amountHt)}</TD>
                  <TD className="text-xs">{l.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4">
              <div className="flex justify-between text-base font-semibold">
                <span>Total HT (au coût)</span>
                <span className="tabular">{fmt.money(r.totalHt)}</span>
              </div>
              {r.creditAmount !== null && (
                <>
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                    <span>Avoir reçu</span>
                    <span className="tabular">{fmt.money(r.creditAmount)}</span>
                  </div>
                  <Field label="Référence de l’avoir">{r.creditReference}</Field>
                  {r.creditReceivedAt && (
                    <Field label="Reçu le">{fmt.dateTime(r.creditReceivedAt)}</Field>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4">
              <Field label="Fournisseur">
                {r.supplier.name} ({r.supplier.code})
              </Field>
              <Field label="Motif">{r.reason}</Field>
              {r.notes && <Field label="Remarques">{r.notes}</Field>}
              {can('audit.view') && (
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to={`/audit?entityId=${r.id}`}>Historique au mouchard</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={crediting} onOpenChange={setCrediting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Avoir fournisseur reçu</DialogTitle>
            <DialogDescription>
              Retour {r.number} de {fmt.money(r.totalHt)} HT.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <FormField label="Montant de l’avoir" required>
              <MoneyInput value={amount} onValueChange={setAmount} />
            </FormField>
            <FormField label="Référence de l’avoir" required>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrediting(false)}>
              Annuler
            </Button>
            <Button
              disabled={!amount || amount <= 0 || !reference.trim() || credit.isPending}
              onClick={() => credit.mutate()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler le retour {r.number}</DialogTitle>
            <DialogDescription>
              Les lots sont réintégrés au stock par un mouvement de correction.
            </DialogDescription>
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
              Annuler le retour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
