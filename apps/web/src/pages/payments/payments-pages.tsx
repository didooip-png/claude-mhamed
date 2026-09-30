import { PAYMENT_METHODS, type Paginated } from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, FileText, Mail, Plus, Printer } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField } from '@/components/form';
import { EmptyState, ErrorState, Field, PageHeader } from '@/components/page';
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
import type { PaymentDetail, PaymentRow } from '../returns/return-types';
import { NewPaymentDialog } from './new-payment-dialog';

export const CHEQUE_STATUS = {
  IN_PORTFOLIO: { label: 'En portefeuille', variant: 'yellow' },
  DEPOSITED: { label: 'Remis en banque', variant: 'blue' },
  CASHED: { label: 'Encaissé', variant: 'green' },
  BOUNCED: { label: 'Impayé', variant: 'red' },
} as const;

export function PaymentStatusBadge({ status }: { status: PaymentRow['status'] }) {
  if (status === 'CANCELLED') return <Badge variant="gray">Annulé</Badge>;
  if (status === 'BOUNCED') return <Badge variant="red">Impayé</Badge>;
  return <Badge variant="green">Valide</Badge>;
}

async function openReceipt(id: string, format: 'TICKET' | 'A4', print: boolean) {
  const pdf = await api.blob(`/payments/${id}/print`, { query: { format } });
  if (print) await platform.print(pdf, { format });
  else platform.preview(pdf);
}

/** Règlements (§6.10) : encaissements, lettrage, reçus. */
export function PaymentsPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const state = useTableState();
  const [creating, setCreating] = React.useState(false);
  const filters = {
    method: state.filter('method'),
    status: state.filter('status'),
    unallocated: state.filter('unallocated'),
    from: state.filter('from'),
    to: state.filter('to'),
  };
  const list = useQuery({
    queryKey: ['payments', 'list', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<PaymentRow> & { totals: { amount: number } }>('/payments', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<PaymentRow>[] = [
    {
      id: 'number',
      header: 'Règlement',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
    },
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.paidAt)}</span>,
    },
    { id: 'client', header: 'Client', cell: ({ row }) => row.original.client.name },
    {
      id: 'method',
      header: 'Mode',
      cell: ({ row }) => (
        <div>
          {PAYMENT_METHODS[row.original.method]}
          {row.original.chequeNumber && (
            <div className="text-xs text-muted-foreground">
              n° {row.original.chequeNumber} · {row.original.bank}
            </div>
          )}
          {row.original.reference && (
            <div className="text-xs text-muted-foreground">réf. {row.original.reference}</div>
          )}
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Montant',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.amount)}</span>,
    },
    {
      id: 'unallocated',
      header: 'Acompte',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.unallocated > 0 ? (
          <span className="tabular text-emerald-700 dark:text-emerald-400">
            {fmt.money(row.original.unallocated)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => <PaymentStatusBadge status={row.original.status} />,
    },
    {
      id: 'by',
      header: 'Saisi par',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.createdBy?.code}</span>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Encaissements"
        description="Règlements des clients, lettrage sur les factures, acomptes et reçus."
        actions={
          can('payments.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nouvel encaissement
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
        searchPlaceholder="N° de règlement, chèque, référence, client…"
        onRowClick={(r) => void navigate(`/payments/${r.id}`)}
        rowClassName={(r) => (r.status !== 'VALID' ? 'text-muted-foreground' : undefined)}
        footer={
          list.data && (
            <TR>
              <TD colSpan={columns.length} className="text-right text-sm">
                Total des règlements valides :{' '}
                <strong className="tabular">{fmt.money(list.data.totals.amount)}</strong>
              </TD>
            </TR>
          )
        }
        toolbar={
          <>
            <NativeSelect
              className="w-40"
              value={filters.method}
              onChange={(e) => state.update({ method: e.target.value })}
              aria-label="Mode"
            >
              <option value="">Tous modes</option>
              {(['CASH', 'CARD', 'CHEQUE', 'TRANSFER', 'DRAFT_BILL'] as const).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHODS[m]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-40"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous statuts</option>
              <option value="VALID">Valides</option>
              <option value="CANCELLED">Annulés</option>
              <option value="BOUNCED">Impayés</option>
            </NativeSelect>
            <NativeSelect
              className="w-44"
              value={filters.unallocated}
              onChange={(e) => state.update({ unallocated: e.target.value })}
              aria-label="Acomptes"
            >
              <option value="">Tous</option>
              <option value="1">Avec acompte non affecté</option>
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
      {creating && (
        <NewPaymentDialog
          onClose={() => setCreating(false)}
          onDone={(p) => void navigate(`/payments/${p.id}`)}
        />
      )}
    </>
  );
}

/** Fiche d'un règlement : lettrage, reçu, annulation ou impayé (administrateur). */
export function PaymentDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [dialog, setDialog] = React.useState<'cancel' | 'bounce' | 'email' | null>(null);
  const payment = useQuery({
    queryKey: ['payments', id],
    queryFn: () => api.get<PaymentDetail>(`/payments/${id}`),
    enabled: !!id,
  });
  const client = useQuery({
    queryKey: ['clients', payment.data?.client.id],
    queryFn: () =>
      api.get<{ email: string | null; emailConsent: boolean }>(
        `/clients/${payment.data!.client.id}`,
      ),
    enabled: !!payment.data && can('email.send_documents'),
  });
  const emailStatus = useQuery({
    queryKey: ['email', 'status'],
    queryFn: () => api.get<{ operational: boolean }>('/email/status'),
    staleTime: 60_000,
  });
  if (payment.error)
    return <ErrorState error={payment.error} onRetry={() => void payment.refetch()} />;
  if (!payment.data) return <Skeleton className="h-96" />;
  const p = payment.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['payments'] });
    void qc.invalidateQueries({ queryKey: ['clients'] });
    void qc.invalidateQueries({ queryKey: ['sales'] });
  };
  const receipt = (format: 'TICKET' | 'A4', print: boolean) =>
    openReceipt(p.id, format, print)
      .then(refresh)
      .catch((err: unknown) => toast.error(errorText(err)));
  const isTerm = p.method === 'CHEQUE' || p.method === 'DRAFT_BILL';
  const active = p.allocations.filter((a) => !a.cancelledAt);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Règlement {p.number}
            <PaymentStatusBadge status={p.status} />
            {p.chequeStatus && (
              <Badge variant={CHEQUE_STATUS[p.chequeStatus].variant}>
                {CHEQUE_STATUS[p.chequeStatus].label}
              </Badge>
            )}
          </span>
        }
        description={`Le ${fmt.dateTime(p.paidAt)} par ${p.createdBy?.code ?? ''} — ${p.createdBy?.fullName ?? ''}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/payments">
                <ArrowLeft /> Encaissements
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void receipt('TICKET', true)}>
              <Printer /> Reçu (ticket)
            </Button>
            <Button variant="outline" onClick={() => void receipt('A4', false)}>
              <FileText /> Reçu A4
            </Button>
            {emailStatus.data?.operational && can('email.send_documents') && (
              <Button variant="outline" onClick={() => setDialog('email')}>
                <Mail /> Envoyer par e-mail
              </Button>
            )}
            {can('payments.cancel') && p.status === 'VALID' && p.refundedAmount === 0 && (
              <>
                {isTerm && (
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setDialog('bounce')}
                  >
                    <Ban /> {p.method === 'CHEQUE' ? 'Chèque impayé' : 'Traite impayée'}
                  </Button>
                )}
                <Button variant="destructive" onClick={() => setDialog('cancel')}>
                  <Ban /> Annuler le règlement
                </Button>
              </>
            )}
          </>
        }
      />
      {p.status !== 'VALID' && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <strong>{p.status === 'BOUNCED' ? 'Règlement impayé' : 'Règlement annulé'}</strong> le{' '}
          {fmt.dateTime(p.cancelledAt)} par {p.cancelledBy?.code}. Motif : {p.cancelReason}. Les
          factures concernées ont été rouvertes.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Lettrage</CardTitle>
          </CardHeader>
          {p.allocations.length === 0 ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Aucune facture réglée : ce règlement est un acompte (crédit sur le compte du
                client).
              </p>
            </CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Facture</TH>
                  <TH>Date de la facture</TH>
                  <TH>Affecté le</TH>
                  <TH className="text-right">Montant</TH>
                </TR>
              </THead>
              <TBody>
                {p.allocations.map((a) => (
                  <TR
                    key={a.id}
                    className={cn(a.cancelledAt && 'text-muted-foreground line-through')}
                  >
                    <TD>
                      <Link
                        to={`/sales/${a.sale.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {a.sale.number}
                      </Link>
                    </TD>
                    <TD className="tabular">{fmt.date(a.sale.validatedAt)}</TD>
                    <TD className="tabular">
                      {fmt.dateTime(a.createdAt)} · {a.createdBy?.code}
                    </TD>
                    <TD className="text-right tabular">{fmt.money(a.amount)}</TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD colSpan={3} className="text-right">
                    Total affecté
                  </TD>
                  <TD className="text-right tabular">
                    {fmt.money(active.reduce((a, x) => a + x.amount, 0))}
                  </TD>
                </TR>
              </TFoot>
            </Table>
          )}
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <div className="flex justify-between text-base font-semibold">
              <span>Montant</span>
              <span className="tabular">{fmt.money(p.amount)}</span>
            </div>
            {p.unallocated > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Acompte non affecté</span>
                <span className="tabular">{fmt.money(p.unallocated)}</span>
              </div>
            )}
            <Field label="Client">
              <Link
                to={`/clients/${p.client.id}`}
                className="font-medium text-primary hover:underline"
              >
                {p.client.name} ({p.client.code})
              </Link>
            </Field>
            <Field label="Mode">{PAYMENT_METHODS[p.method]}</Field>
            {p.chequeNumber && (
              <Field label="Chèque">
                n° {p.chequeNumber} · {p.bank}
              </Field>
            )}
            {p.dueDate && <Field label="Échéance">{fmt.isoDate(p.dueDate.slice(0, 10))}</Field>}
            {p.reference && <Field label="Référence">{p.reference}</Field>}
            {p.cashSession && <Field label="Session de caisse">{p.cashSession.number}</Field>}
            {p.saleId && (
              <Field label="Encaissé à la caisse avec">
                <Link to={`/sales/${p.saleId}`} className="text-primary hover:underline">
                  la vente
                </Link>
              </Field>
            )}
            {p.notes && <Field label="Remarque">{p.notes}</Field>}
            {can('audit.view') && (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link to={`/audit?entityId=${p.id}`}>Historique au mouchard</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      {(dialog === 'cancel' || dialog === 'bounce') && (
        <ReasonDialog
          title={
            dialog === 'cancel'
              ? `Annuler le règlement ${p.number}`
              : `${p.method === 'CHEQUE' ? 'Chèque' : 'Traite'} impayé — ${p.number}`
          }
          description={
            dialog === 'cancel'
              ? `Les affectations sont annulées et les factures rouvertes${p.method === 'CASH' ? ' ; une sortie de caisse est enregistrée dans la session ouverte de ce poste' : ''}.`
              : 'Le lettrage est annulé et les factures concernées sont rouvertes.'
          }
          confirmLabel={dialog === 'cancel' ? 'Annuler le règlement' : 'Déclarer impayé'}
          endpoint={`/payments/${p.id}/${dialog}`}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
      {dialog === 'email' && (
        <SendEmailDialog
          title={`Envoyer le reçu ${p.number} par e-mail`}
          endpoint={`/payments/${p.id}/email`}
          client={client.data ?? null}
          onClose={() => setDialog(null)}
          onDone={() => undefined}
        />
      )}
    </>
  );
}

/** Saisie d'un motif obligatoire avant une opération sensible (tracée au mouchard). */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  endpoint,
  onClose,
  onDone,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  endpoint: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(endpoint, { reason: reason.trim() });
      toast.success('Opération enregistrée (tracée au mouchard).');
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
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormField label="Motif" required>
          <Textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Motif"
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Retour
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ChequeRow {
  id: string;
  number: string;
  method: 'CHEQUE' | 'DRAFT_BILL';
  client: { id: string; code: string; name: string };
  chequeNumber: string | null;
  bank: string | null;
  amount: number;
  dueDate: string | null;
  daysToDue: number | null;
  overdue: boolean;
  chequeStatus: keyof typeof CHEQUE_STATUS | null;
  status: 'VALID' | 'CANCELLED' | 'BOUNCED';
}

/** Chèques et traites en portefeuille, par date d'échéance. */
export function ChequesPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const state = useTableState();
  const [bouncing, setBouncing] = React.useState<ChequeRow | null>(null);
  const filters = {
    status: state.filter('status') || 'IN_PORTFOLIO',
    from: state.filter('from'),
    to: state.filter('to'),
  };
  const list = useQuery({
    queryKey: ['payments', 'cheques', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<
        Paginated<ChequeRow> & {
          summary: { status: string | null; count: number; amount: number }[];
        }
      >('/payments/cheques', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
  });
  const advance = async (row: ChequeRow, status: 'DEPOSITED' | 'CASHED') => {
    try {
      await api.post(`/payments/${row.id}/cheque-status`, { status });
      toast.success(status === 'DEPOSITED' ? 'Chèque remis en banque.' : 'Chèque encaissé.');
      void qc.invalidateQueries({ queryKey: ['payments'] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const columns: Column<ChequeRow>[] = [
    {
      id: 'due',
      header: 'Échéance',
      cell: ({ row }) => (
        <div>
          <span className="tabular">
            {row.original.dueDate ? fmt.isoDate(row.original.dueDate) : '—'}
          </span>
          {row.original.overdue && (
            <Badge variant="red" className="ml-2">
              Échu
            </Badge>
          )}
          {row.original.daysToDue !== null &&
            !row.original.overdue &&
            row.original.daysToDue <= 7 &&
            row.original.chequeStatus !== 'CASHED' && (
              <Badge variant="yellow" className="ml-2">
                J{row.original.daysToDue >= 0 ? '-' : '+'}
                {Math.abs(row.original.daysToDue)}
              </Badge>
            )}
        </div>
      ),
    },
    { id: 'client', header: 'Client', cell: ({ row }) => row.original.client.name },
    {
      id: 'cheque',
      header: 'Chèque / traite',
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.method === 'DRAFT_BILL' ? 'Traite' : 'Chèque'}{' '}
          {row.original.chequeNumber ? `n° ${row.original.chequeNumber}` : ''}{' '}
          {row.original.bank ?? ''}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Montant',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.amount)}</span>,
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) =>
        row.original.chequeStatus ? (
          <Badge variant={CHEQUE_STATUS[row.original.chequeStatus].variant}>
            {CHEQUE_STATUS[row.original.chequeStatus].label}
          </Badge>
        ) : (
          '—'
        ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const r = row.original;
        if (r.status !== 'VALID') return null;
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.chequeStatus === 'IN_PORTFOLIO' && (
              <Button size="sm" variant="outline" onClick={() => void advance(r, 'DEPOSITED')}>
                Remis en banque
              </Button>
            )}
            {(r.chequeStatus === 'IN_PORTFOLIO' || r.chequeStatus === 'DEPOSITED') && (
              <Button size="sm" variant="outline" onClick={() => void advance(r, 'CASHED')}>
                Encaissé
              </Button>
            )}
            {can('payments.cancel') && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => setBouncing(r)}
              >
                Impayé
              </Button>
            )}
          </div>
        );
      },
    },
  ];
  return (
    <>
      <PageHeader
        title="Chèques et traites"
        description="Portefeuille par date d’échéance : remise en banque, encaissement, impayé (administrateur)."
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {list.data?.summary.map((s) => (
          <Badge
            key={s.status ?? 'none'}
            variant={
              s.status ? CHEQUE_STATUS[s.status as keyof typeof CHEQUE_STATUS].variant : 'gray'
            }
            className="gap-1.5 px-2 py-1 text-sm"
          >
            {s.status ? CHEQUE_STATUS[s.status as keyof typeof CHEQUE_STATUS].label : '—'} :{' '}
            {s.count} · {fmt.money(s.amount)}
          </Badge>
        ))}
      </div>
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="N° de chèque, banque, client…"
        onRowClick={(r) => void navigate(`/payments/${r.id}`)}
        emptyTitle="Aucun chèque"
        toolbar={
          <>
            <NativeSelect
              className="w-44"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              {Object.entries(CHEQUE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </NativeSelect>
            <Input
              type="date"
              className="w-40"
              value={filters.from}
              onChange={(e) => state.update({ from: e.target.value })}
              aria-label="Échéance du"
            />
            <Input
              type="date"
              className="w-40"
              value={filters.to}
              onChange={(e) => state.update({ to: e.target.value })}
              aria-label="Échéance au"
            />
          </>
        }
      />
      {bouncing && (
        <ReasonDialog
          title={`Impayé — ${bouncing.number}`}
          description="Le lettrage est annulé et les factures concernées sont rouvertes."
          confirmLabel="Déclarer impayé"
          endpoint={`/payments/${bouncing.id}/bounce`}
          onClose={() => setBouncing(null)}
          onDone={() => void qc.invalidateQueries({ queryKey: ['payments'] })}
        />
      )}
    </>
  );
}

interface AgingData {
  asOf: string;
  clients: {
    clientId: string;
    code: string;
    name: string;
    buckets: [number, number, number, number];
    total: number;
    overdue: number;
    invoices: number;
    credit: number;
  }[];
  totals: { buckets: number[]; total: number; overdue: number; credit: number };
}

/** Échéancier / balance âgée : créances par client en tranches d'ancienneté. */
export function AgingPage() {
  const fmt = useFormat();
  const state = useTableState();
  const asOf = state.filter('asOf');
  const data = useQuery({
    queryKey: ['payments', 'aging', asOf],
    queryFn: () => api.get<AgingData>('/payments/aging', { query: { asOf } }),
  });
  const cell = (v: number) =>
    v > 0 ? (
      <span className="tabular">{fmt.amount(v)}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  return (
    <>
      <PageHeader
        title="Balance âgée"
        description="Créances par client selon l’ancienneté de la facture (0–30, 31–60, 61–90, plus de 90 jours)."
        actions={
          <Input
            type="date"
            className="w-44"
            value={asOf}
            onChange={(e) => state.update({ asOf: e.target.value })}
            aria-label="Situation au"
          />
        }
      />
      {data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : !data.data ? (
        <Skeleton className="h-64" />
      ) : data.data.clients.length === 0 ? (
        <EmptyState title="Aucune créance" description="Toutes les factures sont soldées." />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Client</TH>
                <TH className="text-right">Factures</TH>
                <TH className="text-right">0–30 j</TH>
                <TH className="text-right">31–60 j</TH>
                <TH className="text-right">61–90 j</TH>
                <TH className="text-right">&gt; 90 j</TH>
                <TH className="text-right">Total dû</TH>
                <TH className="text-right">Dont échu</TH>
                <TH className="text-right">Crédit dispo.</TH>
              </TR>
            </THead>
            <TBody>
              {data.data.clients.map((c) => (
                <TR key={c.clientId}>
                  <TD>
                    <Link to={`/clients/${c.clientId}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>{' '}
                    <span className="text-xs text-muted-foreground">{c.code}</span>
                  </TD>
                  <TD className="text-right tabular">{c.invoices}</TD>
                  <TD className="text-right">{cell(c.buckets[0])}</TD>
                  <TD className="text-right">{cell(c.buckets[1])}</TD>
                  <TD
                    className={cn(
                      'text-right',
                      c.buckets[2] > 0 && 'bg-orange-50 dark:bg-orange-950/30',
                    )}
                  >
                    {cell(c.buckets[2])}
                  </TD>
                  <TD
                    className={cn('text-right', c.buckets[3] > 0 && 'bg-red-50 dark:bg-red-950/30')}
                  >
                    {cell(c.buckets[3])}
                  </TD>
                  <TD className="text-right font-medium tabular">{fmt.amount(c.total)}</TD>
                  <TD className={cn('text-right', c.overdue > 0 && 'text-destructive')}>
                    {cell(c.overdue)}
                  </TD>
                  <TD className="text-right text-emerald-700 dark:text-emerald-400">
                    {cell(c.credit)}
                  </TD>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD className="font-semibold">Total</TD>
                <TD />
                {data.data.totals.buckets.map((b, i) => (
                  <TD key={i} className="text-right tabular">
                    {fmt.amount(b)}
                  </TD>
                ))}
                <TD className="text-right font-semibold tabular">
                  {fmt.amount(data.data.totals.total)}
                </TD>
                <TD className="text-right tabular">{fmt.amount(data.data.totals.overdue)}</TD>
                <TD className="text-right tabular">{fmt.amount(data.data.totals.credit)}</TD>
              </TR>
            </TFoot>
          </Table>
        </Card>
      )}
    </>
  );
}
