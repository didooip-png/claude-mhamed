import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Link } from 'react-router';
import { ErrorState } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';

interface Activity {
  userId: string;
  code: string;
  name: string;
  salesCount: number;
  salesTotal: number;
  discountTotal: number;
  discountOverLimit: number;
  returnsCount: number;
  returnsTotal: number;
  cancellations: number;
  lineRemovals: number;
  adminCodesUsed: number;
  cashDifference: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

/** Rapport d'activité d'une journée, par employé (§6.19 B). */
export function ActivityTab() {
  const fmt = useFormat();
  const [date, setDate] = React.useState(today());
  const report = useQuery({
    queryKey: ['audit', 'activity', date],
    queryFn: () =>
      api.get<{
        date: string;
        rows: Activity[];
        totals: {
          salesCount: number;
          salesTotal: number;
          returnsTotal: number;
          cancellations: number;
        };
      }>('/notifications/activity-report', { query: { date } }),
  });
  const time = (v: string | null) => (v ? fmt.dateTime(v).slice(-5) : '—');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          type="date"
          className="w-44"
          value={date}
          max={today()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Journée"
        />
        {report.data && (
          <span className="text-sm text-muted-foreground">
            {report.data.totals.salesCount} vente(s) · {fmt.money(report.data.totals.salesTotal)} ·{' '}
            {report.data.totals.cancellations} annulation(s)
          </span>
        )}
      </div>
      {report.error && <ErrorState error={report.error} onRetry={() => void report.refetch()} />}
      {report.isLoading && <Skeleton className="h-40" />}
      {report.data && (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Employé</TH>
                <TH className="text-right">Ventes</TH>
                <TH className="text-right">Remises</TH>
                <TH className="text-right">Retours</TH>
                <TH className="text-right">Annulations</TH>
                <TH className="text-right">Lignes retirées</TH>
                <TH className="text-right">Codes admin</TH>
                <TH className="text-right">Écart de caisse</TH>
                <TH>Activité</TH>
              </TR>
            </THead>
            <TBody>
              {report.data.rows.length === 0 && (
                <TR>
                  <TD colSpan={9} className="py-8 text-center text-muted-foreground">
                    Aucune activité ce jour-là.
                  </TD>
                </TR>
              )}
              {report.data.rows.map((r) => (
                <TR key={r.userId}>
                  <TD>
                    <span className="font-mono font-medium">{r.code}</span>
                    <div className="text-xs text-muted-foreground">{r.name}</div>
                  </TD>
                  <TD className="text-right tabular">
                    <Link
                      to={`/sales?userId=${r.userId}&from=${date}&to=${date}`}
                      className="text-primary hover:underline"
                    >
                      {r.salesCount}
                    </Link>
                    <div className="text-xs text-muted-foreground">{fmt.money(r.salesTotal)}</div>
                  </TD>
                  <TD className="text-right tabular">
                    {fmt.money(r.discountTotal)}
                    {r.discountOverLimit > 0 && (
                      <div className="text-xs text-amber-700">
                        {r.discountOverLimit} hors plafond
                      </div>
                    )}
                  </TD>
                  <TD className="text-right tabular">
                    {r.returnsCount}
                    {r.returnsCount > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {fmt.money(r.returnsTotal)}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right tabular">{r.cancellations}</TD>
                  <TD className="text-right tabular">{r.lineRemovals}</TD>
                  <TD className="text-right tabular">{r.adminCodesUsed}</TD>
                  <TD className="text-right tabular">
                    {r.cashDifference === null ? '—' : fmt.money(r.cashDifference)}
                  </TD>
                  <TD className="text-xs">
                    <span className="tabular">
                      {time(r.firstAt)} → {time(r.lastAt)}
                    </span>
                    <div>
                      <Link
                        to={`/audit?userId=${r.userId}&from=${date}&to=${date}`}
                        className="text-primary hover:underline"
                      >
                        Mouchard
                      </Link>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
