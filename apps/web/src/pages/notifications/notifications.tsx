import type { Paginated } from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface NotificationRow {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

type NotificationPage = Paginated<NotificationRow> & { unread: number };

const SEVERITY_DOT = {
  INFO: 'bg-sky-500',
  WARNING: 'bg-amber-500',
  CRITICAL: 'bg-red-600',
} as const;

function useMarkRead() {
  const qc = useQueryClient();
  return React.useCallback(
    async (n: NotificationRow | 'all') => {
      if (n === 'all') await api.post('/notifications/read-all');
      else if (!n.readAt) await api.post(`/notifications/${n.id}/read`);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    [qc],
  );
}

/** Cloche du centre de notifications (§6.14), dans l'en-tête. */
export function NotificationBell() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const [open, setOpen] = React.useState(false);
  const count = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count', { background: true }),
    refetchInterval: 30_000,
  });
  const latest = useQuery({
    queryKey: ['notifications', 'latest'],
    queryFn: () => api.get<NotificationPage>('/notifications', { query: { pageSize: 8 } }),
    enabled: open,
  });
  const unread = count.data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={`Notifications (${unread} non lue(s))`}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void markRead('all')}>
              <CheckCheck /> Tout marquer comme lu
            </Button>
          )}
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {(latest.data?.items ?? []).length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {latest.isLoading ? 'Chargement…' : 'Aucune notification.'}
            </li>
          )}
          {latest.data?.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full cursor-pointer gap-2.5 border-b px-3 py-2 text-left hover:bg-muted',
                  !n.readAt && 'bg-primary/5',
                )}
                onClick={() => {
                  void markRead(n);
                  setOpen(false);
                  if (n.link) void navigate(n.link);
                }}
              >
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    n.readAt ? 'bg-transparent' : SEVERITY_DOT[n.severity],
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && (
                    <span className="line-clamp-2 block text-xs text-muted-foreground">
                      {n.body}
                    </span>
                  )}
                  <span className="block text-[11px] text-muted-foreground">
                    {fmt.dateTime(n.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-3 py-2 text-right">
          <Link
            to="/notifications"
            className="text-sm text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            Voir toutes les notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Centre de notifications : toutes les notifications de l'utilisateur. */
export function NotificationsPage() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const state = useTableState();
  const unreadOnly = state.filter('unread') === '1';
  const list = useQuery({
    queryKey: ['notifications', 'page', state.page, state.pageSize, unreadOnly],
    queryFn: () =>
      api.get<NotificationPage>('/notifications', {
        query: {
          page: state.page,
          pageSize: state.pageSize,
          unreadOnly: unreadOnly ? '1' : undefined,
        },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<NotificationRow>[] = [
    {
      id: 'severity',
      header: '',
      cell: ({ row }) => (
        <span
          className={cn(
            'inline-block size-2 rounded-full',
            row.original.readAt ? 'bg-muted-foreground/30' : SEVERITY_DOT[row.original.severity],
          )}
        />
      ),
    },
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="tabular">{fmt.dateTime(row.original.createdAt)}</span>,
    },
    {
      id: 'title',
      header: 'Notification',
      cell: ({ row }) => (
        <div className={cn(!row.original.readAt && 'font-medium')}>
          {row.original.title}
          {row.original.body && (
            <div className="text-xs font-normal text-muted-foreground">{row.original.body}</div>
          )}
        </div>
      ),
    },
    {
      id: 'severityLabel',
      header: 'Niveau',
      cell: ({ row }) =>
        row.original.severity === 'CRITICAL' ? (
          <Badge variant="red">Critique</Badge>
        ) : row.original.severity === 'WARNING' ? (
          <Badge variant="orange">Avertissement</Badge>
        ) : (
          <Badge variant="gray">Info</Badge>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alertes et activité, selon vos abonnements."
        actions={
          (list.data?.unread ?? 0) > 0 && (
            <Button variant="outline" onClick={() => void markRead('all')}>
              <CheckCheck /> Tout marquer comme lu
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        onRowClick={(n) => {
          void markRead(n);
          if (n.link) void navigate(n.link);
        }}
        toolbar={
          <NativeSelect
            className="w-44"
            value={unreadOnly ? '1' : ''}
            onChange={(e) => state.update({ unread: e.target.value })}
            aria-label="Filtre"
          >
            <option value="">Toutes</option>
            <option value="1">Non lues</option>
          </NativeSelect>
        }
      />
    </>
  );
}
