import {
  CLIENT_LEDGER_ENTRY_TYPES,
  PAYMENT_METHODS,
  todayIso,
  type Paginated,
} from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Mail, Plus, Scale } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { EmptyState, ErrorState } from '@/components/page';
import { SendEmailDialog } from '@/components/send-email-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import type { Client } from '@/lib/types';
import { cn } from '@/lib/utils';
import { NewPaymentDialog } from '@/pages/payments/new-payment-dialog';
import { PaymentStatusBadge } from '@/pages/payments/payments-pages';
import type {
  AccountView,
  LedgerEntry,
  OpenInvoice,
  PaymentRow,
  ReturnRow,
} from '@/pages/returns/return-types';
import { EMAIL_STATUS, SaleStatusBadge } from '@/pages/sales/sales-pages';

interface SaleRow {
  id: string;
  number: string;
  status: 'VALIDATED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  validatedAt: string;
  totalTtc: number;
  amountDue: number;
  lineCount: number;
}

/** Onglets de la fiche client (§6.9) : achats, retours, règlements, factures ouvertes, relevé, e-mails. */
export function ClientTabs({ client }: { client: Client }) {
  const can = useCan();
  const state = useTableState();
  const tab = state.filter('tab') || 'invoices';
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => state.update({ tab: v, page: 1 }, false)}
      className="mt-4"
    >
      <TabsList className="flex-wrap">
        <TabsTrigger value="invoices">Factures ouvertes</TabsTrigger>
        <TabsTrigger value="statement">Relevé de compte</TabsTrigger>
        <TabsTrigger value="sales">Achats</TabsTrigger>
        <TabsTrigger value="payments">Règlements</TabsTrigger>
        <TabsTrigger value="returns">Retours et avoirs</TabsTrigger>
        <TabsTrigger value="emails">E-mails envoyés</TabsTrigger>
      </TabsList>
      <TabsContent value="invoices">
        <InvoicesTab client={client} />
      </TabsContent>
      <TabsContent value="statement">
        <StatementTab client={client} />
      </TabsContent>
      <TabsContent value="sales">
        <SalesTab clientId={client.id} />
      </TabsContent>
      <TabsContent value="payments">
        {can('payments.create') ? (
          <PaymentsTab clientId={client.id} />
        ) : (
          <EmptyState title="Accès non autorisé" />
        )}
      </TabsContent>
      <TabsContent value="returns">
        {can('returns.create') ? (
          <ReturnsTab clientId={client.id} />
        ) : (
          <EmptyState title="Accès non autorisé" />
        )}
      </TabsContent>
      <TabsContent value="emails">
        <EmailsTab clientId={client.id} />
      </TabsContent>
    </Tabs>
  );
}

function InvoicesTab({ client }: { client: Client }) {
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [paying, setPaying] = React.useState(false);
  const [settling, setSettling] = React.useState(false);
  const invoices = useQuery({
    queryKey: ['clients', client.id, 'open-invoices'],
    queryFn: () => api.get<OpenInvoice[]>(`/clients/${client.id}/open-invoices`),
  });
  const account = useQuery({
    queryKey: ['clients', client.id, 'account'],
    queryFn: () => api.get<AccountView>(`/clients/${client.id}/account`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['clients'] });
    void qc.invalidateQueries({ queryKey: ['payments'] });
    void qc.invalidateQueries({ queryKey: ['sales'] });
  };
  const settle = async () => {
    setSettling(true);
    try {
      const res = await api.post<{ allocated: number }>(`/clients/${client.id}/settle`, {
        mode: 'AUTO',
      });
      toast.success(
        `${fmt.money(res.allocated)} de crédit affectés aux factures les plus anciennes.`,
      );
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSettling(false);
    }
  };
  if (invoices.error)
    return <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />;
  if (!invoices.data) return <Skeleton className="h-40" />;
  const total = invoices.data.reduce((a, i) => a + i.amountDue, 0);
  const credit = account.data?.availableCredit ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {can('payments.create') && (
          <Button onClick={() => setPaying(true)}>
            <Plus /> Encaisser
          </Button>
        )}
        {can('payments.create') && credit > 0 && total > 0 && (
          <Button variant="outline" onClick={() => void settle()} loading={settling}>
            <Scale /> Utiliser le crédit ({fmt.money(credit)}) sur les factures
          </Button>
        )}
        {credit > 0 && account.data && (
          <span className="text-sm text-muted-foreground">
            Crédit disponible :{' '}
            {account.data.creditSources
              .map((s) => `${s.number} (${fmt.money(s.available)})`)
              .join(', ')}
          </span>
        )}
      </div>
      {invoices.data.length === 0 ? (
        <EmptyState
          title="Aucune facture ouverte"
          description="Toutes les factures de ce client sont soldées."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Facture</TH>
                <TH>Date</TH>
                <TH>Échéance</TH>
                <TH className="text-right">Ancienneté</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Reste dû</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.data.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Link
                      to={`/sales/${i.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {i.number}
                    </Link>
                  </TD>
                  <TD className="tabular">{fmt.date(i.validatedAt)}</TD>
                  <TD>
                    {i.dueDate ? fmt.isoDate(i.dueDate) : '—'}
                    {i.overdueDays > 0 && (
                      <Badge variant="red" className="ml-2">
                        Échue depuis {i.overdueDays} j
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-right tabular">{i.ageDays} j</TD>
                  <TD className="text-right tabular">{fmt.money(i.totalTtc)}</TD>
                  <TD className="text-right font-medium tabular">{fmt.money(i.amountDue)}</TD>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={5} className="text-right">
                  Total dû
                </TD>
                <TD className="text-right font-semibold tabular">{fmt.money(total)}</TD>
              </TR>
            </TFoot>
          </Table>
        </Card>
      )}
      {paying && (
        <NewPaymentDialog clientId={client.id} onClose={() => setPaying(false)} onDone={refresh} />
      )}
    </div>
  );
}

function monthStart(day: string): string {
  return `${day.slice(0, 8)}01`;
}

function StatementTab({ client }: { client: Client }) {
  const fmt = useFormat();
  const can = useCan();
  const today = todayIso(fmt.tz);
  const [from, setFrom] = React.useState(monthStart(today));
  const [to, setTo] = React.useState(today);
  const [emailing, setEmailing] = React.useState(false);
  const ledger = useQuery({
    queryKey: ['clients', client.id, 'ledger', from, to],
    queryFn: () =>
      api.get<Paginated<LedgerEntry> & { openingBalance: number }>(`/clients/${client.id}/ledger`, {
        query: { from, to, pageSize: 200 },
      }),
    enabled: !!from && !!to && from <= to,
  });
  const emailStatus = useQuery({
    queryKey: ['email', 'status'],
    queryFn: () => api.get<{ operational: boolean }>('/email/status'),
    staleTime: 60_000,
  });
  const download = async (format: 'pdf' | 'xlsx') => {
    try {
      const blob = await api.blob(`/clients/${client.id}/statement`, {
        query: { from, to, format },
      });
      if (format === 'pdf') platform.preview(blob);
      else platform.download(blob, `releve-${client.code}-${from}-${to}.xlsx`);
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const rows = [...(ledger.data?.items ?? [])].reverse();
  const opening = ledger.data?.openingBalance ?? 0;
  const debit = rows.reduce((a, r) => a + r.debit, 0);
  const credit = rows.reduce((a, r) => a + r.credit, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Du
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Au
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void download('pdf')} disabled={from > to}>
            <FileText /> PDF
          </Button>
          <Button variant="outline" onClick={() => void download('xlsx')} disabled={from > to}>
            <FileSpreadsheet /> Excel
          </Button>
          {emailStatus.data?.operational && can('email.send_documents') && !client.isWalkIn && (
            <Button variant="outline" onClick={() => setEmailing(true)} disabled={from > to}>
              <Mail /> Envoyer par e-mail
            </Button>
          )}
        </div>
      </div>
      {ledger.error ? (
        <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : !ledger.data ? (
        <Skeleton className="h-40" />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Pièce</TH>
                <TH>Nature</TH>
                <TH>Libellé</TH>
                <TH className="text-right">Débit</TH>
                <TH className="text-right">Crédit</TH>
                <TH className="text-right">Solde</TH>
              </TR>
            </THead>
            <TBody>
              <TR className="bg-muted/40 italic">
                <TD colSpan={6}>Solde d’ouverture</TD>
                <TD className="text-right font-medium tabular">{fmt.amount(opening)}</TD>
              </TR>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="tabular whitespace-nowrap">{fmt.dateTime(r.createdAt)}</TD>
                  <TD className="font-mono text-xs">{r.documentNumber}</TD>
                  <TD className="text-xs">
                    {CLIENT_LEDGER_ENTRY_TYPES[
                      r.entryType as keyof typeof CLIENT_LEDGER_ENTRY_TYPES
                    ] ?? r.entryType}
                  </TD>
                  <TD className="text-xs">{r.description}</TD>
                  <TD className="text-right tabular">{r.debit ? fmt.amount(r.debit) : ''}</TD>
                  <TD className="text-right tabular">{r.credit ? fmt.amount(r.credit) : ''}</TD>
                  <TD className="text-right tabular">{fmt.amount(r.balanceAfter)}</TD>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={4} className="text-right">
                  Totaux de la période — solde de clôture
                </TD>
                <TD className="text-right tabular">{fmt.amount(debit)}</TD>
                <TD className="text-right tabular">{fmt.amount(credit)}</TD>
                <TD className="text-right font-semibold tabular">
                  {fmt.amount(opening + debit - credit)}
                </TD>
              </TR>
            </TFoot>
          </Table>
          {ledger.data.total > rows.length && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Seuls les 200 derniers mouvements sont affichés ; le relevé PDF / Excel contient toute
              la période.
            </p>
          )}
        </Card>
      )}
      {emailing && (
        <SendEmailDialog
          title="Envoyer le relevé de compte par e-mail"
          endpoint={`/clients/${client.id}/statement/email`}
          recipientsKey="recipients"
          extraBody={{ from, to }}
          client={client}
          onClose={() => setEmailing(false)}
          onDone={() => undefined}
        />
      )}
    </div>
  );
}

function SalesTab({ clientId }: { clientId: string }) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const list = useQuery({
    queryKey: ['sales', 'client', clientId, state.page, state.pageSize],
    queryFn: () =>
      api.get<Paginated<SaleRow>>('/sales', {
        query: { clientId, page: state.page, pageSize: state.pageSize },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<SaleRow>[] = [
    {
      id: 'number',
      header: 'Facture',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
    },
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.validatedAt)}</span>,
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => (
        <SaleStatusBadge status={row.original.status} paymentStatus={row.original.paymentStatus} />
      ),
    },
    {
      id: 'lines',
      header: 'Lignes',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.lineCount,
    },
    {
      id: 'total',
      header: 'Total TTC',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.totalTtc)}</span>,
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
  ];
  return (
    <DataTable
      columns={columns}
      data={list.data}
      isLoading={list.isLoading}
      error={list.error}
      state={state}
      onRowClick={(r) => void navigate(`/sales/${r.id}`)}
      emptyTitle="Aucun achat"
    />
  );
}

function PaymentsTab({ clientId }: { clientId: string }) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const list = useQuery({
    queryKey: ['payments', 'client', clientId, state.page, state.pageSize],
    queryFn: () =>
      api.get<Paginated<PaymentRow>>('/payments', {
        query: { clientId, page: state.page, pageSize: state.pageSize },
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
    { id: 'method', header: 'Mode', cell: ({ row }) => PAYMENT_METHODS[row.original.method] },
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
          <span className="text-emerald-700 tabular">{fmt.money(row.original.unallocated)}</span>
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => <PaymentStatusBadge status={row.original.status} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={list.data}
      isLoading={list.isLoading}
      error={list.error}
      state={state}
      onRowClick={(r) => void navigate(`/payments/${r.id}`)}
      emptyTitle="Aucun règlement"
    />
  );
}

function ReturnsTab({ clientId }: { clientId: string }) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const list = useQuery({
    queryKey: ['returns', 'client', clientId, state.page, state.pageSize],
    queryFn: () =>
      api.get<Paginated<ReturnRow>>('/returns', {
        query: { clientId, page: state.page, pageSize: state.pageSize },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<ReturnRow>[] = [
    {
      id: 'number',
      header: 'Retour',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
    },
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.createdAt)}</span>,
    },
    {
      id: 'sale',
      header: 'Facture',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.sale?.number ?? '—'}</span>
      ),
    },
    {
      id: 'credit',
      header: 'Avoir',
      cell: ({ row }) =>
        row.original.creditNote ? (
          <span className="font-mono text-xs">{row.original.creditNote.number}</span>
        ) : (
          <Badge variant="orange">Espèces</Badge>
        ),
    },
    {
      id: 'total',
      header: 'Montant',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.totalTtc)}</span>,
    },
    {
      id: 'remaining',
      header: 'Crédit restant',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.creditNote && row.original.creditNote.remainingAmount > 0 ? (
          <span className="text-emerald-700 tabular">
            {fmt.money(row.original.creditNote.remainingAmount)}
          </span>
        ) : (
          '—'
        ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={list.data}
      isLoading={list.isLoading}
      error={list.error}
      state={state}
      onRowClick={(r) => void navigate(`/returns/${r.id}`)}
      emptyTitle="Aucun retour"
    />
  );
}

interface EmailItem {
  id: string;
  kind: string;
  to: string[];
  status: keyof typeof EMAIL_STATUS;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

function EmailsTab({ clientId }: { clientId: string }) {
  const fmt = useFormat();
  const state = useTableState();
  const list = useQuery({
    queryKey: ['clients', clientId, 'emails', state.page, state.pageSize],
    queryFn: () =>
      api.get<Paginated<EmailItem>>(`/clients/${clientId}/emails`, {
        query: { page: state.page, pageSize: state.pageSize },
      }),
    placeholderData: (prev) => prev,
  });
  const kindLabel: Record<string, string> = {
    INVOICE: 'Facture',
    INVOICE_CANCELLED: 'Facture annulée',
    CREDIT_NOTE: 'Avoir',
    PAYMENT_RECEIPT: 'Reçu de règlement',
    STATEMENT: 'Relevé de compte',
    DUNNING: 'Relance',
  };
  const columns: Column<EmailItem>[] = [
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <span className="tabular">
          {fmt.dateTime(row.original.sentAt ?? row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: 'Document',
      cell: ({ row }) => kindLabel[row.original.kind] ?? row.original.kind,
    },
    {
      id: 'to',
      header: 'Destinataire',
      cell: ({ row }) => <span className="text-xs">{row.original.to.join(', ')}</span>,
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => (
        <span className={cn('inline-flex')}>
          <Badge variant={EMAIL_STATUS[row.original.status].variant}>
            {EMAIL_STATUS[row.original.status].label}
          </Badge>
        </span>
      ),
    },
    {
      id: 'error',
      header: 'Dernière erreur',
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-72 text-xs text-destructive">
          {row.original.lastError}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={list.data}
      isLoading={list.isLoading}
      error={list.error}
      state={state}
      emptyTitle="Aucun e-mail envoyé"
    />
  );
}
