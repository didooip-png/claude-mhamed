import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Plus, UserCheck, UserX, Unlock } from 'lucide-react';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, ApiError, errorText } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useFormat } from '@/lib/format';

interface UserRow {
  id: string;
  code: string;
  username: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  totpEnabled: boolean;
  version: number;
  role: { id: string; name: string; systemKey: string | null };
}

interface RoleRow {
  id: string;
  name: string;
  systemKey: string | null;
}

export function UsersPage() {
  const fmt = useFormat();
  const me = useMe();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  const [editing, setEditing] = React.useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = React.useState<UserRow | null>(null);

  const action = useMutation({
    mutationFn: ({ user, op }: { user: UserRow; op: 'disable' | 'enable' | 'unlock' }) =>
      api.post(`/users/${user.id}/${op}`),
    onSuccess: (_d, v) => {
      toast.success(
        v.op === 'disable'
          ? 'Utilisateur désactivé'
          : v.op === 'enable'
            ? 'Utilisateur réactivé'
            : 'Compte déverrouillé',
      );
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const columns: Column<UserRow>[] = [
    {
      accessorKey: 'code',
      header: 'Code',
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.code}</span>,
    },
    {
      accessorKey: 'fullName',
      header: 'Nom',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.fullName}</div>
          <div className="text-xs text-muted-foreground">{row.original.username}</div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Rôle',
      cell: ({ row }) => (
        <Badge variant={row.original.role.systemKey === 'ADMIN' ? 'default' : 'secondary'}>
          {row.original.role.name}
        </Badge>
      ),
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => {
        const u = row.original;
        if (!u.isActive) return <Badge variant="gray">Désactivé</Badge>;
        if (u.lockedUntil && new Date(u.lockedUntil) > new Date())
          return <Badge variant="red">Verrouillé</Badge>;
        if (u.mustChangePassword) return <Badge variant="yellow">Mot de passe à changer</Badge>;
        return <Badge variant="green">Actif</Badge>;
      },
    },
    {
      id: 'totp',
      header: '2FA',
      cell: ({ row }) =>
        row.original.totpEnabled ? (
          <Badge variant="blue">Activée</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'last',
      header: 'Dernière connexion',
      cell: ({ row }) => (
        <span className="tabular">{fmt.dateTime(row.original.lastLoginAt) || '—'}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const u = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Actions"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(u)}>Modifier</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setResetting(u)}>
                <KeyRound /> Réinitialiser mot de passe / PIN
              </DropdownMenuItem>
              {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                <DropdownMenuItem onSelect={() => action.mutate({ user: u, op: 'unlock' })}>
                  <Unlock /> Déverrouiller le compte
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {u.isActive ? (
                <DropdownMenuItem
                  destructive
                  disabled={u.id === me.id}
                  onSelect={() => action.mutate({ user: u, op: 'disable' })}
                >
                  <UserX /> Désactiver
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => action.mutate({ user: u, op: 'enable' })}>
                  <UserCheck /> Réactiver
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
        title="Utilisateurs"
        description="Chaque utilisateur a un code unique, un mot de passe et un PIN. Un utilisateur n’est jamais supprimé : il est désactivé."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Nouvel utilisateur
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={users.data}
        isLoading={users.isLoading}
        error={users.error}
        onRetry={() => void users.refetch()}
        onRowClick={(u) => setEditing(u)}
        rowClassName={(u) => (u.isActive ? undefined : 'opacity-60')}
      />
      <UserDialog user={editing} onClose={() => setEditing(null)} />
      <ResetDialog user={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

function UserDialog({ user, onClose }: { user: UserRow | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleRow[]>('/roles'),
    enabled: user !== null,
  });
  const isNew = user === 'new';
  const [form, setForm] = React.useState({
    code: '',
    username: '',
    fullName: '',
    email: '',
    roleId: '',
    password: '',
    pin: '',
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    setErrors({});
    if (user === 'new')
      setForm({
        code: '',
        username: '',
        fullName: '',
        email: '',
        roleId: '',
        password: '',
        pin: '',
      });
    else if (user)
      setForm({
        code: user.code,
        username: user.username,
        fullName: user.fullName,
        email: user.email ?? '',
        roleId: user.role.id,
        password: '',
        pin: '',
      });
  }, [user]);
  React.useEffect(() => {
    if (isNew && !form.roleId && roles.data) {
      const prep = roles.data.find((r) => r.systemKey === 'PREPARER');
      if (prep) setForm((f) => ({ ...f, roleId: prep.id }));
    }
  }, [isNew, roles.data, form.roleId]);

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? api.post('/users', { ...form, email: form.email || undefined })
        : api.put(`/users/${(user as UserRow).id}`, {
            fullName: form.fullName,
            email: form.email,
            roleId: form.roleId,
            version: (user as UserRow).version,
          }),
    onSuccess: () => {
      toast.success(
        isNew
          ? 'Utilisateur créé — il devra changer son mot de passe à la première connexion'
          : 'Utilisateur modifié',
      );
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    },
  });

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Nouvel utilisateur' : `Modifier ${form.code}`}</DialogTitle>
          <DialogDescription>
            Le code utilisateur apparaît sur tous les documents imprimés et dans le mouchard.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField
            label="Code utilisateur"
            required
            error={errors.code}
            hint="Ex. PRE03"
            help="Le code court de la personne (2 à 10 lettres ou chiffres). Il figure sur les documents et les autorisations, et ne peut plus être modifié ni réattribué."
          >
            <Input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              disabled={!isNew}
              maxLength={10}
            />
          </FormField>
          <FormField label="Identifiant de connexion" required error={errors.username}>
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))}
              disabled={!isNew}
            />
          </FormField>
          <FormField label="Nom complet" required error={errors.fullName} className="sm:col-span-2">
            <Input value={form.fullName} onChange={set('fullName')} />
          </FormField>
          <FormField label="E-mail" error={errors.email}>
            <Input type="email" value={form.email} onChange={set('email')} />
          </FormField>
          <FormField label="Rôle" required error={errors.roleId}>
            <NativeSelect value={form.roleId} onChange={set('roleId')}>
              <option value="">Choisir…</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {isNew && (
            <>
              <FormField
                label="Mot de passe provisoire"
                required
                error={errors.password}
                hint="À changer à la première connexion"
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={set('password')}
                />
              </FormField>
              <FormField
                label="PIN (4 à 6 chiffres)"
                required
                error={errors.pin}
                help="Code personnel pour déverrouiller l’écran et valider les ventes. La personne pourra le changer dans Mon compte."
              >
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={form.pin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))
                  }
                />
              </FormField>
            </>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" loading={save.isPending}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState('');
  React.useEffect(() => {
    setPassword('');
    setPin('');
  }, [user]);
  const reset = useMutation({
    mutationFn: () =>
      api.post(`/users/${user!.id}/reset-credentials`, {
        password: password || undefined,
        pin: pin || undefined,
      }),
    onSuccess: () => {
      toast.success('Identifiants réinitialisés');
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Réinitialiser — {user?.code}</DialogTitle>
          <DialogDescription>
            Un nouveau mot de passe oblige l’utilisateur à le changer à sa prochaine connexion et
            ferme ses sessions.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <FormField label="Nouveau mot de passe provisoire">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <FormField label="Nouveau PIN">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" loading={reset.isPending} disabled={!password && pin.length < 4}>
              Réinitialiser
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
