import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Banknote,
  Boxes,
  Clock,
  Coins,
  PackageX,
  ShoppingCart,
  TimerReset,
  TrendingDown,
  Users,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { Chart } from '@/components/chart';
import { AVAILABLE_ROUTES, NAV } from '@/components/layout/nav';
import { ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import { variation } from '@/lib/report-format';
import { cn } from '@/lib/utils';

interface Kpis {
  revenueTtc: number;
  revenueHt: number;
  salesCount: number;
  avgBasket: number;
  margin: number;
  marginRate: number;
  returnsTtc: number;
}

interface Alerts {
  outOfStock: number;
  lowStock: number;
  expiredLots: number;
  expiring: { days: number; lots: number }[];
  creditExceeded?: number;
  cashDiscrepancies?: { count: number; total: number };
  cancellationsToday?: { count: number; totalTtc: number };
}

interface FullDashboard {
  scope: 'FULL';
  today: string;
  periods: Record<
    'day' | 'week' | 'month',
    { current: Kpis; previous: Kpis; label: string; previousLabel: string }
  >;
  series: { day: string; salesCount: number; revenueTtc: number; margin: number }[];
  payments: { label: string; amount: number }[];
  paymentsTotal: number;
  topProducts: { label: string; qty: number; revenueTtc: number; margin: number }[];
  receivables: { total: number; clients: number; overdue: number; overdueInvoices: number };
  stockValue: { cost: number; sale: number };
  alerts: Alerts;
}

interface PersonalDashboard {
  scope: 'PERSONAL';
  today: string;
  mySales: { count: number; totalTtc: number };
  onHold: number;
  alerts: Alerts;
}

type Dashboard = FullDashboard | PersonalDashboard;

function Delta({
  current,
  previous,
  invert,
}: {
  current: number;
  previous: number;
  invert?: boolean;
}) {
  const v = variation(current, previous);
  if (v === null) return null;
  const good = invert ? v < 0 : v > 0;
  return (
    <span
      className={cn(
        'flex items-center text-xs font-medium',
        good ? 'text-emerald-600' : 'text-red-600',
      )}
    >
      {v > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %
    </span>
  );
}

function AlertTile({
  icon: Icon,
  label,
  value,
  to,
  tone = 'neutral',
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  to?: string;
  tone?: 'neutral' | 'warn' | 'bad' | 'ok';
  hint?: string;
}) {
  const body = (
    <Card
      className={cn('h-full transition-colors', to && 'hover:border-primary/40 hover:bg-accent/40')}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            tone === 'bad' && 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
            tone === 'warn' && 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
            tone === 'ok' &&
              'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
            tone === 'neutral' && 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          <div className="text-lg leading-tight font-semibold tabular">{value}</div>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Shortcuts() {
  const me = useMe();
  const shortcuts = NAV.flatMap((item) => {
    const can = (anyOf?: string[]) =>
      !anyOf || anyOf.some((p) => me.permissions.includes(p as never));
    if (!can(item.anyOf)) return [];
    const children = item.children?.filter((c) => can(c.anyOf) && AVAILABLE_ROUTES.has(c.to)) ?? [];
    return item.children
      ? children.map((c) => ({ label: c.label, to: c.to, icon: item.icon, group: item.label }))
      : AVAILABLE_ROUTES.has(item.to) && item.to !== '/'
        ? [{ label: item.label, to: item.to, icon: item.icon, group: '' }]
        : [];
  });
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Accès rapides</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {shortcuts.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.to} to={s.to}>
              <Card className="transition-colors hover:border-primary/40 hover:bg-accent/40">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {s.group && <div className="text-xs text-muted-foreground">{s.group}</div>}
                    <div className="truncate text-sm font-medium">{s.label}</div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function StockAlerts({ alerts, full }: { alerts: Alerts; full: boolean }) {
  return (
    <>
      <AlertTile
        icon={PackageX}
        label="Ruptures de stock"
        value={alerts.outOfStock}
        to="/stock?status=OUT"
        tone={alerts.outOfStock > 0 ? 'bad' : 'ok'}
      />
      <AlertTile
        icon={TrendingDown}
        label="Sous le seuil minimum"
        value={alerts.lowStock}
        to="/stock?status=LOW"
        tone={alerts.lowStock > 0 ? 'warn' : 'ok'}
      />
      <AlertTile
        icon={Ban}
        label="Lots périmés à retirer"
        value={alerts.expiredLots}
        to="/stock/expiries"
        tone={alerts.expiredLots > 0 ? 'bad' : 'ok'}
        hint={full && alerts.expiredLots > 0 ? 'Destruction ou retour fournisseur' : undefined}
      />
      {alerts.expiring.map((e) => (
        <AlertTile
          key={e.days}
          icon={TimerReset}
          label={`Péremption ≤ ${e.days} jours`}
          value={e.lots}
          to="/stock/expiries"
          tone={e.lots > 0 ? 'warn' : 'ok'}
          hint={e.lots > 0 ? 'lot(s) à écouler' : undefined}
        />
      ))}
    </>
  );
}

function PeriodCard({
  title,
  previousLabel,
  current,
  previous,
}: {
  title: string;
  previousLabel: string;
  current: Kpis;
  previous: Kpis;
  label?: string;
}) {
  const fmt = useFormat();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular">{fmt.money(current.revenueTtc)}</span>
          <Delta current={current.revenueTtc} previous={previous.revenueTtc} />
        </div>
        <div className="text-xs text-muted-foreground">
          HT {fmt.money(current.revenueHt)} · {previousLabel.toLowerCase()} :{' '}
          {fmt.money(previous.revenueTtc)}
        </div>
        <dl className="mt-1 grid grid-cols-3 gap-2 border-t pt-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Ventes</dt>
            <dd className="font-medium tabular">{current.salesCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Panier moyen</dt>
            <dd className="font-medium tabular">{fmt.money(current.avgBasket)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Marge</dt>
            <dd className="font-medium tabular">
              {fmt.money(current.margin)}
              <span className="block text-xs whitespace-nowrap text-muted-foreground sm:ml-1 sm:inline">
                ({(current.marginRate / 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}{' '}
                %)
              </span>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function FullView({ d }: { d: FullDashboard }) {
  const fmt = useFormat();
  const seriesOption = React.useMemo(
    () => ({
      tooltip: {
        trigger: 'axis',
        formatter: (
          params: { name: string; marker: string; seriesName: string; value: number }[],
        ) =>
          `${fmt.isoDate(params[0]?.name ?? '')}<br/>${params
            .map(
              (p) => `${p.marker}${p.seriesName} : <b>${fmt.money(Math.round(p.value * 1000))}</b>`,
            )
            .join('<br/>')}`,
      },
      legend: { top: 0 },
      grid: { left: 52, right: 12, top: 32, bottom: 24 },
      xAxis: {
        type: 'category',
        data: d.series.map((s) => s.day),
        axisLabel: {
          formatter: (v: string) => v.slice(8) + '/' + v.slice(5, 7),
          hideOverlap: true,
        },
      },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'CA TTC',
          type: 'line',
          areaStyle: { opacity: 0.12 },
          showSymbol: false,
          data: d.series.map((s) => s.revenueTtc / 1000),
        },
        {
          name: 'Marge',
          type: 'line',
          showSymbol: false,
          data: d.series.map((s) => s.margin / 1000),
        },
      ],
    }),
    [d.series, fmt],
  );
  const topOption = React.useMemo(
    () => ({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 150, right: 16, top: 8, bottom: 8 },
      xAxis: { type: 'value' },
      yAxis: {
        type: 'category',
        inverse: true,
        data: d.topProducts.map((p) => p.label),
        axisLabel: { width: 140, overflow: 'truncate' },
      },
      series: [
        {
          name: 'CA TTC (DT)',
          type: 'bar',
          barMaxWidth: 18,
          data: d.topProducts.map((p) => p.revenueTtc / 1000),
        },
      ],
    }),
    [d.topProducts],
  );
  const a = d.alerts;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <PeriodCard {...d.periods.day} title={d.periods.day.label} />
        <PeriodCard {...d.periods.week} title={d.periods.week.label} />
        <PeriodCard {...d.periods.month} title={d.periods.month.label} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Ventes des 30 derniers jours</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/reports/sales-summary?compare=previous">
                Détail <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Chart
              option={seriesOption}
              height={260}
              label="Chiffre d’affaires et marge sur 30 jours"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Encaissements du jour</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="text-2xl font-semibold tabular">{fmt.money(d.paymentsTotal)}</div>
            {d.payments.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun encaissement.</p>
            )}
            {d.payments.map((p) => (
              <div key={p.label} className="flex items-center justify-between text-sm">
                <span>{p.label}</span>
                <span className="font-medium tabular">{fmt.money(p.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Alertes et situation</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StockAlerts alerts={a} full />
          <AlertTile
            icon={Users}
            label="Plafonds de crédit dépassés"
            value={a.creditExceeded ?? 0}
            to="/clients"
            tone={(a.creditExceeded ?? 0) > 0 ? 'bad' : 'ok'}
          />
          <AlertTile
            icon={Coins}
            label="Écarts de caisse du jour"
            value={a.cashDiscrepancies?.count ?? 0}
            to="/cash"
            tone={(a.cashDiscrepancies?.count ?? 0) > 0 ? 'warn' : 'ok'}
            hint={a.cashDiscrepancies?.count ? fmt.money(a.cashDiscrepancies.total) : undefined}
          />
          <AlertTile
            icon={AlertTriangle}
            label="Annulations du jour"
            value={a.cancellationsToday?.count ?? 0}
            to="/audit?tab=cancelled"
            tone={(a.cancellationsToday?.count ?? 0) > 0 ? 'warn' : 'ok'}
            hint={
              a.cancellationsToday?.count ? fmt.money(a.cancellationsToday.totalTtc) : undefined
            }
          />
          <AlertTile
            icon={Banknote}
            label="Créances clients"
            value={fmt.money(d.receivables.total)}
            to="/payments/aging"
            hint={`${d.receivables.clients} client(s)`}
          />
          <AlertTile
            icon={Clock}
            label="Factures échues"
            value={d.receivables.overdueInvoices}
            to="/payments/aging"
            tone={d.receivables.overdueInvoices > 0 ? 'bad' : 'ok'}
            hint={d.receivables.overdue > 0 ? fmt.money(d.receivables.overdue) : undefined}
          />
          <AlertTile
            icon={Boxes}
            label="Stock au coût d’achat"
            value={fmt.money(d.stockValue.cost)}
            to="/reports/stock-valuation"
          />
          <AlertTile
            icon={ShoppingCart}
            label="Stock au prix de vente"
            value={fmt.money(d.stockValue.sale)}
            to="/reports/stock-valuation"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Top 10 des produits du mois</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/reports/top-products?compare=none">
              Détail <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {d.topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune vente ce mois-ci.</p>
          ) : (
            <Chart
              option={topOption}
              height={Math.max(180, d.topProducts.length * 28)}
              label="Top 10 des produits du mois"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PersonalView({ d }: { d: PersonalDashboard }) {
  const fmt = useFormat();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AlertTile
          icon={ShoppingCart}
          label="Mes ventes du jour"
          value={d.mySales.count}
          to="/sales"
          hint={fmt.money(d.mySales.totalTtc)}
        />
        <AlertTile
          icon={Clock}
          label="Ventes en attente"
          value={d.onHold}
          to="/sales/on-hold"
          tone={d.onHold > 0 ? 'warn' : 'ok'}
        />
        <StockAlerts alerts={d.alerts} full={false} />
      </div>
      <div>
        <Button asChild size="lg">
          <Link to="/pos">
            <ShoppingCart /> Ouvrir la caisse
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Tableau de bord (§6.1) : complet pour l'administrateur, personnel pour un préparateur. */
export function DashboardPage() {
  const me = useMe();
  const settings = useSettings();
  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/dashboard'),
    refetchInterval: 60_000,
  });
  return (
    <>
      <PageHeader
        title={`Bonjour ${me.fullName.split(' ')[0]}`}
        description={`${settings['establishment.name']} — ${me.role.name} (${me.code})`}
      />
      <div className="flex flex-col gap-6">
        {dash.error && <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />}
        {dash.isLoading && <Skeleton className="h-64" />}
        {dash.data?.scope === 'FULL' && <FullView d={dash.data} />}
        {dash.data?.scope === 'PERSONAL' && <PersonalView d={dash.data} />}
        <Shortcuts />
      </div>
    </>
  );
}
