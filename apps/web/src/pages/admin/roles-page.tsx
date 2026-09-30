import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Plus, Save, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox, Skeleton, Tooltip } from '@/components/ui/misc';
import { api, errorText } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  systemKey: string | null;
  userCount: number;
  permissions: string[];
}

interface CatalogModule {
  module: string;
  label: string;
  permissions: { key: string; label: string; overridable: boolean; preparerDefault: boolean }[];
}

export function RolesPage() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') });
  const catalog = useQuery({
    queryKey: ['roles', 'catalog'],
    queryFn: () => api.get<CatalogModule[]>('/roles/permissions'),
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const selected = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0];
  const [perms, setPerms] = React.useState<Set<string>>(new Set());
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    if (selected) {
      setPerms(new Set(selected.permissions));
      setName(selected.name);
    }
  }, [selected]);

  const readOnly = selected?.systemKey === 'ADMIN';
  const dirty =
    !!selected &&
    (name !== selected.name ||
      perms.size !== selected.permissions.length ||
      selected.permissions.some((p) => !perms.has(p)));

  const save = useMutation({
    mutationFn: () =>
      api.put(`/roles/${selected!.id}`, {
        name,
        description: selected!.description ?? undefined,
        permissions: [...perms],
      }),
    onSuccess: () => {
      toast.success('Permissions enregistrées (tracé au mouchard)');
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/roles/${selected!.id}`),
    onSuccess: () => {
      toast.success('Rôle supprimé');
      setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const toggle = (key: string, on: boolean) =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <>
      <PageHeader
        title="Rôles et permissions"
        description="Les rôles Administrateur et Préparateur sont des rôles système (non supprimables). Toute modification est tracée au mouchard."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Nouveau rôle
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardContent className="flex flex-col gap-1 p-2">
            {roles.isLoading && <Skeleton className="h-20" />}
            {roles.data?.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  'flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                  selected?.id === r.id && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="font-medium">{r.name}</span>
                <span className="flex items-center gap-1.5">
                  {r.isSystem && (
                    <Lock className="size-3.5 text-muted-foreground" aria-label="Rôle système" />
                  )}
                  <Badge variant="secondary">{r.userCount}</Badge>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
        {selected && (
          <Card>
            <CardHeader className="flex-row flex-wrap items-end gap-3">
              <FormField label="Nom du rôle" className="w-full max-w-xs">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={selected.isSystem}
                />
              </FormField>
              <div className="ml-auto flex gap-2">
                {!selected.isSystem && (
                  <Button
                    variant="outline"
                    onClick={() => remove.mutate()}
                    loading={remove.isPending}
                    disabled={selected.userCount > 0}
                  >
                    <Trash2 /> Supprimer
                  </Button>
                )}
                {!readOnly && (
                  <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
                    <Save /> Enregistrer
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {readOnly && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  L’administrateur dispose toujours de toutes les permissions.
                </p>
              )}
              {catalog.data?.map((mod) => (
                <div key={mod.module}>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {mod.label}
                  </h3>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {mod.permissions.map((p) => (
                      <label
                        key={p.key}
                        className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={readOnly || perms.has(p.key)}
                          disabled={readOnly}
                          onCheckedChange={(v) => toggle(p.key, !!v)}
                        />
                        <span className="text-sm leading-snug">
                          {p.label}
                          {p.overridable && (
                            <Tooltip content="Sans cette permission, l’action reste possible avec le code + PIN d’un administrateur.">
                              <KeyRound
                                className="ml-1 inline size-3.5 text-warning"
                                aria-label="Autorisation administrateur possible"
                              />
                            </Tooltip>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      <CreateRoleDialog
        open={creating}
        onClose={(id) => {
          setCreating(false);
          if (id) setSelectedId(id);
        }}
      />
    </>
  );
}

function CreateRoleDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: (createdId?: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/roles', { name, permissions: [] }),
    onSuccess: (role) => {
      toast.success('Rôle créé : cochez ses permissions');
      void qc.invalidateQueries({ queryKey: ['roles'] });
      setName('');
      onClose(role.id);
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Nouveau rôle</DialogTitle>
          <DialogDescription>
            Ex. « Caissier », « Magasinier », « Comptable — lecture seule ».
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <FormField label="Nom" required>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose()}>
              Annuler
            </Button>
            <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
