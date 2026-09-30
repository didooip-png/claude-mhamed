import type { Paginated } from '@pharmastock/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, ShieldCheck, ShieldX } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { Field, PageHeader } from '@/components/page';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityTab } from './activity-tab';
import { api, errorText } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { CancelledSalesTab, IndicatorsTab } from './audit-sales-tabs';

export interface AuditRow {
  id: number;
  occurredAt: string;
  userId: string | null;
  userCode: string | null;
  userName: string | null;
  authorizedByCode: string | null;
  deviceName: string | null;
  ip: string | null;
  eventType: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  entityType: string | null;
  entityId: string | null;
  entityRef: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  reason: string | null;
  hash: string;
}

const SEVERITY: Record<AuditRow['severity'], { label: string; variant: BadgeVariant }> = {
  INFO: { label: 'Info', variant: 'gray' },
  WARNING: { label: 'Avertissement', variant: 'orange' },
  CRITICAL: { label: 'Critique', variant: 'red' },
};

interface EventType {
  type: string;
  label: string;
  severity: string;
}

export function useAuditEventTypes() {
  return useQuery({
    queryKey: ['audit', 'event-types'],
    queryFn: () => api.get<EventType[]>('/audit/event-types'),
    staleTime: Infinity,
  });
}

export function SeverityBadge({ severity }: { severity: AuditRow['severity'] }) {
  return <Badge variant={SEVERITY[severity].variant}>{SEVERITY[severity].label}</Badge>;
}

/** Onglet « Journal » du mouchard. */
function AuditJournal() {
  const fmt = useFormat();
  const state = useTableState();
  const types = useAuditEventTypes();
  const users = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => api.get<{ id: string; code: string; fullName: string }[]>('/users/directory'),
  });
  const [selected, setSelected] = React.useState<AuditRow | null>(null);
  const filters = {
    from: state.filter('from'),
    to: state.filter('to'),
    userId: state.filter('userId'),
    eventType: state.filter('eventType'),
    severity: state.filter('severity'),
    entityId: state.filter('entityId'),
  };
  const list = useQuery({
    queryKey: ['audit', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<AuditRow>>('/audit', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
  });
  const labelOf = (t: string) => types.data?.find((e) => e.type === t)?.label ?? t;

  const columns: Column<AuditRow>[] = [
    {
      id: 'date',
      header: 'Date et heure',
      cell: ({ row }) => (
        <span className="tabular whitespace-nowrap">{fmt.dateTime(row.original.occurredAt)}</span>
      ),
    },
    {
      id: 'severity',
      header: 'Sévérité',
      cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
    },
    {
      id: 'event',
      header: 'Événement',
      cell: ({ row }) => <span className="font-medium">{labelOf(row.original.eventType)}</span>,
    },
    {
      id: 'summary',
      header: 'Résumé',
      cell: ({ row }) => <span className="line-clamp-2 max-w-xl">{row.original.summary}</span>,
    },
    {
      id: 'user',
      header: 'Utilisateur',
      cell: ({ row }) =>
        row.original.userCode ? (
          <span className="whitespace-nowrap">
            <span className="font-mono">{row.original.userCode}</span>
            {row.original.authorizedByCode && (
              <span className="text-xs text-muted-foreground">
                {' '}
                · autorisé par {row.original.authorizedByCode}
              </span>
            )}
          </span>
        ) : (
          '—'
        ),
    },
    { id: 'device', header: 'Poste', cell: ({ row }) => row.original.deviceName ?? '—' },
    {
      id: 'ref',
      header: 'Référence',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.entityRef ?? ''}</span>,
    },
  ];

  return (
    <>
      {filters.entityId && (
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Badge variant="blue">Historique d’un élément</Badge>
          <Button variant="ghost" size="sm" onClick={() => state.update({ entityId: null })}>
            Voir tout le journal
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        state={state}
        searchPlaceholder="N° de document, client, résumé…"
        onRowClick={setSelected}
        rowClassName={(r) =>
          r.severity === 'CRITICAL' ? 'bg-red-50/60 dark:bg-red-950/30' : undefined
        }
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
            <NativeSelect
              className="w-48"
              value={filters.userId}
              onChange={(e) => state.update({ userId: e.target.value })}
              aria-label="Utilisateur"
            >
              <option value="">Tous les utilisateurs</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.fullName}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-56"
              value={filters.eventType}
              onChange={(e) => state.update({ eventType: e.target.value })}
              aria-label="Événement"
            >
              <option value="">Tous les événements</option>
              {types.data?.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-40"
              value={filters.severity}
              onChange={(e) => state.update({ severity: e.target.value })}
              aria-label="Sévérité"
            >
              <option value="">Toutes sévérités</option>
              <option value="CRITICAL">Critique</option>
              <option value="WARNING">Avertissement</option>
              <option value="INFO">Info</option>
            </NativeSelect>
          </>
        }
      />
      <AuditDetail
        row={selected}
        onClose={() => setSelected(null)}
        label={selected ? labelOf(selected.eventType) : ''}
      />
    </>
  );
}

function JsonBlock({ value, highlight }: { value: unknown; highlight?: Set<string> }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  if (typeof value !== 'object') return <span className="font-mono text-xs">{String(value)}</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd
            className={cn(
              'font-mono break-all',
              highlight?.has(k) && 'rounded bg-yellow-100 px-1 dark:bg-yellow-900/50',
            )}
          >
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Panneau de détail avec comparaison avant / après lisible. */
export function AuditDetail({
  row,
  onClose,
  label,
}: {
  row: AuditRow | null;
  onClose: () => void;
  label: string;
}) {
  const fmt = useFormat();
  const changed = React.useMemo(() => {
    const out = new Set<string>();
    if (
      row &&
      row.before &&
      row.after &&
      typeof row.before === 'object' &&
      typeof row.after === 'object'
    ) {
      const b = row.before as Record<string, unknown>;
      const a = row.after as Record<string, unknown>;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.add(k);
    }
    return out;
  }, [row]);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {row.severity === 'CRITICAL' ? (
                  <ShieldX className="size-5 text-destructive" />
                ) : null}
                {label}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm">{row.summary}</p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Date et heure (serveur)">{fmt.dateTime(row.occurredAt)}</Field>
              <Field label="Sévérité">
                <SeverityBadge severity={row.severity} />
              </Field>
              <Field label="Utilisateur">
                {row.userCode ? `${row.userCode} — ${row.userName ?? ''}` : '—'}
              </Field>
              <Field label="Autorisé par">{row.authorizedByCode ?? '—'}</Field>
              <Field label="Poste">{row.deviceName ?? '—'}</Field>
              <Field label="Adresse IP">{row.ip ?? '—'}</Field>
              <Field label="Élément concerné">{row.entityRef ?? row.entityId ?? '—'}</Field>
              <Field label="Motif">{row.reason ?? '—'}</Field>
              <Field label="N° d’entrée">{row.id}</Field>
            </dl>
            {(row.before !== null || row.after !== null) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                    Avant
                  </h4>
                  <JsonBlock value={row.before} highlight={changed} />
                </div>
                <div className="rounded-md border p-3">
                  <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                    Après
                  </h4>
                  <JsonBlock value={row.after} highlight={changed} />
                </div>
              </div>
            )}
            {row.metadata !== null && (
              <div className="rounded-md border p-3">
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                  Détails
                </h4>
                <JsonBlock value={row.metadata} />
              </div>
            )}
            <p className="font-mono text-[10px] break-all text-muted-foreground">
              Empreinte : {row.hash}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mouchard / journal d'audit (§6.16) : journal, ventes annulées, indicateurs par utilisateur. */
export function AuditPage() {
  const state = useTableState();
  const tab = state.filter('tab') || 'journal';
  const verify = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; checked: number; brokenAtId: number | null; reason: string | null }>(
        '/audit/verify',
      ),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Journal intègre : ${r.checked.toLocaleString('fr-FR')} entrées vérifiées`)
        : toast.error(`Intégrité compromise à l’entrée n° ${r.brokenAtId} : ${r.reason}`, {
            duration: 20_000,
          }),
    onError: (err) => toast.error(errorText(err)),
  });

  const exportFile = async (format: 'xlsx' | 'pdf') => {
    try {
      const params = Object.fromEntries(
        ['from', 'to', 'userId', 'eventType', 'severity', 'entityId', 'q'].map((k) => [
          k,
          state.filter(k),
        ]),
      );
      const blob = await api.blob('/audit/export', { query: { ...params, format } });
      platform.download(blob, `mouchard.${format}`);
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <>
      <PageHeader
        title="Mouchard"
        description="Journal infalsifiable de toutes les opérations sensibles (ajout seul, chaînage de hash)."
        actions={
          <>
            {tab === 'journal' && (
              <>
                <Button variant="outline" onClick={() => void exportFile('xlsx')}>
                  <FileSpreadsheet /> Excel
                </Button>
                <Button variant="outline" onClick={() => void exportFile('pdf')}>
                  <FileText /> PDF
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => verify.mutate()} loading={verify.isPending}>
              <ShieldCheck /> Vérifier l’intégrité du journal
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => state.update({ tab: v === 'journal' ? null : v, q: null })}
      >
        <TabsList>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="cancelled">Ventes annulées</TabsTrigger>
          <TabsTrigger value="indicators">Indicateurs par utilisateur</TabsTrigger>
          <TabsTrigger value="activity">Activité du jour</TabsTrigger>
        </TabsList>
        <TabsContent value="journal">
          <AuditJournal />
        </TabsContent>
        <TabsContent value="cancelled">
          <CancelledSalesTab />
        </TabsContent>
        <TabsContent value="indicators">
          <IndicatorsTab />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
