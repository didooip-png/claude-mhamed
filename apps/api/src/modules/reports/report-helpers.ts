import {
  addDaysIso,
  addMonthsIso,
  diffDaysIso,
  endOfLocalDayExclusive,
  startOfLocalDay,
  todayIso,
  type ReportCell,
  type ReportChart,
  type ReportColumn,
  type ReportId,
  type ReportKpi,
  type ReportQuery,
  type ReportResult,
  type SettingsMap,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';

export type Row = Record<string, ReportCell>;

/** Contexte d'un rapport : fuseau, période locale et bornes UTC (fin exclusive). */
export interface ReportContext {
  settings: SettingsMap;
  tz: string;
  today: string;
  from: string;
  to: string;
  fromTs: Date;
  toTs: Date;
  query: ReportQuery;
}

/** Nombre (les agrégats SQL arrivent en bigint / numeric). */
export const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Rapport en points de base (10 000 = 100 %), arrondi. */
export const bp = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part * 10_000) / whole);

export function buildContext(settings: SettingsMap, query: ReportQuery): ReportContext {
  const tz = settings['general.timezone'];
  const today = todayIso(tz, now());
  const to = query.to ?? today;
  const from = query.from ?? `${to.slice(0, 7)}-01`;
  if (from > to)
    throw new AppError('VALIDATION_ERROR', undefined, { message: 'La période est inversée.' });
  if (diffDaysIso(from, to) > 3 * 366)
    throw new AppError('VALIDATION_ERROR', undefined, {
      message: 'La période ne peut pas dépasser trois ans.',
    });
  return {
    settings,
    tz,
    today,
    from,
    to,
    fromTs: startOfLocalDay(from, tz),
    toTs: endOfLocalDayExclusive(to, tz),
    query,
  };
}

/** Période de comparaison : précédente de même durée, ou mêmes dates l'année précédente. */
export function comparisonPeriod(
  from: string,
  to: string,
  mode: 'none' | 'previous' | 'year',
): { from: string; to: string; label: string } | null {
  if (mode === 'none') return null;
  if (mode === 'year')
    return { from: addMonthsIso(from, -12), to: addMonthsIso(to, -12), label: 'Année précédente' };
  const length = diffDaysIso(from, to) + 1;
  const prevTo = addDaysIso(from, -1);
  return { from: addDaysIso(prevTo, -(length - 1)), to: prevTo, label: 'Période précédente' };
}

export function emptyResult(
  id: ReportId,
  title: string,
  ctx: ReportContext | null,
  parts: {
    columns: ReportColumn[];
    rows: Row[];
    kpis?: ReportKpi[];
    totals?: Row | null;
    chart?: ReportChart | null;
    notes?: string[];
    comparison?: ReportResult['comparison'];
  },
): ReportResult {
  return {
    id,
    title,
    from: ctx?.from ?? null,
    to: ctx?.to ?? null,
    comparison: parts.comparison ?? null,
    kpis: parts.kpis ?? [],
    columns: parts.columns,
    rows: parts.rows,
    totals: parts.totals ?? null,
    chart: parts.chart ?? null,
    notes: parts.notes ?? [],
  };
}

/** Somme d'une colonne numérique. */
export const total = (rows: Row[], key: string): number =>
  rows.reduce((acc, r) => acc + n(r[key]), 0);

export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
