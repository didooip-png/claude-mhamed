import type { Paginated } from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
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
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { api, ApiError, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { Supplier } from '@/lib/types';

export function SuppliersPage() {
  const can = useCan();
  const state = useTableState();
  const active = state.filter('active') || 'true';
  const [editing, setEditing] = React.useState<Supplier | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['suppliers', state.page, state.pageSize, state.q, active],
    queryFn: () =>
      api.get<Paginated<Supplier>>('/suppliers', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, active },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<Supplier>[] = [
    {
      id: 'code',
      header: 'Code',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      id: 'name',
      header: 'Raison sociale',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    { id: 'contact', header: 'Contact', cell: ({ row }) => row.original.contactName ?? '—' },
    { id: 'phone', header: 'Téléphone', cell: ({ row }) => row.original.phone ?? '—' },
    { id: 'email', header: 'E-mail', cell: ({ row }) => row.original.email ?? '—' },
    {
      id: 'terms',
      header: 'Délai paiement',
      meta: { align: 'right' },
      cell: ({ row }) => `${row.original.paymentTermsDays} j`,
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) =>
        row.original.isActive ? (
          <Badge variant="green">Actif</Badge>
        ) : (
          <Badge variant="gray">Inactif</Badge>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Fournisseurs"
        actions={
          can('suppliers.manage') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> Nouveau fournisseur
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
        searchPlaceholder="Nom, code, matricule, téléphone…"
        onRowClick={can('suppliers.manage') ? (s) => setEditing(s) : undefined}
        toolbar={
          <NativeSelect
            className="w-32"
            value={active}
            onChange={(e) => state.update({ active: e.target.value })}
            aria-label="Statut"
          >
            <option value="true">Actifs</option>
            <option value="false">Inactifs</option>
            <option value="all">Tous</option>
          </NativeSelect>
        }
      />
      <SupplierDialog supplier={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function SupplierDialog({
  supplier,
  onClose,
}: {
  supplier: Supplier | 'new' | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isNew = supplier === 'new';
  const empty = {
    code: '',
    name: '',
    taxId: '',
    contactName: '',
    phone: '',
    email: '',
    address: '',
    paymentTermsDays: 0,
    leadTimeDays: '',
    isActive: true,
    notes: '',
  };
  const [f, setF] = React.useState(empty);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    setErrors({});
    if (supplier === 'new') setF(empty);
    else if (supplier)
      setF({
        code: supplier.code,
        name: supplier.name,
        taxId: supplier.taxId ?? '',
        contactName: supplier.contactName ?? '',
        phone: supplier.phone ?? '',
        email: supplier.email ?? '',
        address: supplier.address ?? '',
        paymentTermsDays: supplier.paymentTermsDays,
        leadTimeDays: supplier.leadTimeDays?.toString() ?? '',
        isActive: supplier.isActive,
        notes: supplier.notes ?? '',
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        code: isNew ? f.code || undefined : undefined,
        leadTimeDays: f.leadTimeDays === '' ? null : Number(f.leadTimeDays),
        version: isNew ? undefined : (supplier as Supplier).version,
      };
      return isNew
        ? api.post('/suppliers', body)
        : api.put(`/suppliers/${(supplier as Supplier).id}`, body);
    },
    onSuccess: () => {
      toast.success('Fournisseur enregistré');
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    },
  });
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <Dialog open={supplier !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Nouveau fournisseur' : `Fournisseur ${f.code}`}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label="Raison sociale" required error={errors.name} className="sm:col-span-2">
            <Input autoFocus value={f.name} onChange={set('name')} />
          </FormField>
          {isNew && (
            <FormField label="Code" hint="Vide = automatique" error={errors.code}>
              <Input
                value={f.code}
                onChange={(e) => setF((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
              />
            </FormField>
          )}
          <FormField label="Matricule fiscal" error={errors.taxId}>
            <Input value={f.taxId} onChange={set('taxId')} />
          </FormField>
          <FormField label="Contact" error={errors.contactName}>
            <Input value={f.contactName} onChange={set('contactName')} />
          </FormField>
          <FormField label="Téléphone" error={errors.phone}>
            <Input value={f.phone} onChange={set('phone')} />
          </FormField>
          <FormField label="E-mail" error={errors.email}>
            <Input type="email" value={f.email} onChange={set('email')} />
          </FormField>
          <FormField label="Délai de paiement (jours)" error={errors.paymentTermsDays}>
            <Input
              type="number"
              min={0}
              value={f.paymentTermsDays}
              onChange={(e) =>
                setF((p) => ({ ...p, paymentTermsDays: Number(e.target.value) || 0 }))
              }
            />
          </FormField>
          <FormField
            label="Délai de livraison (jours)"
            hint="Pour les suggestions de réapprovisionnement"
          >
            <Input type="number" min={0} value={f.leadTimeDays} onChange={set('leadTimeDays')} />
          </FormField>
          <FormField label="Adresse" className="sm:col-span-2">
            <Input value={f.address} onChange={set('address')} />
          </FormField>
          <FormField label="Notes" className="sm:col-span-2">
            <Textarea value={f.notes} onChange={set('notes')} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.isActive}
              onCheckedChange={(v) => setF((p) => ({ ...p, isActive: v }))}
            />{' '}
            Actif
          </label>
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
