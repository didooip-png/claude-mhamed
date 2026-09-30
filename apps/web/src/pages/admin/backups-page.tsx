import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBytes } from '@pharmastock/shared';
import { Download, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useFormat } from '@/lib/format';

interface BackupRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  filename: string | null;
  sizeBytes: number | null;
  offsiteStatus: string | null;
  error: string | null;
  triggeredBy: string | null;
}

interface BackupList {
  offsiteConfigured: boolean;
  retentionDays: number;
  items: BackupRow[];
}

const STATUS = {
  RUNNING: <Badge variant="blue">En cours</Badge>,
  SUCCESS: <Badge variant="green">Réussie</Badge>,
  FAILED: <Badge variant="red">Échec</Badge>,
} as const;

/** Sauvegardes de la base : historique, sauvegarde immédiate, téléchargement (administrateur). */
export function BackupsPage() {
  const fmt = useFormat();
  const qc = useQueryClient();
  const backups = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => api.get<BackupList>('/admin/backups'),
    refetchInterval: 60_000,
  });
  const run = useMutation({
    mutationFn: () => api.post<BackupRow>('/admin/backups'),
    onSuccess: (b) => {
      toast.success(`Sauvegarde créée (${formatBytes(b.sizeBytes ?? 0)})`);
    },
    onError: (err) => toast.error(errorText(err)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin', 'backups'] }),
  });
  const download = useMutation({
    mutationFn: async (b: BackupRow) => {
      const blob = await api.blob(`/admin/backups/${b.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = b.filename ?? 'sauvegarde.dump';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onError: (err) => toast.error(errorText(err)),
  });
  if (backups.error)
    return <ErrorState error={backups.error} onRetry={() => void backups.refetch()} />;
  const data = backups.data;
  const last = data?.items.find((b) => b.status === 'SUCCESS');
  return (
    <>
      <PageHeader
        title="Sauvegardes"
        description="Sauvegarde complète de la base chaque nuit, vérifiée après création. Conservez une copie hors de la pharmacie."
        actions={
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Sauvegarder maintenant
          </Button>
        }
      />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Dernière sauvegarde réussie</div>
              <div className="mt-1 font-medium">
                {last ? fmt.dateTime(last.startedAt) : 'Aucune'}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Conservation locale</div>
              <div className="mt-1 font-medium">{data.retentionDays} jours</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Copie hors site</div>
              <div className="mt-1 font-medium">
                {data.offsiteConfigured ? 'Configurée (stockage S3)' : 'Non configurée'}
              </div>
              {!data.offsiteConfigured && (
                <div className="text-xs text-muted-foreground">
                  Renseignez S3_ENDPOINT, S3_BUCKET et les clés d’accès (voir le guide
                  d’exploitation).
                </div>
              )}
            </Card>
          </div>
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>Début</TH>
                  <TH>Statut</TH>
                  <TH>Déclenchée par</TH>
                  <TH className="text-right">Taille</TH>
                  <TH>Copie hors site</TH>
                  <TH className="w-28" />
                </TR>
              </THead>
              <TBody>
                {data.items.length === 0 && (
                  <TR>
                    <TD colSpan={6} className="py-8 text-center text-muted-foreground">
                      Aucune sauvegarde pour le moment.
                    </TD>
                  </TR>
                )}
                {data.items.map((b) => (
                  <TR key={b.id}>
                    <TD className="text-sm">{fmt.dateTime(b.startedAt)}</TD>
                    <TD>
                      {STATUS[b.status]}
                      {b.error && (
                        <div className="mt-1 max-w-sm text-xs text-red-600">{b.error}</div>
                      )}
                    </TD>
                    <TD className="text-sm">{b.triggeredBy ?? '—'}</TD>
                    <TD className="text-right text-sm tabular-nums">
                      {b.sizeBytes === null ? '—' : formatBytes(b.sizeBytes)}
                    </TD>
                    <TD className="text-sm">{b.offsiteStatus ?? '—'}</TD>
                    <TD>
                      {b.status === 'SUCCESS' && b.filename ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={download.isPending}
                          onClick={() => download.mutate(b)}
                        >
                          <Download /> Télécharger
                        </Button>
                      ) : b.status === 'SUCCESS' ? (
                        <span className="text-xs text-muted-foreground">Purgée</span>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
