import {
  PURCHASE_ORDER_STATUSES,
  productLabel,
  type Paginated,
  type PurchaseOrderStatus,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCheck,
  Loader2,
  Mail,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  Send,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField, MoneyInput } from '@/components/form';
import { ErrorState, Field, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/product-picker';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
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
import type { Product } from '@/lib/types';

interface OrderRow {
  id: string;
  number: string | null;
  status: PurchaseOrderStatus;
  supplier: { id: string; code: string; name: string };
  expectedDate: string | null;
  totalHt: number;
  lineCount: number;
  receivedPercent: number;
  createdAt: string;
  sentAt: string | null;
}

interface OrderDetail {
  id: string;
  number: string | null;
  status: PurchaseOrderStatus;
  supplier: { id: string; code: string; name: string; email: string | null; phone: string | null };
  expectedDate: string | null;
  notes: string | null;
  totalHt: number;
  version: number;
  createdAt: string;
  createdBy: { code: string; fullName: string } | null;
  sentAt: string | null;
  sentBy: { code: string } | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: {
    id: string;
    product: {
      id: string;
      internalCode: string;
      name: string;
      dosage: string | null;
      form: string | null;
      unitsPerPack: number;
      sellByUnit: boolean;
      refPurchasePriceHt: number;
      tvaRateBp: number;
    };
    qty: number;
    receivedQty: number;
    remainingQty: number;
    unitPriceHt: number;
    lineTotalHt: number;
  }[];
  receipts: {
    id: string;
    number: string | null;
    status: string;
    receivedAt: string;
    totalHt: number;
  }[];
}

const STATUS_BADGE: Record<PurchaseOrderStatus, BadgeVariant> = {
  DRAFT: 'gray',
  SENT: 'blue',
  PARTIALLY_RECEIVED: 'orange',
  RECEIVED: 'green',
  CANCELLED: 'red',
};

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge variant={STATUS_BADGE[status]}>{PURCHASE_ORDER_STATUSES[status]}</Badge>;
}

async function openPdf(id: string) {
  const pdf = await api.blob(`/purchase-orders/${id}/print`);
  platform.preview(pdf);
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

export function PurchaseOrdersPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const state = useTableState();
  const suppliers = useSupplierOptions();
  const filters = { status: state.filter('status'), supplierId: state.filter('supplierId') };
  const list = useQuery({
    queryKey: ['purchase-orders', 'list', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<OrderRow>>('/purchase-orders', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<OrderRow>[] = [
    {
      id: 'number',
      header: 'Commande',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.number ?? 'brouillon'}</span>
      ),
    },
    { id: 'supplier', header: 'Fournisseur', cell: ({ row }) => row.original.supplier.name },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'lines',
      header: 'Produits',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.lineCount,
    },
    {
      id: 'total',
      header: 'Total HT estimé',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.totalHt)}</span>,
    },
    {
      id: 'progress',
      header: 'Reçu',
      meta: { align: 'right' },
      cell: ({ row }) =>
        ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(row.original.status) ? (
          <span className="tabular">{row.original.receivedPercent} %</span>
        ) : (
          '—'
        ),
    },
    {
      id: 'expected',
      header: 'Livraison souhaitée',
      cell: ({ row }) => (row.original.expectedDate ? fmt.isoDate(row.original.expectedDate) : '—'),
    },
    {
      id: 'createdAt',
      header: 'Créée le',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.createdAt)}</span>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Commandes fournisseurs"
        description="Bons de commande, suivi des livraisons et réceptions rattachées."
        actions={
          can('orders.manage') && (
            <>
              <Button variant="outline" asChild>
                <Link to="/reorder">Suggestions</Link>
              </Button>
              <Button asChild>
                <Link to="/purchase-orders/new">
                  <Plus /> Nouvelle commande
                </Link>
              </Button>
            </>
          )
        }
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="N° de commande, fournisseur…"
        onRowClick={(r) => void navigate(`/purchase-orders/${r.id}`)}
        emptyTitle="Aucune commande"
        toolbar={
          <>
            <NativeSelect
              className="w-52"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous les statuts</option>
              {Object.entries(PURCHASE_ORDER_STATUSES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
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

// ---------------------------------------------------------------------------
// Saisie d'un brouillon
// ---------------------------------------------------------------------------

interface DraftLine {
  key: string;
  productId: string;
  label: string;
  code: string;
  qty: string;
  unitPriceHt: number | null;
}

export function PurchaseOrderEditPage() {
  const { id } = useParams();
  const existing = useQuery({
    queryKey: ['purchase-orders', id],
    queryFn: () => api.get<OrderDetail>(`/purchase-orders/${id}`),
    enabled: !!id,
  });
  if (id && existing.error)
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  if (id && !existing.data) return <Skeleton className="h-96" />;
  if (existing.data && existing.data.status !== 'DRAFT')
    return <ErrorState error={new Error('Cette commande n’est plus modifiable.')} />;
  return <OrderEditor order={existing.data ?? null} />;
}

function OrderEditor({ order }: { order: OrderDetail | null }) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const suppliers = useSupplierOptions();
  const [supplierId, setSupplierId] = React.useState(order?.supplier.id ?? '');
  const [expectedDate, setExpectedDate] = React.useState(order?.expectedDate ?? '');
  const [notes, setNotes] = React.useState(order?.notes ?? '');
  const [lines, setLines] = React.useState<DraftLine[]>(
    () =>
      order?.lines.map((l) => ({
        key: l.id,
        productId: l.product.id,
        label: productLabel(l.product),
        code: l.product.internalCode,
        qty: String(l.qty),
        unitPriceHt: l.unitPriceHt,
      })) ?? [],
  );
  const [busy, setBusy] = React.useState(false);

  const addProduct = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) {
      toast.info('Ce produit figure déjà dans la commande.');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: p.id,
        label: productLabel(p),
        code: p.internalCode,
        qty: '1',
        unitPriceHt: p.refPurchasePriceHt ?? 0,
      },
    ]);
  };
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * (l.unitPriceHt ?? 0), 0);

  const save = async (): Promise<string | null> => {
    if (!supplierId) {
      toast.error('Choisissez le fournisseur.');
      return null;
    }
    if (
      lines.length === 0 ||
      lines.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0)
    ) {
      toast.error('Ajoutez des produits avec des quantités valides.');
      return null;
    }
    const body = {
      supplierId,
      expectedDate: expectedDate || null,
      notes: notes || undefined,
      version: order?.version,
      lines: lines.map((l) => ({
        productId: l.productId,
        qty: Number(l.qty),
        unitPriceHt: l.unitPriceHt ?? 0,
      })),
    };
    setBusy(true);
    try {
      const saved = order
        ? await api.put<OrderDetail>(`/purchase-orders/${order.id}`, body)
        : await api.post<OrderDetail>('/purchase-orders', body);
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      return saved.id;
    } catch (err) {
      toast.error(errorText(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={order ? 'Modifier la commande' : 'Nouvelle commande fournisseur'}
        description="Brouillon : le numéro est attribué à l’envoi."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/purchase-orders">
                <ArrowLeft /> Commandes
              </Link>
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void save().then((savedId) => {
                  if (savedId) {
                    toast.success('Brouillon enregistré');
                    void navigate(`/purchase-orders/${savedId}`);
                  }
                })
              }
            >
              {busy && <Loader2 className="animate-spin" />} Enregistrer
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Produits commandés</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ProductPicker
              mode="purchase"
              onSelect={addProduct}
              placeholder="Ajouter un produit (nom, code, code-barres)…"
            />
            {lines.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Produit</TH>
                    <TH className="w-28 text-right">Quantité</TH>
                    <TH className="w-40 text-right">Prix HT estimé</TH>
                    <TH className="w-32 text-right">Total HT</TH>
                    <TH className="w-10" />
                  </TR>
                </THead>
                <TBody>
                  {lines.map((l, i) => (
                    <TR key={l.key}>
                      <TD>
                        {l.label} <span className="text-xs text-muted-foreground">{l.code}</span>
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
                        <MoneyInput
                          value={l.unitPriceHt}
                          onValueChange={(v) =>
                            setLines((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, unitPriceHt: v } : x)),
                            )
                          }
                        />
                      </TD>
                      <TD className="text-right tabular">
                        {fmt.amount(Number(l.qty || 0) * (l.unitPriceHt ?? 0))}
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
            <FormField label="Livraison souhaitée">
              <Input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </FormField>
            <FormField label="Remarques">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
            <div className="flex justify-between border-t pt-3 text-base font-semibold">
              <span>Total HT estimé</span>
              <span className="tabular">{fmt.money(total)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fiche
// ---------------------------------------------------------------------------

function SendDialog({
  order,
  resend,
  onClose,
}: {
  order: OrderDetail;
  resend: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['email', 'status'],
    queryFn: () => api.get<{ operational: boolean }>('/email/status'),
    staleTime: 60_000,
  });
  const [to, setTo] = React.useState(order.supplier.email ?? '');
  const [cc, setCc] = React.useState('');
  const [message, setMessage] = React.useState('');
  const split = (v: string) =>
    v
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const send = useMutation({
    mutationFn: () =>
      api.post(`/purchase-orders/${order.id}/${resend ? 'email' : 'send'}`, {
        to: split(to),
        cc: split(cc),
        message: message || undefined,
      }),
    onSuccess: () => {
      toast.success(resend ? 'Bon de commande envoyé par e-mail' : 'Commande envoyée');
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const operational = status.data?.operational ?? false;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {resend ? 'Renvoyer le bon de commande' : 'Envoyer la commande'}
          </DialogTitle>
          <DialogDescription>
            {resend
              ? 'Le bon de commande est joint en PDF.'
              : 'La commande reçoit son numéro et devient non modifiable. Le fournisseur reçoit le bon en PDF si une adresse est indiquée ; sinon, imprimez-le ou transmettez-le par téléphone.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {!operational && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              L’envoi d’e-mails n’est pas configuré : seule la validation est possible.
            </p>
          )}
          <FormField
            label="Destinataire(s)"
            hint="Séparés par une virgule. Laissez vide pour ne pas envoyer d’e-mail."
          >
            <Input
              type="text"
              value={to}
              disabled={!operational}
              onChange={(e) => setTo(e.target.value)}
            />
          </FormField>
          <FormField label="Copie">
            <Input value={cc} disabled={!operational} onChange={(e) => setCc(e.target.value)} />
          </FormField>
          <FormField label="Message">
            <Textarea
              value={message}
              disabled={!operational}
              onChange={(e) => setMessage(e.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={send.isPending || (resend && split(to).length === 0)}
          >
            {send.isPending && <Loader2 className="animate-spin" />}{' '}
            {resend
              ? 'Envoyer'
              : split(to).length > 0 && operational
                ? 'Valider et envoyer'
                : 'Valider la commande'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [sending, setSending] = React.useState<'send' | 'resend' | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const order = useQuery({
    queryKey: ['purchase-orders', id],
    queryFn: () => api.get<OrderDetail>(`/purchase-orders/${id}`),
    enabled: !!id,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
  const close = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${id}/close`),
    onSuccess: () => {
      toast.success('Commande clôturée');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Commande annulée');
      setCancelling(false);
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  if (order.error) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  if (!order.data) return <Skeleton className="h-96" />;
  const o = order.data;
  const manage = can('orders.manage');
  const receivable = o.status === 'SENT' || o.status === 'PARTIALLY_RECEIVED';
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Commande {o.number ?? '(brouillon)'} <StatusBadge status={o.status} />
          </span>
        }
        description={`${o.supplier.name} — créée le ${fmt.dateTime(o.createdAt)} par ${o.createdBy?.code ?? ''}${o.sentAt ? ` · envoyée le ${fmt.dateTime(o.sentAt)}` : ''}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/purchase-orders">
                <ArrowLeft /> Commandes
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => void openPdf(o.id).catch((e: unknown) => toast.error(errorText(e)))}
            >
              <Printer /> Bon de commande
            </Button>
            {manage && o.status === 'DRAFT' && (
              <>
                <Button variant="outline" asChild>
                  <Link to={`/purchase-orders/${o.id}/edit`}>
                    <Pencil /> Modifier
                  </Link>
                </Button>
                <Button onClick={() => setSending('send')}>
                  <Send /> Envoyer
                </Button>
              </>
            )}
            {manage && o.number && o.status !== 'CANCELLED' && (
              <Button variant="outline" onClick={() => setSending('resend')}>
                <Mail /> E-mail
              </Button>
            )}
            {receivable && (
              <Button asChild>
                <Link to={`/receipts/new?orderId=${o.id}`}>
                  <PackageCheck /> Réceptionner
                </Link>
              </Button>
            )}
            {manage && receivable && (
              <Button variant="outline" onClick={() => close.mutate()} disabled={close.isPending}>
                <CheckCheck /> Clôturer
              </Button>
            )}
            {manage && o.status !== 'CANCELLED' && o.status !== 'RECEIVED' && (
              <Button variant="destructive" onClick={() => setCancelling(true)}>
                <Ban /> Annuler
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Produits</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH className="text-right">Commandé</TH>
                <TH className="text-right">Reçu</TH>
                <TH className="text-right">Reste</TH>
                <TH className="text-right">Prix HT estimé</TH>
                <TH className="text-right">Total HT</TH>
              </TR>
            </THead>
            <TBody>
              {o.lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <Link to={`/products/${l.product.id}`} className="hover:underline">
                      {productLabel(l.product)}
                    </Link>{' '}
                    <span className="text-xs text-muted-foreground">{l.product.internalCode}</span>
                  </TD>
                  <TD className="text-right tabular">{l.qty}</TD>
                  <TD className="text-right tabular">
                    {l.receivedQty > l.qty ? (
                      <Badge variant="orange">{l.receivedQty}</Badge>
                    ) : (
                      l.receivedQty
                    )}
                  </TD>
                  <TD className="text-right tabular">
                    {l.remainingQty === 0 ? <Badge variant="green">Soldé</Badge> : l.remainingQty}
                  </TD>
                  <TD className="text-right tabular">{fmt.amount(l.unitPriceHt)}</TD>
                  <TD className="text-right tabular">{fmt.amount(l.lineTotalHt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4">
              <div className="flex justify-between text-base font-semibold">
                <span>Total HT estimé</span>
                <span className="tabular">{fmt.money(o.totalHt)}</span>
              </div>
              <Field label="Fournisseur">
                {o.supplier.name} ({o.supplier.code})
              </Field>
              {o.supplier.phone && <Field label="Téléphone">{o.supplier.phone}</Field>}
              {o.expectedDate && (
                <Field label="Livraison souhaitée">{fmt.isoDate(o.expectedDate)}</Field>
              )}
              {o.notes && <Field label="Remarques">{o.notes}</Field>}
              {o.cancelReason && <Field label="Motif de l’annulation">{o.cancelReason}</Field>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Réceptions rattachées</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {o.receipts.length === 0 && (
                <p className="text-muted-foreground">Aucune réception.</p>
              )}
              {o.receipts.map((r) => (
                <Link
                  key={r.id}
                  to={`/receipts/${r.id}`}
                  className="flex items-center justify-between rounded-md border px-2 py-1.5 hover:bg-accent"
                >
                  <span className="font-mono text-xs">{r.number ?? 'brouillon'}</span>
                  <span className="text-xs text-muted-foreground">{fmt.isoDate(r.receivedAt)}</span>
                  <span className="tabular">{fmt.money(r.totalHt)}</span>
                  {r.status === 'CANCELLED' && <Badge variant="red">Annulée</Badge>}
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
      {sending && (
        <SendDialog order={o} resend={sending === 'resend'} onClose={() => setSending(null)} />
      )}
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler la commande</DialogTitle>
            <DialogDescription>La commande reste consultable dans l’historique.</DialogDescription>
          </DialogHeader>
          <FormField label="Motif" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Retour
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Annuler la commande
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
