import { CASH_MOVEMENT_TYPES, PAYMENT_METHODS, type Paginated } from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Calculator, Coins, FileText, Lock, LockOpen } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField, MoneyInput } from '@/components/form';
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
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import { cn } from '@/lib/utils';

interface CurrentCash {
  session: {
    id: string;
    number: string;
    openedAt: string;
    openingFloat: number;
    userId: string;
    openedBy: { code: string; fullName: string } | null;
  } | null;
  required: boolean;
  denominations: { value: number; label: string }[];
  canViewExpected: boolean;
}

interface SessionRow {
  id: string;
  number: string;
  status: 'OPEN' | 'CLOSED';
  device: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  expectedAmount: number | null;
  countedAmount: number | null;
  difference: number | null;
  openedBy: { code: string; fullName: string } | null;
  closedBy: { code: string; fullName: string } | null;
}

interface CashSummary {
  openingFloat: number;
  salesCash: number;
  refunds: number;
  expenses: number;
  deposits: number;
  withdrawals: number;
  drawerOpenings: number;
  expected: number;
  byMethod: { method: string; amount: number; count: number }[];
  salesCount: number;
  salesTotal: number;
  cancelledCount: number;
}

interface SessionDetail extends Omit<SessionRow, 'device'> {
  device: string;
  notes: string | null;
  closeNotes: string | null;
  denominations: { value: number; count: number }[] | null;
  movements: {
    id: string;
    type: keyof typeof CASH_MOVEMENT_TYPES;
    amount: number;
    reason: string | null;
    documentRef: string | null;
    documentType: string | null;
    documentId: string | null;
    createdAt: string;
    user: { code: string } | null;
    authorizedBy: { code: string } | null;
  }[];
  summary: CashSummary;
}

async function openReport(id: string) {
  const pdf = await api.blob(`/cash/${id}/report`);
  platform.preview(pdf);
}

function DifferenceBadge({ value }: { value: number | null }) {
  const fmt = useFormat();
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'font-medium tabular',
        value < 0
          ? 'text-destructive'
          : value > 0
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-emerald-700 dark:text-emerald-400',
      )}
    >
      {value > 0 ? '+' : ''}
      {fmt.money(value)}
    </span>
  );
}

/** Caisse du poste (§6.11) et, pour l'administrateur, l'historique des sessions. */
export function CashPage() {
  const can = useCan();
  return (
    <>
      <PageHeader
        title="Caisse"
        description="Session de caisse de ce poste : ouverture avec fond de caisse, mouvements, clôture par comptage à l’aveugle."
      />
      <div className="flex flex-col gap-6">
        <CurrentSessionCard />
        {can('cash.view_expected') && <SessionsTable />}
      </div>
    </>
  );
}

function CurrentSessionCard() {
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ['cash', 'current'],
    queryFn: () => api.get<CurrentCash>('/cash/current'),
  });
  const [float, setFloat] = React.useState<number | null>(null);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [dialog, setDialog] = React.useState<'movement' | 'close' | null>(null);
  const [closed, setClosed] = React.useState<{
    number: string;
    counted: number;
    expected?: number;
    difference?: number;
  } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cash'] });

  if (current.error)
    return <ErrorState error={current.error} onRetry={() => void current.refetch()} />;
  if (!current.data) return <Skeleton className="h-40" />;
  const session = current.data.session;

  const open = async () => {
    if (float === null) return;
    setBusy(true);
    try {
      const s = await api.post<{ number: string }>('/cash/open', {
        openingFloat: float,
        notes: notes || null,
      });
      toast.success(`Caisse ${s.number} ouverte.`);
      setClosed(null);
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-4" /> Caisse de ce poste
        </CardTitle>
        {session ? <Badge variant="green">Ouverte</Badge> : <Badge variant="gray">Fermée</Badge>}
      </CardHeader>
      <CardContent>
        {closed && (
          <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
            Caisse {closed.number} clôturée. Montant compté :{' '}
            <strong className="tabular">{fmt.money(closed.counted)}</strong>
            {closed.expected !== undefined && (
              <>
                {' '}
                · théorique {fmt.money(closed.expected)} · écart{' '}
                <DifferenceBadge value={closed.difference ?? 0} />
              </>
            )}
          </div>
        )}
        {!session ? (
          can('cash.operate') ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void open();
              }}
            >
              <FormField label="Fond de caisse" required className="w-48">
                <MoneyInput
                  value={float}
                  onValueChange={setFloat}
                  aria-label="Fond de caisse"
                  autoFocus
                />
              </FormField>
              <FormField label="Remarque" className="min-w-64 flex-1">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </FormField>
              <Button type="submit" loading={busy} disabled={float === null}>
                <LockOpen /> Ouvrir la caisse
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune caisse ouverte sur ce poste.</p>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <Field label="Session">{session.number}</Field>
            <Field label="Ouverte le">{fmt.dateTime(session.openedAt)}</Field>
            <Field label="Par">
              {session.openedBy?.code} — {session.openedBy?.fullName}
            </Field>
            <Field label="Fond de caisse">{fmt.money(session.openingFloat)}</Field>
            <div className="ml-auto flex flex-wrap gap-2">
              {can('cash.expense') && (
                <Button variant="outline" onClick={() => setDialog('movement')}>
                  <ArrowDownUp /> Mouvement de caisse
                </Button>
              )}
              {can('cash.view_expected') && (
                <Button
                  variant="outline"
                  onClick={() =>
                    openReport(session.id).catch((err: unknown) => toast.error(errorText(err)))
                  }
                >
                  <FileText /> Rapport X
                </Button>
              )}
              {can('cash.operate') && (
                <Button onClick={() => setDialog('close')}>
                  <Lock /> Clôturer
                </Button>
              )}
            </div>
          </div>
        )}
        {!session && current.data.required && (
          <p className="mt-3 text-xs text-muted-foreground">
            Les encaissements en espèces nécessitent une caisse ouverte sur le poste.
          </p>
        )}
      </CardContent>
      {dialog === 'movement' && <MovementDialog onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'close' && session && (
        <CloseDialog
          sessionId={session.id}
          number={session.number}
          denominations={current.data.denominations}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            setClosed({ number: session.number, ...r });
            refresh();
          }}
        />
      )}
    </Card>
  );
}

function MovementDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = React.useState<'EXPENSE' | 'DEPOSIT' | 'WITHDRAWAL' | 'DRAWER_OPEN'>(
    'EXPENSE',
  );
  const [amount, setAmount] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/cash/movements', {
        type,
        amount: type === 'DRAWER_OPEN' ? 0 : (amount ?? 0),
        reason: reason.trim(),
      });
      if (type === 'DRAWER_OPEN' && !(await platform.openCashDrawer())) {
        toast.info(
          'Ouverture enregistrée. Le tiroir-caisse s’ouvre automatiquement dans le logiciel de bureau.',
        );
      } else toast.success('Mouvement enregistré (tracé au mouchard).');
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
          <DialogTitle>Mouvement de caisse</DialogTitle>
          <DialogDescription>
            Motif obligatoire ; chaque mouvement est tracé au mouchard.
          </DialogDescription>
        </DialogHeader>
        <FormField label="Type">
          <NativeSelect
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            aria-label="Type de mouvement"
          >
            {(['EXPENSE', 'DEPOSIT', 'WITHDRAWAL', 'DRAWER_OPEN'] as const).map((t) => (
              <option key={t} value={t}>
                {CASH_MOVEMENT_TYPES[t]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {type !== 'DRAWER_OPEN' && (
          <FormField label="Montant" required>
            <MoneyInput value={amount} onValueChange={setAmount} aria-label="Montant" />
          </FormField>
        )}
        <FormField label="Motif" required>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Motif"
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={reason.trim().length < 3 || (type !== 'DRAWER_OPEN' && !amount)}
            onClick={() => void submit()}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Clôture par comptage à l'aveugle : le montant théorique n'est jamais affiché avant (RG-19). */
function CloseDialog({
  sessionId,
  number,
  denominations,
  onClose,
  onDone,
}: {
  sessionId: string;
  number: string;
  denominations: { value: number; label: string }[];
  onClose: () => void;
  onDone: (r: { counted: number; expected?: number; difference?: number }) => void;
}) {
  const fmt = useFormat();
  const [counts, setCounts] = React.useState<Record<number, string>>({});
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const total = denominations.reduce(
    (a, d) => a + d.value * (Number.parseInt(counts[d.value] ?? '0', 10) || 0),
    0,
  );
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ counted: number; expected?: number; difference?: number }>(
        `/cash/${sessionId}/close`,
        {
          denominations: denominations.map((d) => ({
            value: d.value,
            count: Number.parseInt(counts[d.value] ?? '0', 10) || 0,
          })),
          notes: notes || null,
        },
      );
      toast.success(`Caisse ${number} clôturée.`);
      onDone(res);
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
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="size-4" /> Clôture de la caisse {number}
          </DialogTitle>
          <DialogDescription>
            Comptez les espèces du tiroir par coupure. Le montant théorique n’est pas affiché :
            l’écart est calculé par le serveur.
          </DialogDescription>
        </DialogHeader>
        <Table>
          <THead>
            <TR>
              <TH>Coupure</TH>
              <TH className="w-28 text-right">Nombre</TH>
              <TH className="text-right">Sous-total</TH>
            </TR>
          </THead>
          <TBody>
            {denominations.map((d, i) => (
              <TR key={d.value}>
                <TD>{d.label}</TD>
                <TD className="text-right">
                  <Input
                    autoFocus={i === 0}
                    inputMode="numeric"
                    className="h-8 w-24 text-right tabular"
                    value={counts[d.value] ?? ''}
                    aria-label={`Nombre de ${d.label}`}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [d.value]: e.target.value.replace(/\D/g, '') }))
                    }
                  />
                </TD>
                <TD className="text-right tabular">
                  {fmt.money(d.value * (Number.parseInt(counts[d.value] ?? '0', 10) || 0))}
                </TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={2} className="text-right font-medium">
                Total compté
              </TD>
              <TD className="text-right text-lg font-bold tabular">{fmt.money(total)}</TD>
            </TR>
          </TFoot>
        </Table>
        <FormField label="Remarque">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          {confirm ? (
            <Button variant="destructive" loading={busy} onClick={() => void submit()}>
              Confirmer la clôture ({fmt.money(total)})
            </Button>
          ) : (
            <Button onClick={() => setConfirm(true)}>Clôturer</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionsTable() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const status = state.filter('status');
  const list = useQuery({
    queryKey: ['cash', 'sessions', state.page, state.pageSize, status],
    queryFn: () =>
      api.get<Paginated<SessionRow>>('/cash/sessions', {
        query: { page: state.page, pageSize: state.pageSize, status },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<SessionRow>[] = [
    {
      id: 'number',
      header: 'Session',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
    },
    { id: 'device', header: 'Poste', cell: ({ row }) => row.original.device },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) =>
        row.original.status === 'OPEN' ? (
          <Badge variant="green">Ouverte</Badge>
        ) : (
          <Badge variant="gray">Clôturée</Badge>
        ),
    },
    {
      id: 'openedAt',
      header: 'Ouverture',
      cell: ({ row }) => (
        <span className="tabular">
          {fmt.dateTime(row.original.openedAt)} · {row.original.openedBy?.code}
        </span>
      ),
    },
    {
      id: 'closedAt',
      header: 'Clôture',
      cell: ({ row }) =>
        row.original.closedAt ? (
          <span className="tabular">
            {fmt.dateTime(row.original.closedAt)} · {row.original.closedBy?.code}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'expected',
      header: 'Théorique',
      meta: { align: 'right' },
      cell: ({ row }) => fmt.money(row.original.expectedAmount) || '—',
    },
    {
      id: 'counted',
      header: 'Compté',
      meta: { align: 'right' },
      cell: ({ row }) => fmt.money(row.original.countedAmount) || '—',
    },
    {
      id: 'difference',
      header: 'Écart',
      meta: { align: 'right' },
      cell: ({ row }) => <DifferenceBadge value={row.original.difference} />,
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Historique des sessions</h2>
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        onRowClick={(r) => void navigate(`/cash/${r.id}`)}
        toolbar={
          <NativeSelect
            className="w-40"
            value={status}
            onChange={(e) => state.update({ status: e.target.value })}
            aria-label="Statut"
          >
            <option value="">Toutes</option>
            <option value="OPEN">Ouvertes</option>
            <option value="CLOSED">Clôturées</option>
          </NativeSelect>
        }
      />
    </div>
  );
}

/** Détail d'une session : synthèse (rapport X/Z), mouvements, comptage. */
export function CashSessionPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const detail = useQuery({
    queryKey: ['cash', 'session', id],
    queryFn: () => api.get<SessionDetail>(`/cash/${id}`),
    enabled: !!id,
  });
  if (detail.error)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <Skeleton className="h-96" />;
  const s = detail.data;
  const sum = s.summary;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Caisse {s.number}{' '}
            {s.status === 'OPEN' ? (
              <Badge variant="green">Ouverte</Badge>
            ) : (
              <Badge variant="gray">Clôturée</Badge>
            )}
          </span>
        }
        description={`${s.device} · ouverte le ${fmt.dateTime(s.openedAt)} par ${s.openedBy?.code ?? ''}${s.closedAt ? ` · clôturée le ${fmt.dateTime(s.closedAt)} par ${s.closedBy?.code ?? ''}` : ''}`}
        actions={
          <Button
            variant="outline"
            onClick={() => openReport(s.id).catch((err: unknown) => toast.error(errorText(err)))}
          >
            <FileText /> Rapport {s.status === 'CLOSED' ? 'Z' : 'X'}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Synthèse</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {[
              ['Ventes', `${sum.salesCount} · ${fmt.money(sum.salesTotal)}`],
              ['Ventes annulées', String(sum.cancelledCount)],
              ...sum.byMethod.map((b) => [
                `${PAYMENT_METHODS[b.method as keyof typeof PAYMENT_METHODS] ?? b.method} (${b.count})`,
                fmt.money(b.amount),
              ]),
              ['Fond de caisse', fmt.money(sum.openingFloat)],
              ['Encaissements espèces', fmt.money(sum.salesCash)],
              ['Remboursements', fmt.money(sum.refunds)],
              ['Sorties (dépenses)', fmt.money(sum.expenses)],
              ['Apports', fmt.money(sum.deposits)],
              ['Retraits', fmt.money(sum.withdrawals)],
              ['Ouvertures du tiroir sans vente', String(sum.drawerOpenings)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{k}</span>
                <span className="tabular">{v}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t pt-2 font-medium">
              <span>Espèces théoriques</span>
              <span className="tabular">
                {fmt.money(s.status === 'CLOSED' ? s.expectedAmount : sum.expected)}
              </span>
            </div>
            {s.status === 'CLOSED' && (
              <>
                <div className="flex justify-between font-medium">
                  <span>Espèces comptées</span>
                  <span className="tabular">{fmt.money(s.countedAmount)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Écart</span>
                  <DifferenceBadge value={s.difference} />
                </div>
              </>
            )}
            {s.closeNotes && (
              <p className="mt-2 text-xs text-muted-foreground">Remarque : {s.closeNotes}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Mouvements</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Document</TH>
                <TH>Motif</TH>
                <TH>Utilisateur</TH>
                <TH className="text-right">Montant</TH>
              </TR>
            </THead>
            <TBody>
              {s.movements.map((m) => (
                <TR key={m.id}>
                  <TD className="tabular">{fmt.dateTime(m.createdAt)}</TD>
                  <TD>{CASH_MOVEMENT_TYPES[m.type]}</TD>
                  <TD className="font-mono text-xs">
                    {m.documentType === 'SALE' && m.documentId ? (
                      <Link to={`/sales/${m.documentId}`} className="hover:underline">
                        {m.documentRef}
                      </Link>
                    ) : (
                      m.documentRef
                    )}
                  </TD>
                  <TD className="text-xs">{m.reason}</TD>
                  <TD className="font-mono text-xs">
                    {m.user?.code}
                    {m.authorizedBy && ` (🔑 ${m.authorizedBy.code})`}
                  </TD>
                  <TD className={cn('text-right tabular', m.amount < 0 && 'text-destructive')}>
                    {m.type === 'DRAWER_OPEN' ? '—' : fmt.money(m.amount)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
