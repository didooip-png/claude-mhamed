import { formatBp, PRODUCT_CATEGORY_KINDS } from '@pharmastock/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { FormField, PercentInput } from '@/components/form';
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
import { Input, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, errorText } from '@/lib/api';
import { useReferences } from '@/lib/catalog';

type Kind = 'categories' | 'laboratories' | 'therapeutic-classes' | 'tva-rates';
interface EditState {
  kind: Kind;
  id: string | null;
  values: {
    name: string;
    kind: string;
    country: string;
    label: string;
    rateBp: number;
    isActive: boolean;
    isDefault: boolean;
  };
}

const EMPTY = {
  name: '',
  kind: 'MEDICINE',
  country: '',
  label: '',
  rateBp: 700,
  isActive: true,
  isDefault: false,
};

/** Référentiels du catalogue (administrateur). */
export function ReferencesPage() {
  const refs = useReferences();
  const qc = useQueryClient();
  const [edit, setEdit] = React.useState<EditState | null>(null);

  const save = useMutation({
    mutationFn: (e: EditState) => {
      const body =
        e.kind === 'categories'
          ? { name: e.values.name, kind: e.values.kind, isActive: e.values.isActive }
          : e.kind === 'laboratories'
            ? { name: e.values.name, country: e.values.country, isActive: e.values.isActive }
            : e.kind === 'therapeutic-classes'
              ? { name: e.values.name }
              : {
                  label: e.values.label,
                  rateBp: e.values.rateBp,
                  isActive: e.values.isActive,
                  isDefault: e.values.isDefault,
                };
      return e.id
        ? api.put(`/catalog/${e.kind}/${e.id}`, body)
        : api.post(`/catalog/${e.kind}`, body);
    },
    onSuccess: () => {
      toast.success('Enregistré');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const remove = useMutation({
    mutationFn: ({ kind, id }: { kind: Kind; id: string }) => api.delete(`/catalog/${kind}/${id}`),
    onSuccess: () => {
      toast.success('Supprimé');
      void qc.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const actions = (
    kind: Kind,
    row: { id: string; _count: { products: number } },
    values: Partial<EditState['values']>,
  ) => (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Modifier"
        onClick={() => setEdit({ kind, id: row.id, values: { ...EMPTY, ...values } })}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Supprimer"
        disabled={row._count.products > 0}
        title={row._count.products > 0 ? 'Utilisé par des produits' : undefined}
        onClick={() => remove.mutate({ kind, id: row.id })}
      >
        <Trash2 />
      </Button>
    </div>
  );
  const active = (v: boolean) =>
    v ? <Badge variant="green">Actif</Badge> : <Badge variant="gray">Inactif</Badge>;
  const addButton = (kind: Kind, label: string) => (
    <Button size="sm" onClick={() => setEdit({ kind, id: null, values: { ...EMPTY } })}>
      <Plus /> {label}
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Référentiels du catalogue"
        description="Catégories, laboratoires, familles thérapeutiques et taux de TVA."
      />
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Catégories</TabsTrigger>
          <TabsTrigger value="laboratories">Laboratoires</TabsTrigger>
          <TabsTrigger value="classes">Familles thérapeutiques</TabsTrigger>
          <TabsTrigger value="tva">Taux de TVA</TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <DataTable
            toolbar={addButton('categories', 'Nouvelle catégorie')}
            isLoading={refs.isLoading}
            data={refs.data?.categories}
            columns={[
              {
                id: 'name',
                header: 'Nom',
                cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
              },
              {
                id: 'kind',
                header: 'Type',
                cell: ({ row }) =>
                  PRODUCT_CATEGORY_KINDS[
                    row.original.kind as keyof typeof PRODUCT_CATEGORY_KINDS
                  ] ?? row.original.kind,
              },
              {
                id: 'count',
                header: 'Produits',
                meta: { align: 'right' },
                cell: ({ row }) => row.original._count.products,
              },
              { id: 'active', header: 'Statut', cell: ({ row }) => active(row.original.isActive) },
              {
                id: 'actions',
                header: '',
                cell: ({ row }) =>
                  actions('categories', row.original, {
                    name: row.original.name,
                    kind: row.original.kind,
                    isActive: row.original.isActive,
                  }),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="laboratories">
          <DataTable
            toolbar={addButton('laboratories', 'Nouveau laboratoire')}
            isLoading={refs.isLoading}
            data={refs.data?.laboratories}
            columns={[
              {
                id: 'name',
                header: 'Nom',
                cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
              },
              { id: 'country', header: 'Pays', cell: ({ row }) => row.original.country ?? '—' },
              {
                id: 'count',
                header: 'Produits',
                meta: { align: 'right' },
                cell: ({ row }) => row.original._count.products,
              },
              { id: 'active', header: 'Statut', cell: ({ row }) => active(row.original.isActive) },
              {
                id: 'actions',
                header: '',
                cell: ({ row }) =>
                  actions('laboratories', row.original, {
                    name: row.original.name,
                    country: row.original.country ?? '',
                    isActive: row.original.isActive,
                  }),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="classes">
          <DataTable
            toolbar={addButton('therapeutic-classes', 'Nouvelle famille')}
            isLoading={refs.isLoading}
            data={refs.data?.therapeuticClasses}
            columns={[
              {
                id: 'name',
                header: 'Nom',
                cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
              },
              {
                id: 'count',
                header: 'Produits',
                meta: { align: 'right' },
                cell: ({ row }) => row.original._count.products,
              },
              {
                id: 'actions',
                header: '',
                cell: ({ row }) =>
                  actions('therapeutic-classes', row.original, { name: row.original.name }),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="tva">
          <p className="mb-2 text-sm text-muted-foreground">
            Les taux initiaux (0 %, 7 %, 13 %, 19 %) sont à confirmer par votre comptable. Un taux
            déjà utilisé ne peut pas changer de valeur : créez un nouveau taux puis réaffectez les
            produits.
          </p>
          <DataTable
            toolbar={addButton('tva-rates', 'Nouveau taux')}
            isLoading={refs.isLoading}
            data={refs.data?.tvaRates}
            columns={[
              {
                id: 'label',
                header: 'Libellé',
                cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
              },
              {
                id: 'rate',
                header: 'Taux',
                meta: { align: 'right' },
                cell: ({ row }) => formatBp(row.original.rateBp),
              },
              {
                id: 'default',
                header: 'Par défaut',
                cell: ({ row }) => (row.original.isDefault ? <Badge>Par défaut</Badge> : ''),
              },
              {
                id: 'count',
                header: 'Produits',
                meta: { align: 'right' },
                cell: ({ row }) => row.original._count.products,
              },
              { id: 'active', header: 'Statut', cell: ({ row }) => active(row.original.isActive) },
              {
                id: 'actions',
                header: '',
                cell: ({ row }) =>
                  actions('tva-rates', row.original, {
                    label: row.original.label,
                    rateBp: row.original.rateBp,
                    isActive: row.original.isActive,
                    isDefault: row.original.isDefault,
                  }),
              },
            ]}
          />
        </TabsContent>
      </Tabs>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent size="sm">
          {edit && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(edit);
              }}
            >
              <DialogHeader>
                <DialogTitle>{edit.id ? 'Modifier' : 'Ajouter'}</DialogTitle>
              </DialogHeader>
              {edit.kind === 'tva-rates' ? (
                <>
                  <FormField label="Libellé" required>
                    <Input
                      autoFocus
                      value={edit.values.label}
                      onChange={(e) =>
                        setEdit({ ...edit, values: { ...edit.values, label: e.target.value } })
                      }
                    />
                  </FormField>
                  <FormField label="Taux">
                    <PercentInput
                      value={edit.values.rateBp}
                      onValueChange={(v) =>
                        setEdit({ ...edit, values: { ...edit.values, rateBp: v } })
                      }
                    />
                  </FormField>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={edit.values.isDefault}
                      onCheckedChange={(v) =>
                        setEdit({ ...edit, values: { ...edit.values, isDefault: v } })
                      }
                    />{' '}
                    Taux par défaut
                  </label>
                </>
              ) : (
                <FormField label="Nom" required>
                  <Input
                    autoFocus
                    value={edit.values.name}
                    onChange={(e) =>
                      setEdit({ ...edit, values: { ...edit.values, name: e.target.value } })
                    }
                  />
                </FormField>
              )}
              {edit.kind === 'categories' && (
                <FormField label="Type">
                  <NativeSelect
                    value={edit.values.kind}
                    onChange={(e) =>
                      setEdit({ ...edit, values: { ...edit.values, kind: e.target.value } })
                    }
                  >
                    {Object.entries(PRODUCT_CATEGORY_KINDS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              )}
              {edit.kind === 'laboratories' && (
                <FormField label="Pays">
                  <Input
                    value={edit.values.country}
                    onChange={(e) =>
                      setEdit({ ...edit, values: { ...edit.values, country: e.target.value } })
                    }
                  />
                </FormField>
              )}
              {edit.kind !== 'therapeutic-classes' && (
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={edit.values.isActive}
                    onCheckedChange={(v) =>
                      setEdit({ ...edit, values: { ...edit.values, isActive: v } })
                    }
                  />{' '}
                  Actif
                </label>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                  Annuler
                </Button>
                <Button type="submit" loading={save.isPending}>
                  Enregistrer
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
