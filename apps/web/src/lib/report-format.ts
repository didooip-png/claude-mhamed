import type { ReportCell, ReportChart, ReportColumn, ReportResult } from '@pharmastock/shared';
import type { useFormat } from './format';

type Fmt = ReturnType<typeof useFormat>;

const num = (v: ReportCell | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0));

/** Valeur d'une cellule de rapport, mise en forme selon le type de sa colonne. */
export function formatCell(
  col: Pick<ReportColumn, 'type'>,
  value: ReportCell | undefined,
  fmt: Fmt,
): string {
  if (value === null || value === undefined || value === '') return '';
  switch (col.type) {
    case 'money':
      return fmt.amount(num(value));
    case 'percent':
      return `${(num(value) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
    case 'int':
    case 'qty':
      return typeof value === 'number' ? value.toLocaleString('fr-FR') : String(value);
    case 'decimal':
      return typeof value === 'number'
        ? value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
        : String(value);
    case 'date':
      return fmt.isoDate(String(value).slice(0, 10));
    case 'datetime':
      return fmt.dateTime(String(value));
    default:
      return String(value);
  }
}

export function formatKpi(
  value: number | null | undefined,
  type: 'money' | 'int' | 'percent' | 'decimal',
  fmt: Fmt,
): string {
  if (value === null || value === undefined) return '—';
  if (type === 'money') return fmt.money(value);
  return formatCell({ type }, value, fmt);
}

/** Variation en pourcentage entre la valeur courante et la précédente (null si non calculable). */
export function variation(
  current: number | null,
  previous: number | null | undefined,
): number | null {
  if (current === null || previous === null || previous === undefined || previous === 0)
    return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Options ECharts d'un graphique de rapport (courbe, barres, secteurs, carte de chaleur). */
export function chartOption(report: ReportResult, fmt: Fmt): Record<string, unknown> | null {
  const chart: ReportChart | null = report.chart;
  if (!chart || report.rows.length === 0) return null;
  const rows = report.rows;
  const scale = (type: string, v: number) =>
    type === 'money' ? v / 1000 : type === 'percent' ? v / 100 : v;
  const show = (type: string, v: number) =>
    type === 'money'
      ? fmt.money(v)
      : type === 'percent'
        ? `${(v / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`
        : v.toLocaleString('fr-FR');
  const tooltipFormatter = (series: ReportChart['series']) => (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as {
      seriesIndex: number;
      seriesName: string;
      name: string;
      marker: string;
      value: number | number[];
    }[];
    const title = list[0]?.name ?? '';
    const lines = list.map((p) => {
      const type = series[p.seriesIndex]?.type ?? 'int';
      const raw = Array.isArray(p.value) ? (p.value[1] ?? 0) : p.value;
      const v = type === 'money' ? raw * 1000 : type === 'percent' ? raw * 100 : raw;
      return `${p.marker}${p.seriesName} : <b>${show(type, v)}</b>`;
    });
    return [title, ...lines].join('<br/>');
  };
  const label = (row: Record<string, ReportCell>) => String(row[chart.x] ?? '');

  if (chart.type === 'pie') {
    const s = chart.series[0]!;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/><b>${show(s.type, s.type === 'money' ? p.value * 1000 : p.value)}</b> (${p.percent} %)`,
      },
      legend: { type: 'scroll', bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['40%', '68%'],
          center: ['50%', '45%'],
          data: rows
            .filter((r) => num(r[s.key]) > 0)
            .slice(0, 12)
            .map((r) => ({ name: label(r), value: scale(s.type, num(r[s.key])) })),
          label: { show: false },
        },
      ],
    };
  }
  if (chart.type === 'heatmap') {
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')} h`);
    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const data = rows.map((r) => [num(r.hour), num(r.weekday), num(r[chart.value ?? 'sales'])]);
    const max = Math.max(1, ...data.map((d) => d[2] ?? 0));
    return {
      tooltip: {
        formatter: (p: { value: number[] }) =>
          `${days[p.value[1] ?? 0]} ${hours[p.value[0] ?? 0]}<br/><b>${p.value[2]}</b> vente(s)`,
      },
      grid: { left: 80, right: 20, top: 10, bottom: 78 },
      xAxis: { type: 'category', data: hours, splitArea: { show: true } },
      yAxis: { type: 'category', data: days, inverse: true, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#ecfdf5', '#5eead4', '#0f766e'] },
      },
      series: [{ type: 'heatmap', data, label: { show: false } }],
    };
  }
  const horizontal = chart.type === 'bar' && rows.length > 8;
  const shown = chart.type === 'bar' ? rows.slice(0, 20) : rows;
  const categories = shown.map(label);
  const axisType = chart.series[0]?.type ?? 'int';
  const valueAxis = {
    type: 'value' as const,
    axisLabel: {
      formatter: (v: number) =>
        axisType === 'money' ? `${v.toLocaleString('fr-FR')}` : v.toLocaleString('fr-FR'),
    },
  };
  const categoryAxis = {
    type: 'category' as const,
    data: categories,
    inverse: horizontal,
    axisLabel: horizontal ? { width: 140, overflow: 'truncate' as const } : { hideOverlap: true },
  };
  return {
    tooltip: { trigger: 'axis', formatter: tooltipFormatter(chart.series) },
    legend: chart.series.length > 1 ? { top: 0 } : undefined,
    grid: {
      left: horizontal ? 150 : 56,
      right: 16,
      top: chart.series.length > 1 ? 32 : 12,
      bottom: horizontal ? 8 : 28,
      containLabel: false,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: chart.series.map((s) => ({
      name: s.label,
      type: chart.type,
      smooth: false,
      showSymbol: shown.length < 40,
      areaStyle: chart.type === 'line' && chart.series.length === 1 ? { opacity: 0.12 } : undefined,
      barMaxWidth: 28,
      data: shown.map((r) => scale(s.type, num(r[s.key]))),
    })),
  };
}
