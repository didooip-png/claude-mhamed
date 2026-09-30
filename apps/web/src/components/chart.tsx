import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import * as React from 'react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export const CHART_COLORS = [
  '#0f766e',
  '#0ea5e9',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#64748b',
  '#ec4899',
];

/** Graphique ECharts : thème clair / sombre, redimensionnement automatique. */
export function Chart({
  option,
  height = 280,
  className,
  label,
}: {
  option: echarts.EChartsCoreOption;
  height?: number;
  className?: string;
  /** Description accessible du graphique. */
  label: string;
}) {
  const { theme } = useTheme();
  const ref = React.useRef<HTMLDivElement>(null);
  const instance = React.useRef<echarts.ECharts | null>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);

  React.useEffect(() => {
    const dark = theme === 'dark';
    instance.current?.setOption(
      {
        color: CHART_COLORS,
        backgroundColor: 'transparent',
        textStyle: { color: dark ? '#cbd5e1' : '#475569' },
        animationDuration: 300,
        ...option,
      },
      { notMerge: true },
    );
  }, [option, theme]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={cn('w-full', className)}
      style={{ height }}
    />
  );
}
