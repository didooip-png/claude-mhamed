import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Play, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useFormat } from '@/lib/format';

type Schedule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

interface Run {
  startedAt: string;
  finishedAt?: string | null;
  status: string;
  trigger: string;
  detail: Record<string, unknown> | null;
}

interface JobStatus {
  name: string;
  label: string;
  description: string;
  schedule: Schedule;
  lastRun: Run | null;
  history: Run[];
}

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const hhmm = (s: { hour: number; minute: number }) =>
  `${String(s.hour).padStart(2, '0')} h ${String(s.minute).padStart(2, '0')}`;

function scheduleText(s: Schedule): string {
  if (s.kind === 'daily') return `Chaque jour à ${hhmm(s)}`;
  if (s.kind === 'weekly') return `Chaque ${WEEKDAYS[s.weekday]} à ${hhmm(s)}`;
  return `Le ${s.day === 1 ? '1er' : s.day} de chaque mois à ${hhmm(s)}`;
}

const LABELS: Record<string, string> = {
  checked: 'éléments contrôlés',
  inconsistent: 'incohérents',
  ok: 'conforme',
  expired: 'périmés',
  expiring: 'à surveiller',
  suggestions: 'à commander',
  overdue: 'factures échues',
  reminders: 'relances',
  sent: 'relevés envoyés',
  outOfStock: 'en rupture',
};

function summary(detail: Record<string, unknown> | null): string {
  if (!detail) return '';
  if (typeof detail.error === 'string') return detail.error;
  if (detail.skipped) return 'désactivé dans les paramètres';
  return Object.entries(detail)
    .filter(([k, v]) => k in LABELS && (typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => (typeof v === 'boolean' ? LABELS[k] : `${String(v)} ${LABELS[k]}`))
    .join(' · ');
}

/** Tâches planifiées : état, dernière exécution et lancement à la demande (administrateur). */
export function JobsPage() {
  const fmt = useFormat();
  const qc = useQueryClient();
  const jobs = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: () => api.get<JobStatus[]>('/admin/jobs'),
    refetchInterval: 30_000,
  });
  const run = useMutation({
    mutationFn: (name: string) => api.post<JobStatus[]>(`/admin/jobs/${name}/run`),
    onSuccess: (res) => {
      toast.success('Tâche exécutée');
      qc.setQueryData(['admin', 'jobs'], res);
    },
    onError: (err) => toast.error(errorText(err)),
  });
  if (jobs.error) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  return (
    <>
      <PageHeader
        title="Tâches planifiées"
        description="Contrôles et alertes automatiques. Chaque tâche s’exécute une fois par période ; vous pouvez la lancer à la demande."
      />
      {!jobs.data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Tâche</TH>
                <TH>Planification</TH>
                <TH>Dernière exécution</TH>
                <TH>Résultat</TH>
                <TH className="w-32" />
              </TR>
            </THead>
            <TBody>
              {jobs.data.map((j) => (
                <TR key={j.name}>
                  <TD>
                    <div className="font-medium">{j.label}</div>
                    <div className="max-w-md text-xs text-muted-foreground">{j.description}</div>
                  </TD>
                  <TD className="text-sm">{scheduleText(j.schedule)}</TD>
                  <TD>
                    {j.lastRun ? (
                      <div className="flex items-center gap-1.5 text-sm">
                        {j.lastRun.status === 'OK' ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : j.lastRun.status === 'FAILED' ? (
                          <XCircle className="size-4 text-red-600" />
                        ) : (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        <span className="tabular">{fmt.dateTime(j.lastRun.startedAt)}</span>
                        {j.lastRun.trigger === 'MANUAL' && <Badge variant="gray">Manuel</Badge>}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Jamais exécutée</span>
                    )}
                  </TD>
                  <TD className="max-w-xs text-xs">{summary(j.lastRun?.detail ?? null)}</TD>
                  <TD>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={run.isPending}
                      onClick={() => run.mutate(j.name)}
                    >
                      {run.isPending && run.variables === j.name ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Play />
                      )}{' '}
                      Lancer
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
