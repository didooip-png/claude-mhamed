import {
  CANCEL_REASONS,
  computeSaleTotals,
  formatStockQty,
  PAYMENT_METHODS,
  productLabel,
  type OverrideInput,
  type Paginated,
} from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Clock,
  FileText,
  History,
  Mail,
  Pencil,
  Plus,
  Printer,
  ShoppingCart,
  Trash2,
  Undo2,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField, MoneyInput } from '@/components/form';
import { isOverrideCancelled, withOverride } from '@/components/override-dialog';
import { EmptyState, ErrorState, Field, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/product-picker';
import { SendEmailDialog } from '@/components/send-email-dialog';
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
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { ClientSearch } from './pos-client';
import type { ReturnRow } from '@/pages/returns/return-types';
import { PAYMENT_STATUS_LABELS, type OnHoldSale, type SaleView } from './sale-types';

interface SaleRow {
  id: string;
  number: string;
  status: 'VALIDATED' | 'CANCELLED';
  paymentStatus: keyof typeof PAYMENT_STATUS_LABELS;
  returnStatus: string;
  validatedAt: string;
  cancelledAt: string | null;
  totalTtc: number;
  amountDue: number;
  totalDiscount: number;
  lineCount: number;
  client: { id: string; code: string; name: string; isWalkIn: boolean } | null;
  validatedBy: { code: string; fullName: string } | null;
  device: string | null;
  replacesSaleId: string | null;
  replacedBy: { id: string; number: string } | null;
}

export function SaleStatusBadge({
  status,
  paymentStatus,
}: {
  status: string;
  paymentStatus?: keyof typeof PAYMENT_STATUS_LABELS;
}) {
  if (status === 'CANCELLED') return <Badge variant="red">Annulée</Badge>;
  if (status === 'DRAFT') return <Badge variant="yellow">Panier</Badge>;
  if (status === 'ON_HOLD') return <Badge variant="orange">En attente</Badge>;
  if (!paymentStatus) return <Badge variant="green">Validée</Badge>;
  return (
    <Badge
      variant={
        paymentStatus === 'PAID'
          ? 'green'
          : paymentStatus === 'PARTIALLY_PAID'
            ? 'yellow'
            : 'orange'
      }
    >
      {PAYMENT_STATUS_LABELS[paymentStatus]}
    </Badge>
  );
}

async function openPdf(id: string, format: 'TICKET' | 'A4', print: boolean) {
  const pdf = await api.blob(`/sales/${id}/print`, { query: { format } });
  if (print) await platform.print(pdf, { format });
  else platform.preview(pdf);
}

/** Historique des ventes (§6.6) : recherche par numéro, client, période, utilisateur, produit, statut, montant. */
export function SalesPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const state = useTableState({ sort: 'validatedAt:desc' });
  const filters = {
    status: state.filter('status'),
    paymentStatus: state.filter('paymentStatus'),
    userId: state.filter('userId'),
    from: state.filter('from'),
    to: state.filter('to'),
    clientId: state.filter('clientId'),
    productId: state.filter('productId'),
  };
  const users = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => api.get<{ id: string; code: string; fullName: string }[]>('/users/directory'),
    enabled: can('sales.view_all'),
    staleTime: 300_000,
  });
  const list = useQuery({
    queryKey: ['sales', 'list', state.page, state.pageSize, state.q, state.sort, filters],
    queryFn: () =>
      api.get<Paginated<SaleRow> & { totals: { totalTtc: number; amountDue: number } }>('/sales', {
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
  const columns: Column<SaleRow>[] = [
    {
      id: 'number',
      header: 'N° facture',
      enableSorting: true,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
    },
    {
      id: 'validatedAt',
      header: 'Date',
      enableSorting: true,
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.validatedAt)}</span>,
    },
    {
      id: 'client',
      header: 'Client',
      cell: ({ row }) => row.original.client?.name ?? '—',
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          <SaleStatusBadge
            status={row.original.status}
            paymentStatus={row.original.paymentStatus}
          />
          {row.original.replacedBy && <Badge variant="gray">Remplacée</Badge>}
          {row.original.replacesSaleId && <Badge variant="blue">Modification</Badge>}
        </div>
      ),
    },
    {
      id: 'lines',
      header: 'Lignes',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.lineCount,
    },
    {
      id: 'totalTtc',
      header: 'Total TTC',
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span
          className={cn(
            'tabular',
            row.original.status === 'CANCELLED' && 'text-muted-foreground line-through',
          )}
        >
          {fmt.money(row.original.totalTtc)}
        </span>
      ),
    },
    {
      id: 'due',
      header: 'Reste dû',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.amountDue > 0 ? (
          <span className="text-destructive tabular">{fmt.money(row.original.amountDue)}</span>
        ) : (
          '—'
        ),
    },
    {
      id: 'by',
      header: 'Vendeur',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.validatedBy?.code ?? ''}</span>
      ),
    },
    {
      id: 'device',
      header: 'Poste',
      meta: { hideable: true },
      cell: ({ row }) => row.original.device ?? '',
    },
  ];
  return (
    <>
      <PageHeader
        title="Historique des ventes"
        description={
          can('sales.view_all')
            ? 'Toutes les ventes validées et annulées.'
            : 'Vos ventes validées et annulées.'
        }
        actions={
          can('sales.create') && (
            <Button asChild>
              <Link to="/pos">
                <ShoppingCart /> Nouvelle vente
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
        onRetry={() => void list.refetch()}
        state={state}
        searchPlaceholder="N° de facture, client, téléphone…"
        onRowClick={(r) => void navigate(`/sales/${r.id}`)}
        footer={
          list.data && (
            <TR>
              <TD colSpan={columns.length}>
                <div className="flex flex-wrap justify-end gap-4 text-sm">
                  <span>
                    Total des ventes validées :{' '}
                    <strong className="tabular">{fmt.money(list.data.totals.totalTtc)}</strong>
                  </span>
                  <span>
                    Reste dû :{' '}
                    <strong className="tabular">{fmt.money(list.data.totals.amountDue)}</strong>
                  </span>
                </div>
              </TD>
            </TR>
          )
        }
        toolbar={
          <>
            <NativeSelect
              className="w-36"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous statuts</option>
              <option value="VALIDATED">Validées</option>
              <option value="CANCELLED">Annulées</option>
            </NativeSelect>
            <NativeSelect
              className="w-44"
              value={filters.paymentStatus}
              onChange={(e) => state.update({ paymentStatus: e.target.value })}
              aria-label="Paiement"
            >
              <option value="">Tous paiements</option>
              {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            {users.data && (
              <NativeSelect
                className="w-44"
                value={filters.userId}
                onChange={(e) => state.update({ userId: e.target.value })}
                aria-label="Vendeur"
              >
                <option value="">Tous vendeurs</option>
                {users.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.fullName}
                  </option>
                ))}
              </NativeSelect>
            )}
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
            <div className="w-64">
              <ProductPicker
                placeholder={
                  filters.productId
                    ? 'Produit filtré — rechercher un autre'
                    : 'Filtrer par produit…'
                }
                onSelect={(p) => state.update({ productId: p.id })}
              />
            </div>
            {(filters.productId || filters.clientId) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => state.update({ productId: null, clientId: null })}
              >
                Retirer le filtre produit / client
              </Button>
            )}
          </>
        }
      />
    </>
  );
}

/** Ventes en attente (visibles de tous les postes). */
export function OnHoldPage() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['sales', 'on-hold'],
    queryFn: () => api.get<OnHoldSale[]>('/sales/on-hold'),
    refetchInterval: 30_000,
  });
  const resume = async (id: string) => {
    try {
      const current = await api.get<{ sale: SaleView | null }>('/sales/draft');
      if (current.sale && current.sale.id !== id) {
        if (current.sale.lines.length > 0) {
          await api.post(`/sales/${current.sale.id}/hold`);
          toast.info('Votre panier en cours a été mis en attente.');
        } else await api.post(`/sales/${current.sale.id}/discard`);
      }
      await api.post(`/sales/${id}/resume`);
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void navigate('/pos');
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const discard = async (id: string) => {
    try {
      await api.post(`/sales/${id}/discard`);
      toast.success('Vente en attente abandonnée (tracé au mouchard).');
      void list.refetch();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <>
      <PageHeader
        title="Ventes en attente"
        description="Ventes mises de côté (F8) depuis n’importe quel poste. La vente reprise devient votre panier."
      />
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-40" />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<Clock />} title="Aucune vente en attente" />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Mise en attente</TH>
                <TH>Par</TH>
                <TH>Client</TH>
                <TH className="text-right">Lignes</TH>
                <TH className="text-right">Montant estimé</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {list.data.map((h) => (
                <TR key={h.id}>
                  <TD className="tabular">{fmt.dateTime(h.heldAt)}</TD>
                  <TD className="font-mono text-xs">{h.heldBy}</TD>
                  <TD>{h.client?.name ?? '—'}</TD>
                  <TD className="text-right tabular">{h.lineCount}</TD>
                  <TD className="text-right tabular">{fmt.money(h.estimatedTotal)}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" onClick={() => void resume(h.id)}>
                        Reprendre
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => void discard(h.id)}
                      >
                        Abandonner
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}

interface EmailRow {
  id: string;
  kind: string;
  to: string[];
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export const EMAIL_STATUS: Record<
  EmailRow['status'],
  { label: string; variant: 'gray' | 'blue' | 'green' | 'red' | 'yellow' }
> = {
  QUEUED: { label: 'En file', variant: 'yellow' },
  SENDING: { label: 'En cours', variant: 'blue' },
  SENT: { label: 'Envoyé', variant: 'green' },
  FAILED: { label: 'Échec', variant: 'red' },
  CANCELLED: { label: 'Annulé', variant: 'gray' },
};

/** Détail complet d'une vente : lignes, lots sortis, paiements, e-mails, annulation / modification. */
export function SaleDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [dialog, setDialog] = React.useState<'cancel' | 'modify' | 'email' | null>(null);
  const sale = useQuery({
    queryKey: ['sales', id],
    queryFn: () => api.get<SaleView>(`/sales/${id}`),
    enabled: !!id,
  });
  const emails = useQuery({
    queryKey: ['sales', id, 'emails'],
    queryFn: () => api.get<EmailRow[]>(`/sales/${id}/emails`),
    enabled: !!id,
  });
  const emailStatus = useQuery({
    queryKey: ['email', 'status'],
    queryFn: () => api.get<{ operational: boolean }>('/email/status'),
    staleTime: 60_000,
  });
  const returns = useQuery({
    queryKey: ['returns', 'sale', id],
    queryFn: () =>
      api.get<Paginated<ReturnRow>>('/returns', { query: { saleId: id, pageSize: 50 } }),
    enabled: !!id && can('returns.create'),
  });
  if (sale.error) return <ErrorState error={sale.error} onRetry={() => void sale.refetch()} />;
  if (!sale.data) return <Skeleton className="h-96" />;
  const s = sale.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sales'] });
  };
  const pdf = (format: 'TICKET' | 'A4', print: boolean) =>
    openPdf(s.id, format, print)
      .then(() => refresh())
      .catch((err: unknown) => toast.error(errorText(err)));
  const editable = s.status === 'VALIDATED' && s.returnStatus === 'NONE';
  const showCosts = s.totalCost !== null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.number ? `Facture ${s.number}` : 'Vente'}
            <SaleStatusBadge
              status={s.status}
              paymentStatus={s.status === 'VALIDATED' ? s.paymentStatus : undefined}
            />
            {s.printCount > 1 && <Badge variant="gray">Imprimée {s.printCount} fois</Badge>}
          </span>
        }
        description={
          s.validatedAt
            ? `Validée le ${fmt.dateTime(s.validatedAt)} par ${s.validatedBy?.code ?? ''} — ${s.validatedBy?.fullName ?? ''}`
            : undefined
        }
        actions={
          s.number && (
            <>
              <Button variant="outline" onClick={() => void pdf('TICKET', true)}>
                <Printer /> Ticket
              </Button>
              <Button variant="outline" onClick={() => void pdf('A4', false)}>
                <FileText /> Facture A4
              </Button>
              {can('email.send_documents') &&
                emailStatus.data?.operational &&
                s.client &&
                !s.client.isWalkIn && (
                  <Button variant="outline" onClick={() => setDialog('email')}>
                    <Mail />{' '}
                    {emails.data?.some((e) => e.status === 'SENT') ? 'Renvoyer' : 'Envoyer'} par
                    e-mail
                  </Button>
                )}
              {can('returns.create') &&
                s.status === 'VALIDATED' &&
                s.returnStatus !== 'RETURNED' && (
                  <Button variant="outline" asChild>
                    <Link to={`/returns/new?saleId=${s.id}`}>
                      <Undo2 /> Retourner des produits
                    </Link>
                  </Button>
                )}
              {can('sales.modify') && editable && (
                <Button variant="outline" onClick={() => setDialog('modify')}>
                  <Pencil /> Modifier
                </Button>
              )}
              {can('sales.cancel') && editable && (
                <Button variant="destructive" onClick={() => setDialog('cancel')}>
                  <Ban /> Annuler la vente
                </Button>
              )}
            </>
          )
        }
      />
      {s.status === 'CANCELLED' && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <strong>Vente annulée</strong> le {fmt.dateTime(s.cancelledAt)} par {s.cancelledBy?.code}{' '}
          — {s.cancelledBy?.fullName}
          {s.cancelAuthorizedBy && ` (autorisée par ${s.cancelAuthorizedBy.code})`}. Motif :{' '}
          {s.cancelReason}
          {s.replacedBy && (
            <>
              {' '}
              — remplacée par{' '}
              <Link
                className="font-medium text-primary hover:underline"
                to={`/sales/${s.replacedBy.id}`}
              >
                {s.replacedBy.number}
              </Link>
            </>
          )}
        </div>
      )}
      {s.replaces && (
        <div className="mb-4 rounded-lg border bg-sky-50 px-4 py-2 text-sm dark:bg-sky-950/30">
          Cette vente remplace la facture{' '}
          <Link className="font-medium text-primary hover:underline" to={`/sales/${s.replaces.id}`}>
            {s.replaces.number}
          </Link>{' '}
          (modification).
        </div>
      )}
      {!editable && s.status === 'VALIDATED' && s.returnStatus !== 'NONE' && (
        <p className="mb-4 text-sm text-muted-foreground">
          Cette vente a fait l’objet d’un retour : elle ne peut plus être annulée ni modifiée
          (RG-12).
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Lignes</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Produit</TH>
                  <TH>Lots sortis</TH>
                  <TH className="text-right">Qté</TH>
                  <TH className="text-right">PU TTC</TH>
                  <TH className="text-right">Remise</TH>
                  <TH className="text-right">TVA</TH>
                  <TH className="text-right">Total TTC</TH>
                  {showCosts && <TH className="text-right">Coût HT</TH>}
                </TR>
              </THead>
              <TBody>
                {s.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Link
                        to={`/products/${l.product.id}`}
                        className="font-medium hover:underline"
                      >
                        {productLabel(l.product)}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {l.product.internalCode}
                        {l.authorized.price && ' · prix modifié 🔑'}
                        {l.authorized.discount && ' · remise autorisée 🔑'}
                        {l.authorized.lot && ' · lot forcé 🔑'}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex flex-col gap-0.5 text-xs">
                        {l.lots.map((lot) => (
                          <span key={lot.lotId} className="tabular">
                            {lot.lotNumber} · exp. {fmt.isoDate(lot.expiryDate)} ×{' '}
                            {formatStockQty(lot.qty, l.product.unitsPerPack, l.product.sellByUnit)}
                            {lot.returnedQty
                              ? ` (retourné ${formatStockQty(lot.returnedQty, l.product.unitsPerPack, l.product.sellByUnit)})`
                              : ''}
                          </span>
                        ))}
                      </div>
                    </TD>
                    <TD className="text-right tabular">
                      {l.qty}
                      {l.unit === 'UNIT' ? ' u' : ''}
                    </TD>
                    <TD className="text-right tabular">{fmt.amount(l.unitPriceTtc)}</TD>
                    <TD className="text-right tabular">
                      {l.discountBp ? fmt.percent(l.discountBp) : '—'}
                    </TD>
                    <TD className="text-right tabular">{fmt.percent(l.tvaRateBp)}</TD>
                    <TD className="text-right font-medium tabular">{fmt.amount(l.lineTotalTtc)}</TD>
                    {showCosts && (
                      <TD className="text-right text-muted-foreground tabular">
                        {fmt.amount(l.costTotal)}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
              <TFoot>
                {s.totals.taxes.map((t) => (
                  <TR key={t.tvaBp}>
                    <TD colSpan={6} className="text-right text-xs text-muted-foreground">
                      TVA {fmt.percent(t.tvaBp)} — base HT {fmt.money(t.totalHt)}
                    </TD>
                    <TD className="text-right text-xs tabular">{fmt.money(t.totalTva)}</TD>
                    {showCosts && <TD />}
                  </TR>
                ))}
              </TFoot>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Règlements</CardTitle>
            </CardHeader>
            <CardContent>
              {s.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun règlement affecté.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>N°</TH>
                      <TH>Mode</TH>
                      <TH>Date</TH>
                      <TH>Détail</TH>
                      <TH className="text-right">Montant affecté</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {s.payments.map((p, i) => (
                      <TR
                        key={`${p.kind}-${p.id}-${i}`}
                        className={cn(p.cancelledAt && 'text-muted-foreground')}
                      >
                        <TD className="font-mono text-xs">
                          {p.number}
                          {p.cancelledAt && (
                            <Badge
                              variant="gray"
                              className="ml-2"
                              title={`Affectation annulée le ${fmt.dateTime(p.cancelledAt)}`}
                            >
                              affectation annulée
                            </Badge>
                          )}
                        </TD>
                        <TD>{PAYMENT_METHODS[p.method]}</TD>
                        <TD className="tabular">{fmt.dateTime(p.paidAt)}</TD>
                        <TD className="text-xs">
                          {p.chequeNumber && `Chèque n° ${p.chequeNumber} — ${p.bank ?? ''}`}
                          {p.reference && `Réf. ${p.reference}`}
                        </TD>
                        <TD className={cn('text-right tabular', p.cancelledAt && 'line-through')}>
                          {fmt.money(p.amount)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {returns.data && returns.data.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Retours et avoirs</CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <TR>
                    <TH>Retour</TH>
                    <TH>Date</TH>
                    <TH>Avoir</TH>
                    <TH className="text-right">Montant</TH>
                  </TR>
                </THead>
                <TBody>
                  {returns.data.items.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link
                          to={`/returns/${r.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {r.number}
                        </Link>
                      </TD>
                      <TD className="tabular">{fmt.dateTime(r.createdAt)}</TD>
                      <TD className="font-mono text-xs">
                        {r.creditNote?.number ?? (r.refundMode === 'CASH' ? 'Espèces' : '—')}
                      </TD>
                      <TD className="text-right tabular">{fmt.money(r.totalTtc)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}

          {emails.data && emails.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>E-mails</CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Destinataire</TH>
                    <TH>Statut</TH>
                    <TH>Erreur</TH>
                  </TR>
                </THead>
                <TBody>
                  {emails.data.map((e) => (
                    <TR key={e.id}>
                      <TD className="tabular">{fmt.dateTime(e.sentAt ?? e.createdAt)}</TD>
                      <TD>
                        {e.kind === 'INVOICE'
                          ? 'Facture'
                          : e.kind === 'INVOICE_CANCELLED'
                            ? 'Facture annulée'
                            : e.kind}
                      </TD>
                      <TD>{e.to.join(', ')}</TD>
                      <TD>
                        <Badge variant={EMAIL_STATUS[e.status].variant}>
                          {EMAIL_STATUS[e.status].label}
                        </Badge>
                        {e.attempts > 1 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {e.attempts} essais
                          </span>
                        )}
                      </TD>
                      <TD
                        className="max-w-64 truncate text-xs text-destructive"
                        title={e.lastError ?? ''}
                      >
                        {e.lastError}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-1 pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total HT</span>
                <span className="tabular">{fmt.money(s.totals.subtotalHt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">TVA</span>
                <span className="tabular">{fmt.money(s.totals.totalTva)}</span>
              </div>
              {s.totals.totalDiscount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dont remises</span>
                  <span className="tabular">{fmt.money(s.totals.totalDiscount)}</span>
                </div>
              )}
              {s.totals.stampDuty > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timbre fiscal</span>
                  <span className="tabular">{fmt.money(s.totals.stampDuty)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
                <span>Total TTC</span>
                <span className="tabular">{fmt.money(s.totals.totalTtc)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payé</span>
                <span className="tabular">{fmt.money(s.amountPaid)}</span>
              </div>
              <div
                className={cn(
                  'flex justify-between font-medium',
                  s.amountDue > 0 && 'text-destructive',
                )}
              >
                <span>Reste à payer</span>
                <span className="tabular">{fmt.money(s.amountDue)}</span>
              </div>
              {s.dueDate && s.amountDue > 0 && (
                <p className="text-xs text-muted-foreground">
                  Échéance : {fmt.isoDate(s.dueDate.slice(0, 10))}
                </p>
              )}
              {s.changeGiven !== null && s.changeGiven > 0 && (
                <p className="text-xs text-muted-foreground">
                  Espèces remises {fmt.money(s.cashTendered)} · rendu {fmt.money(s.changeGiven)}
                </p>
              )}
              {showCosts && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Coût HT {fmt.money(s.totalCost)} · marge HT{' '}
                  {fmt.money(s.totals.subtotalHt - (s.totalCost ?? 0))}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4">
              <Field label="Client">
                {s.client ? (
                  s.client.isWalkIn ? (
                    'Client comptoir'
                  ) : (
                    <Link
                      to={`/clients/${s.client.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.client.name} ({s.client.code})
                    </Link>
                  )
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Créée le">{fmt.dateTime(s.createdAt)}</Field>
              <Field label="Vendeur">
                {s.validatedBy ? `${s.validatedBy.code} — ${s.validatedBy.fullName}` : '—'}
              </Field>
              {s.creditAuthorizedBy && (
                <Field label="Crédit autorisé par">{s.creditAuthorizedBy.code}</Field>
              )}
              {(s.prescription.prescriberName || s.prescription.prescriptionRef) && (
                <Field label="Ordonnance">
                  {s.prescription.prescriberName} — n° {s.prescription.prescriptionRef}
                  {s.prescription.prescriptionDate &&
                    ` du ${fmt.isoDate(s.prescription.prescriptionDate)}`}
                </Field>
              )}
              {can('audit.view') && (
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to={`/audit?entityId=${s.id}`}>
                    <History /> Historique au mouchard
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === 'cancel' && (
        <CancelSaleDialog sale={s} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === 'modify' && <ModifySaleDialog sale={s} onClose={() => setDialog(null)} />}
      {dialog === 'email' && (
        <SendEmailDialog
          title={`Envoyer la facture ${s.number} par e-mail`}
          endpoint={`/sales/${s.id}/email`}
          client={s.client}
          onClose={() => setDialog(null)}
          onDone={() => {
            void emails.refetch();
          }}
        />
      )}
    </>
  );
}

function ReasonFields({
  reasonCode,
  reason,
  onChange,
}: {
  reasonCode: keyof typeof CANCEL_REASONS;
  reason: string;
  onChange: (patch: { reasonCode?: keyof typeof CANCEL_REASONS; reason?: string }) => void;
}) {
  return (
    <>
      <FormField label="Motif" required>
        <NativeSelect
          value={reasonCode}
          onChange={(e) => onChange({ reasonCode: e.target.value as keyof typeof CANCEL_REASONS })}
          aria-label="Motif"
        >
          {Object.entries(CANCEL_REASONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField
        label="Précisions"
        required
        hint="Enregistrées au mouchard avec l’état complet de la vente."
      >
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          aria-label="Précisions sur le motif"
        />
      </FormField>
    </>
  );
}

/** Annulation (RG-11) : motif obligatoire, stock réintégré dans les lots d'origine, règlements remboursés ou crédités. */
function CancelSaleDialog({
  sale,
  onClose,
  onDone,
}: {
  sale: SaleView;
  onClose: () => void;
  onDone: () => void;
}) {
  const fmt = useFormat();
  const [reasonCode, setReasonCode] =
    React.useState<keyof typeof CANCEL_REASONS>('CUSTOMER_REQUEST');
  const [reason, setReason] = React.useState('');
  const walkIn = !!sale.client?.isWalkIn;
  const [refundMode, setRefundMode] = React.useState<'REFUND' | 'CREDIT'>(
    walkIn ? 'REFUND' : 'CREDIT',
  );
  const [busy, setBusy] = React.useState(false);
  const paid = sale.payments.filter((p) => p.kind === 'PAYMENT').reduce((a, p) => a + p.amount, 0);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/sales/${sale.id}/cancel`, { reasonCode, reason: reason.trim(), refundMode });
      toast.success(`Vente ${sale.number} annulée. Stock réintégré dans les lots d’origine.`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Annuler la vente {sale.number}</DialogTitle>
          <DialogDescription>
            {sale.client?.name} — {fmt.money(sale.totals.totalTtc)}. Le numéro reste attribué et la
            facture apparaîtra « ANNULÉE ».
          </DialogDescription>
        </DialogHeader>
        <ReasonFields
          reasonCode={reasonCode}
          reason={reason}
          onChange={(p) => {
            if (p.reasonCode) setReasonCode(p.reasonCode);
            if (p.reason !== undefined) setReason(p.reason);
          }}
        />
        {paid > 0 && (
          <FormField label={`Règlements encaissés (${fmt.money(paid)})`}>
            <div className="flex flex-col gap-1.5 text-sm">
              {!walkIn && (
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="refund"
                    checked={refundMode === 'CREDIT'}
                    onChange={() => setRefundMode('CREDIT')}
                  />
                  Convertir en crédit client (utilisable sur un prochain achat)
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refund"
                  checked={refundMode === 'REFUND'}
                  onChange={() => setRefundMode('REFUND')}
                />
                Rembourser par le mode d’origine (espèces : sortie de caisse, session ouverte
                requise sur ce poste ; carte, chèque… : remboursement enregistré hors tiroir)
              </label>
            </div>
          </FormField>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Ne pas annuler
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => void submit()}
          >
            Annuler la vente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ModifyLine {
  key: string;
  productId: string;
  name: string;
  qty: number;
  unit: 'PACK' | 'UNIT';
  discountBp: number;
  unitPriceTtc: number;
  tvaBp: number;
  original: boolean;
}

/** Modification (RG-13) : annulation + nouvelle vente liée, règlements transférés dans la même transaction. */
function ModifySaleDialog({ sale, onClose }: { sale: SaleView; onClose: () => void }) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lines, setLines] = React.useState<ModifyLine[]>(() =>
    sale.lines.map((l) => ({
      key: l.id,
      productId: l.product.id,
      name: productLabel(l.product),
      qty: l.qty,
      unit: l.unit,
      discountBp: l.discountBp,
      unitPriceTtc: l.unitPriceTtc,
      tvaBp: l.tvaRateBp,
      original: true,
    })),
  );
  const [client, setClient] = React.useState<{ id: string; name: string } | null>(
    sale.client ? { id: sale.client.id, name: sale.client.name } : null,
  );
  const [reasonCode, setReasonCode] = React.useState<keyof typeof CANCEL_REASONS>('ENTRY_ERROR');
  const [reason, setReason] = React.useState('');
  const [excessMode, setExcessMode] = React.useState<'CREDIT' | 'REFUND'>(
    sale.client?.isWalkIn ? 'REFUND' : 'CREDIT',
  );
  const [extra, setExtra] = React.useState<{ method: 'CASH' | 'CARD'; amount: number | null }>({
    method: 'CASH',
    amount: null,
  });
  const [busy, setBusy] = React.useState(false);
  const transferred = sale.amountPaid;
  const estimate = computeSaleTotals(
    lines.map((l) => ({
      qty: l.qty,
      unitPriceTtc: l.unitPriceTtc,
      discountBp: l.discountBp,
      tvaBp: l.tvaBp,
    })),
    sale.totals.stampDuty,
  ).totalTtc;
  const toPay = Math.max(0, estimate - transferred);
  const excess = Math.max(0, transferred - estimate);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await withOverride((override?: OverrideInput) =>
        api.post<{ sale: SaleView; warnings: string[] }>(`/sales/${sale.id}/modify`, {
          reasonCode,
          reason: reason.trim(),
          clientId: client?.id !== sale.client?.id ? client?.id : undefined,
          lines: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unit: l.unit,
            discountBp: l.discountBp,
            ...(l.original ? { unitPriceTtc: l.unitPriceTtc } : {}),
          })),
          payments:
            extra.amount && extra.amount > 0
              ? [{ method: extra.method, amount: extra.amount }]
              : [],
          excessMode,
          override,
        }),
      );
      toast.success(`Vente ${sale.number} modifiée : nouvelle facture ${res.sale.number}.`);
      res.warnings.forEach((w) => toast.warning(w));
      void qc.invalidateQueries({ queryKey: ['sales'] });
      onClose();
      void navigate(`/sales/${res.sale.id}`);
    } catch (err) {
      if (!isOverrideCancelled(err)) toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Modifier la vente {sale.number}</DialogTitle>
          <DialogDescription>
            La vente d’origine sera annulée (stock réintégré) et une nouvelle facture liée sera
            créée ; les règlements ({fmt.money(transferred)}) sont transférés.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Client">
            {client ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{client.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setClient(null)}>
                  Changer
                </Button>
              </div>
            ) : (
              <ClientSearch autoFocus onSelect={(c) => setClient({ id: c.id, name: c.name })} />
            )}
          </FormField>
          <FormField label="Ajouter un produit">
            <ProductPicker
              onSelect={(p) =>
                setLines((ls) => [
                  ...ls,
                  {
                    key: `new-${p.id}-${Date.now()}`,
                    productId: p.id,
                    name: productLabel(p),
                    qty: 1,
                    unit: 'PACK',
                    discountBp: 0,
                    unitPriceTtc: p.salePriceTtc,
                    tvaBp: p.tvaRate.rateBp,
                    original: false,
                  },
                ])
              }
            />
          </FormField>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Produit</TH>
              <TH className="w-24 text-right">Qté</TH>
              <TH className="text-right">PU TTC</TH>
              <TH className="text-right">Remise</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {lines.map((l) => (
              <TR key={l.key}>
                <TD>
                  {l.name} {!l.original && <Badge variant="blue">ajouté</Badge>}
                </TD>
                <TD className="text-right">
                  <Input
                    inputMode="numeric"
                    className="h-8 w-20 text-right tabular"
                    value={l.qty}
                    aria-label={`Quantité de ${l.name}`}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
                      setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: n } : x)));
                    }}
                  />
                </TD>
                <TD className="text-right tabular">{fmt.amount(l.unitPriceTtc)}</TD>
                <TD className="text-right tabular">
                  {l.discountBp ? fmt.percent(l.discountBp) : '—'}
                </TD>
                <TD className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    aria-label="Retirer"
                  >
                    <Trash2 />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm">
          <span>
            Nouveau total estimé : <strong className="tabular">{fmt.money(estimate)}</strong> (au
            lieu de {fmt.money(sale.totals.totalTtc)})
          </span>
          <span>Règlements transférés : {fmt.money(transferred)}</span>
        </div>
        {toPay > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Encaissement complémentaire" className="w-40">
              <NativeSelect
                value={extra.method}
                onChange={(e) =>
                  setExtra((x) => ({ ...x, method: e.target.value as 'CASH' | 'CARD' }))
                }
                aria-label="Mode"
              >
                <option value="CASH">Espèces</option>
                <option value="CARD">Carte</option>
              </NativeSelect>
            </FormField>
            <FormField label="Montant" className="w-40">
              <MoneyInput
                value={extra.amount}
                onValueChange={(v) => setExtra((x) => ({ ...x, amount: v }))}
                aria-label="Montant complémentaire"
              />
            </FormField>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExtra((x) => ({ ...x, amount: toPay }))}
            >
              <Plus /> {fmt.money(toPay)}
            </Button>
            <p className="text-xs text-muted-foreground">
              Sans encaissement, le reste est porté au compte du client.
            </p>
          </div>
        )}
        {excess > 0 && (
          <FormField label={`Excédent de règlements (${fmt.money(excess)})`}>
            <div className="flex flex-col gap-1.5 text-sm">
              {!sale.client?.isWalkIn && (
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="excess"
                    checked={excessMode === 'CREDIT'}
                    onChange={() => setExcessMode('CREDIT')}
                  />
                  Laisser en crédit client
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="excess"
                  checked={excessMode === 'REFUND'}
                  onChange={() => setExcessMode('REFUND')}
                />
                Rembourser en espèces (session de caisse ouverte requise)
              </label>
            </div>
          </FormField>
        )}
        <ReasonFields
          reasonCode={reasonCode}
          reason={reason}
          onChange={(p) => {
            if (p.reasonCode) setReasonCode(p.reasonCode);
            if (p.reason !== undefined) setReason(p.reason);
          }}
        />
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={
              reason.trim().length < 3 ||
              lines.length === 0 ||
              lines.some((l) => l.qty <= 0) ||
              !client
            }
            onClick={() => void submit()}
          >
            Enregistrer la modification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
