import {
  addDaysIso,
  REPORT_GROUPS,
  todayIso,
  type ReportGroup,
  type ReportId,
  type ReportResult,
} from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Chart } from '@/components/chart';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/product-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { chartOption, formatCell, formatKpi, variation } from '@/lib/report-format';
import { cn } from '@/lib/utils';

interface CatalogEntry {
  id: ReportId;
  group: ReportGroup;
  label: string;
  description: string;
  snapshot?: boolean;
  needs?: ('productId' | 'lotNumber' | 'days')[];
}

interface Catalog {
  groups: Record<ReportGroup, string>;
  reports: CatalogEntry[];
}

const PRESETS = [
  { key: 'today', label: 'Aujourd’hui' },
  { key: '7d', label: '7 jours' },
  { key: '30d', label: '30 jours' },
  { key: 'month', label: 'Ce mois' },
  { key: 'lastmonth', label: 'Mois précédent' },
  { key: 'year', label: 'Cette année' },
] as const;

function presetRange(
  key: (typeof PRESETS)[number]['key'],
  today: string,
): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDaysIso(today, -6), to: today };
    case '30d':
      return { from: addDaysIso(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastmonth': {
      const last = addDaysIso(`${today.slice(0, 7)}-01`, -1);
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

async function exportReport(id: string, params: Record<string, string>, format: 'xlsx' | 'pdf') {
  const blob = await api.blob(`/reports/${id}`, { query: { ...params, format } });
  const url = URL.createObjectURL(blob);
  if (format === 'pdf') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.xlsx`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Centre de statistiques et de rapports (§6.15) : période, comparaison, graphique, tableau, exports. */
export function ReportsPage() {
  const { id: routeId } = useParams();
  const id = (routeId ?? 'sales-summary') as ReportId;
  const navigate = useNavigate();
  const fmt = useFormat();
  const [params, setParams] = useSearchParams();
  const today = todayIso(fmt.tz);
  const catalog = useQuery({
    queryKey: ['reports', 'catalog'],
    queryFn: () => api.get<Catalog>('/reports'),
    staleTime: 300_000,
  });
  const entry = catalog.data?.reports.find((r) => r.id === id);

  const from = params.get('from') ?? `${today.slice(0, 7)}-01`;
  const to = params.get('to') ?? today;
  const compare = params.get('compare') ?? 'none';
  const granularity = params.get('granularity') ?? 'day';
  const productId = params.get('productId') ?? '';
  const lotNumber = params.get('lotNumber') ?? '';
  const days = params.get('days') ?? '';
  const [productName, setProductName] = React.useState('');
  const [lotInput, setLotInput] = React.useState(lotNumber);

  const update = (patch: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  const query: Record<string, string> = {
    ...(entry?.snapshot && !entry.needs?.length ? {} : { from, to }),
    ...(entry?.snapshot ? {} : { compare, granularity }),
    ...(productId ? { productId } : {}),
    ...(lotNumber ? { lotNumber } : {}),
    ...(days ? { days } : {}),
  };
  const ready =
    !!entry &&
    (!entry.needs?.includes('productId') || !!productId) &&
    (!entry.needs?.includes('lotNumber') || !!lotNumber);
  const report = useQuery({
    queryKey: ['reports', id, query],
    queryFn: () => api.get<ReportResult>(`/reports/${id}`, { query }),
    enabled: ready,
    placeholderData: (prev) => prev,
  });
  const [exporting, setExporting] = React.useState<'xlsx' | 'pdf' | null>(null);
  const doExport = async (format: 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      await exportReport(id, query, format);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setExporting(null);
    }
  };

  const data = report.data;
  const option = React.useMemo(() => (data ? chartOption(data, fmt) : null), [data, fmt]);
  const grouped = React.useMemo(() => {
    const map = new Map<ReportGroup, CatalogEntry[]>();
    for (const r of catalog.data?.reports ?? []) map.set(r.group, [...(map.get(r.group) ?? []), r]);
    return [...map.entries()];
  }, [catalog.data]);

  return (
    <>
      <PageHeader
        title="Statistiques et rapports"
        description="Analyses par période, comparaison, exports Excel et PDF."
      />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Rapports" className="flex flex-col gap-3 print:hidden">
          {grouped.map(([group, list]) => (
            <div key={group}>
              <div className="mb-1 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {REPORT_GROUPS[group]}
              </div>
              {list.map((r) => (
                <Link
                  key={r.id}
                  to={`/reports/${r.id}${params.toString() ? `?${params.toString()}` : ''}`}
                  className={cn(
                    'block rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                    r.id === id && 'bg-primary/10 font-medium text-primary',
                  )}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          {!entry && catalog.data && (
            <EmptyState
              title="Rapport introuvable"
              description="Choisissez un rapport dans la liste."
              action={<Button onClick={() => void navigate('/reports')}>Chiffre d’affaires</Button>}
            />
          )}
          {entry && (
            <Card className="print:hidden">
              <CardContent className="flex flex-col gap-3 pt-4">
                <div>
                  <h2 className="text-lg font-semibold">{entry.label}</h2>
                  <p className="text-sm text-muted-foreground">{entry.description}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  {(!entry.snapshot || entry.needs?.length) && (
                    <>
                      <div className="flex flex-wrap gap-1">
                        {PRESETS.map((p) => (
                          <Button
                            key={p.key}
                            size="sm"
                            variant="outline"
                            onClick={() => update(presetRange(p.key, today))}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="date"
                          className="w-40"
                          value={from}
                          max={to}
                          aria-label="Du"
                          onChange={(e) => e.target.value && update({ from: e.target.value })}
                        />
                        <span className="text-muted-foreground">→</span>
                        <Input
                          type="date"
                          className="w-40"
                          value={to}
                          min={from}
                          aria-label="Au"
                          onChange={(e) => e.target.value && update({ to: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                  {id === 'sales-summary' && (
                    <>
                      <NativeSelect
                        className="w-52"
                        value={compare}
                        aria-label="Comparaison"
                        onChange={(e) => update({ compare: e.target.value })}
                      >
                        <option value="none">Sans comparaison</option>
                        <option value="previous">Période précédente</option>
                        <option value="year">Année précédente</option>
                      </NativeSelect>
                      <NativeSelect
                        className="w-40"
                        value={granularity}
                        aria-label="Regroupement"
                        onChange={(e) => update({ granularity: e.target.value })}
                      >
                        <option value="day">Par jour</option>
                        <option value="week">Par semaine</option>
                        <option value="month">Par mois</option>
                        <option value="year">Par année</option>
                      </NativeSelect>
                    </>
                  )}
                  {entry.needs?.includes('productId') && (
                    <div className="w-72">
                      <ProductPicker
                        mode="purchase"
                        clearOnSelect={false}
                        placeholder={productName || 'Choisir un produit…'}
                        onSelect={(p) => {
                          setProductName(p.name);
                          update({ productId: p.id });
                        }}
                      />
                    </div>
                  )}
                  {entry.needs?.includes('lotNumber') && (
                    <form
                      className="flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        update({ lotNumber: lotInput.trim() });
                      }}
                    >
                      <Input
                        className="w-56"
                        value={lotInput}
                        placeholder="Numéro de lot"
                        aria-label="Numéro de lot"
                        onChange={(e) => setLotInput(e.target.value)}
                      />
                      <Button type="submit" variant="outline">
                        Rechercher
                      </Button>
                    </form>
                  )}
                  {entry.needs?.includes('days') && (
                    <Input
                      type="number"
                      min={7}
                      max={730}
                      className="w-40"
                      value={days}
                      placeholder="Jours sans vente"
                      aria-label="Jours sans vente"
                      onChange={(e) => update({ days: e.target.value })}
                    />
                  )}
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!data || exporting !== null}
                      onClick={() => void doExport('xlsx')}
                    >
                      {exporting === 'xlsx' ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <FileSpreadsheet />
                      )}{' '}
                      Excel
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!data || exporting !== null}
                      onClick={() => void doExport('pdf')}
                    >
                      {exporting === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText />}{' '}
                      PDF
                    </Button>
                    <Button variant="outline" onClick={() => window.print()}>
                      <Printer /> Imprimer
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {entry && !ready && (
            <EmptyState
              title="Précisez le critère"
              description={
                entry.needs?.includes('productId')
                  ? 'Choisissez un produit pour afficher l’évolution de ses prix d’achat.'
                  : 'Saisissez un numéro de lot.'
              }
            />
          )}
          {ready && report.isLoading && <Skeleton className="h-72" />}
          {ready && report.error && (
            <ErrorState error={report.error} onRetry={() => void report.refetch()} />
          )}
          {ready && data && (
            <div className="flex flex-col gap-4">
              <div className="hidden print:block">
                <h2 className="text-lg font-semibold">{data.title}</h2>
                {data.from && data.to && (
                  <p className="text-sm">
                    Période : du {fmt.isoDate(data.from)} au {fmt.isoDate(data.to)}
                  </p>
                )}
              </div>
              {data.comparison && (
                <p className="text-sm text-muted-foreground">
                  Comparé à : {data.comparison.label.toLowerCase()} (
                  {fmt.isoDate(data.comparison.from)} → {fmt.isoDate(data.comparison.to)})
                </p>
              )}
              {data.kpis.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {data.kpis.map((k) => {
                    const delta = variation(k.value, k.previous);
                    const good =
                      k.key === 'returnsTtc' || k.key === 'discount' || k.key === 'cancelled'
                        ? delta !== null && delta < 0
                        : delta !== null && delta > 0;
                    return (
                      <Card key={k.key}>
                        <CardContent className="p-4">
                          <div className="text-xs text-muted-foreground">{k.label}</div>
                          <div className="text-xl font-semibold tabular">
                            {formatKpi(k.value, k.type, fmt)}
                          </div>
                          {k.previous !== undefined && (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              {delta !== null && (
                                <span
                                  className={cn(
                                    'flex items-center font-medium',
                                    good ? 'text-emerald-600' : 'text-red-600',
                                  )}
                                >
                                  {delta > 0 ? (
                                    <ArrowUpRight className="size-3" />
                                  ) : (
                                    <ArrowDownRight className="size-3" />
                                  )}
                                  {Math.abs(delta).toLocaleString('fr-FR', {
                                    maximumFractionDigits: 1,
                                  })}{' '}
                                  %
                                </span>
                              )}
                              <span>avant : {formatKpi(k.previous, k.type, fmt)}</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
              {option && (
                <Card>
                  <CardContent className="pt-4">
                    <Chart
                      option={option}
                      height={data.chart?.type === 'heatmap' ? 340 : 300}
                      label={data.title}
                    />
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>
                    Détail{' '}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({data.rows.length} ligne{data.rows.length > 1 ? 's' : ''})
                    </span>
                  </CardTitle>
                </CardHeader>
                {data.rows.length === 0 ? (
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Aucune donnée sur cette période.
                    </p>
                  </CardContent>
                ) : (
                  <div className="max-h-[70vh] overflow-auto print:max-h-none">
                    <Table>
                      <THead>
                        <TR>
                          {data.columns.map((c) => (
                            <TH
                              key={c.key}
                              className={cn(
                                c.type !== 'text' &&
                                  c.type !== 'date' &&
                                  c.type !== 'datetime' &&
                                  'text-right',
                              )}
                            >
                              {c.header}
                            </TH>
                          ))}
                        </TR>
                      </THead>
                      <TBody>
                        {data.rows.map((row, i) => (
                          <TR key={i}>
                            {data.columns.map((c) => (
                              <TD
                                key={c.key}
                                className={cn(
                                  c.type !== 'text' &&
                                    c.type !== 'date' &&
                                    c.type !== 'datetime' &&
                                    'text-right tabular',
                                )}
                              >
                                {formatCell(c, row[c.key], fmt)}
                              </TD>
                            ))}
                          </TR>
                        ))}
                        {data.totals && (
                          <TR className="bg-muted/50 font-semibold">
                            {data.columns.map((c) => (
                              <TD
                                key={c.key}
                                className={cn(
                                  c.type !== 'text' &&
                                    c.type !== 'date' &&
                                    c.type !== 'datetime' &&
                                    'text-right tabular',
                                )}
                              >
                                {formatCell(c, data.totals![c.key], fmt)}
                              </TD>
                            ))}
                          </TR>
                        )}
                      </TBody>
                    </Table>
                  </div>
                )}
              </Card>
              {data.notes.length > 0 && (
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {data.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
