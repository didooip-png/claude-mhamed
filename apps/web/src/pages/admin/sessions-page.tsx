import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, errorText } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useFormat } from '@/lib/format';

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  lockedAt: string | null;
  user: { id: string; code: string; fullName: string };
  device: { id: string; name: string } | null;
}

export function SessionsPage() {
  const fmt = useFormat();
  const me = useMe();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRow[]>('/auth/sessions'),
    refetchInterval: 30_000,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/auth/sessions/${id}/revoke`),
    onSuccess: () => {
      toast.success('Session fermée');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const columns: Column<SessionRow>[] = [
    {
      id: 'user',
      header: 'Utilisateur',
      cell: ({ row }) => (
        <span>
          <span className="font-mono font-medium">{row.original.user.code}</span> —{' '}
          {row.original.user.fullName}
        </span>
      ),
    },
    { id: 'device', header: 'Poste', cell: ({ row }) => row.original.device?.name ?? '—' },
    {
      id: 'state',
      header: 'État',
      cell: ({ row }) =>
        row.original.lockedAt ? (
          <Badge variant="yellow">Écran verrouillé</Badge>
        ) : (
          <Badge variant="green">Active</Badge>
        ),
    },
    {
      id: 'since',
      header: 'Ouverte le',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.createdAt)}</span>,
    },
    {
      id: 'seen',
      header: 'Dernière activité',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.lastSeenAt)}</span>,
    },
    {
      id: 'ip',
      header: 'IP',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.ip ?? '—'}</span>,
    },
    {
      id: 'actions',
      header: '',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.user.id === me.id ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => revoke.mutate(row.original.id)}
            loading={revoke.isPending && revoke.variables === row.original.id}
          >
            <LogOut /> Déconnecter
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Sessions actives"
        description="Utilisateurs actuellement connectés. La déconnexion forcée est tracée au mouchard."
      />
      <DataTable
        columns={columns}
        data={sessions.data}
        isLoading={sessions.isLoading}
        error={sessions.error}
        emptyTitle="Aucune session active"
      />
    </>
  );
}
