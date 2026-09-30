import { formatStockQty, productLabel, type Paginated } from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, Mail, Plus, Printer } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { ErrorState, Field, PageHeader } from '@/components/page';
import { SendEmailDialog } from '@/components/send-email-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import type { ReturnDetail, ReturnRow } from './return-types';

async function openPdf(id: string, format: 'TICKET' | 'A4', print: boolean) {
  const pdf = await api.blob(`/returns/${id}/print`, { query: { format } });
  if (print) await platform.print(pdf, { format });
  else platform.preview(pdf);
}

/** Retours clients et avoirs (§6.8). */
export function ReturnsPage() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const filters = { from: state.filter('from'), to: state.filter('to') };
  const list = useQuery({
    queryKey: ['returns', 'list', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<ReturnRow>>('/returns', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
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
      header: 'Facture d’origine',
      cell: ({ row }) =>
        row.original.sale ? (
          <Link
            to={`/sales/${row.original.sale.id}`}
            className="font-mono text-xs text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.sale.number}
          </Link>
        ) : (
          '—'
        ),
    },
    { id: 'client', header: 'Client', cell: ({ row }) => row.original.client.name },
    {
      id: 'lines',
      header: 'Lignes',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.lineCount,
    },
    {
      id: 'total',
      header: 'Montant',
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular">{fmt.money(row.original.totalTtc)}</span>,
    },
    {
      id: 'mode',
      header: 'Remboursement',
      cell: ({ row }) =>
        row.original.refundMode === 'CASH' ? (
          <Badge variant="orange">Espèces</Badge>
        ) : (
          <span className="font-mono text-xs">{row.original.creditNote?.number ?? 'Avoir'}</span>
        ),
    },
    {
      id: 'reason',
      header: 'Motif',
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-56 text-xs">{row.original.reason}</span>
      ),
    },
    {
      id: 'by',
      header: 'Saisi par',
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.createdBy?.code}
          {row.original.authorizedBy && ` (🔑 ${row.original.authorizedBy.code})`}
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Retours et avoirs"
        description="Retours clients : remise en stock selon l’état du produit, avoir sur le compte ou remboursement."
        actions={
          <Button asChild>
            <Link to="/returns/new">
              <Plus /> Nouveau retour
            </Link>
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="N° de retour, avoir, facture, client…"
        onRowClick={(r) => void navigate(`/returns/${r.id}`)}
        toolbar={
          <>
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
    </>
  );
}

const DESTINATION = {
  RESTOCK: <Badge variant="green">Remis en stock</Badge>,
  QUARANTINE: <Badge variant="orange">Quarantaine</Badge>,
  DESTRUCTION: <Badge variant="red">Détruit</Badge>,
} as const;

/** Fiche d'un retour : lignes, avoir, impression et envoi par e-mail. */
export function ReturnDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const [emailing, setEmailing] = React.useState(false);
  const ret = useQuery({
    queryKey: ['returns', id],
    queryFn: () => api.get<ReturnDetail>(`/returns/${id}`),
    enabled: !!id,
  });
  const client = useQuery({
    queryKey: ['clients', ret.data?.client.id],
    queryFn: () =>
      api.get<{ email: string | null; emailConsent: boolean }>(`/clients/${ret.data!.client.id}`),
    enabled: !!ret.data && can('email.send_documents') && !ret.data.client.isWalkIn,
  });
  const emailStatus = useQuery({
    queryKey: ['email', 'status'],
    queryFn: () => api.get<{ operational: boolean }>('/email/status'),
    staleTime: 60_000,
  });
  if (ret.error) return <ErrorState error={ret.error} onRetry={() => void ret.refetch()} />;
  if (!ret.data) return <Skeleton className="h-96" />;
  const r = ret.data;
  const pdf = (format: 'TICKET' | 'A4', print: boolean) =>
    openPdf(r.id, format, print).catch((err: unknown) => toast.error(errorText(err)));
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Retour {r.number}
            {r.creditNote && <Badge variant="blue">Avoir {r.creditNote.number}</Badge>}
            {r.refundMode === 'CASH' && <Badge variant="orange">Remboursé en espèces</Badge>}
          </span>
        }
        description={`Le ${fmt.dateTime(r.createdAt)} par ${r.createdBy?.code ?? ''} — ${r.createdBy?.fullName ?? ''}${r.authorizedBy ? ` (autorisé par ${r.authorizedBy.code})` : ''}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/returns">
                <ArrowLeft /> Retours
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void pdf('TICKET', true)}>
              <Printer /> Ticket
            </Button>
            <Button variant="outline" onClick={() => void pdf('A4', false)}>
              <FileText /> Avoir A4
            </Button>
            {r.creditNote && emailStatus.data?.operational && can('email.send_documents') && (
              <Button variant="outline" onClick={() => setEmailing(true)}>
                <Mail /> Envoyer par e-mail
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Produits retournés</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH>Lot</TH>
                <TH className="text-right">Qté</TH>
                <TH>Destination</TH>
                <TH className="text-right">Montant</TH>
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
                        exp. {fmt.isoDate(l.lot.expiryDate.slice(0, 10))}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right tabular">
                    {l.product
                      ? formatStockQty(l.qtyBase, l.product.unitsPerPack, l.product.sellByUnit)
                      : l.qtyBase}
                  </TD>
                  <TD>{DESTINATION[l.destination]}</TD>
                  <TD className="text-right tabular">{fmt.amount(l.amount)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4 text-sm">
              <div className="flex justify-between text-base font-semibold">
                <span>Montant</span>
                <span className="tabular">{fmt.money(r.totalTtc)}</span>
              </div>
              {r.creditNote?.appliedTo.map((a) => (
                <div
                  key={a.saleId}
                  className="flex justify-between text-emerald-700 dark:text-emerald-400"
                >
                  <span>Imputé sur la facture {a.saleNumber}</span>
                  <span className="tabular">{fmt.money(a.amount)}</span>
                </div>
              ))}
              {r.creditNote && r.refundMode === 'CREDIT' && (
                <div className="flex justify-between">
                  <span>Crédit encore disponible</span>
                  <span className="font-medium tabular">
                    {fmt.money(r.creditNote.remainingAmount)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4">
              <Field label="Client">
                <Link
                  to={`/clients/${r.client.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {r.client.name} ({r.client.code})
                </Link>
              </Field>
              <Field label="Facture d’origine">
                {r.sale ? (
                  <Link
                    to={`/sales/${r.sale.id}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {r.sale.number}
                  </Link>
                ) : (
                  'Sans vente d’origine'
                )}
              </Field>
              <Field label="Motif">{r.reason}</Field>
              {can('audit.view') && (
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to={`/audit?entityId=${r.id}`}>Historique au mouchard</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {emailing && (
        <SendEmailDialog
          title={`Envoyer l’avoir ${r.creditNote?.number} par e-mail`}
          endpoint={`/returns/${r.id}/email`}
          client={client.data ?? null}
          onClose={() => setEmailing(false)}
          onDone={() => undefined}
        />
      )}
    </>
  );
}
