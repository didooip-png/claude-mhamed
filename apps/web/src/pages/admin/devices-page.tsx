import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MoreHorizontal, Pencil, ShieldOff } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/data-table';
import { FormField } from '@/components/form';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getDevice } from '@/lib/device';
import { useFormat } from '@/lib/format';

interface DeviceRow {
  id: string;
  name: string;
  kind: 'WEB' | 'DESKTOP';
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  lastSeenAt: string | null;
  lastIp: string | null;
  userAgent: string | null;
  createdAt: string;
}

const STATUS: Record<DeviceRow['status'], { label: string; variant: 'orange' | 'green' | 'gray' }> =
  {
    PENDING: { label: 'En attente', variant: 'orange' },
    APPROVED: { label: 'Approuvé', variant: 'green' },
    REVOKED: { label: 'Révoqué', variant: 'gray' },
  };

export function DevicesPage() {
  const fmt = useFormat();
  const qc = useQueryClient();
  const { recheckDevice } = useAuth();
  const current = getDevice()?.id;
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get<DeviceRow[]>('/devices'),
  });
  const [renaming, setRenaming] = React.useState<DeviceRow | null>(null);
  const [name, setName] = React.useState('');

  const act = useMutation({
    mutationFn: ({
      id,
      op,
      body,
    }: {
      id: string;
      op: 'approve' | 'revoke' | 'rename';
      body?: unknown;
    }) => api.post(`/devices/${id}/${op}`, body),
    onSuccess: (_d, v) => {
      toast.success(
        v.op === 'approve'
          ? 'Poste approuvé'
          : v.op === 'revoke'
            ? 'Poste révoqué — ses sessions sont fermées'
            : 'Poste renommé',
      );
      void qc.invalidateQueries({ queryKey: ['devices'] });
      if (v.id === current && v.op === 'rename') void recheckDevice();
      setRenaming(null);
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const columns: Column<DeviceRow>[] = [
    {
      accessorKey: 'name',
      header: 'Poste',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.id === current && <Badge variant="blue">Ce poste</Badge>}
        </div>
      ),
    },
    {
      id: 'kind',
      header: 'Type',
      cell: ({ row }) => (row.original.kind === 'WEB' ? 'Navigateur' : 'Application de bureau'),
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => (
        <Badge variant={STATUS[row.original.status].variant}>
          {STATUS[row.original.status].label}
        </Badge>
      ),
    },
    {
      id: 'seen',
      header: 'Dernière activité',
      cell: ({ row }) => (
        <span className="tabular">{fmt.dateTime(row.original.lastSeenAt) || '—'}</span>
      ),
    },
    {
      id: 'ip',
      header: 'Adresse IP',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.lastIp ?? '—'}</span>,
    },
    {
      id: 'created',
      header: 'Enregistré le',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.createdAt)}</span>,
    },
    {
      id: 'actions',
      header: '',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const d = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {d.status !== 'APPROVED' && (
                <DropdownMenuItem onSelect={() => act.mutate({ id: d.id, op: 'approve' })}>
                  <Check /> Approuver
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  setName(d.name);
                  setRenaming(d);
                }}
              >
                <Pencil /> Renommer
              </DropdownMenuItem>
              {d.status !== 'REVOKED' && (
                <DropdownMenuItem
                  destructive
                  disabled={d.id === current}
                  onSelect={() => act.mutate({ id: d.id, op: 'revoke' })}
                >
                  <ShieldOff /> Révoquer
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Postes de travail"
        description="Chaque navigateur ou installation s’enregistre comme poste. Un poste perdu, volé ou remplacé doit être révoqué."
      />
      <DataTable
        columns={columns}
        data={devices.data}
        isLoading={devices.isLoading}
        error={devices.error}
        onRetry={() => void devices.refetch()}
      />
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Renommer le poste</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming) act.mutate({ id: renaming.id, op: 'rename', body: { name } });
            }}
          >
            <FormField label="Nom">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Annuler
              </Button>
              <Button type="submit" loading={act.isPending} disabled={name.trim().length < 2}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
