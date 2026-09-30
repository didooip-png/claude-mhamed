import type { Paginated } from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileUp, Plus, Snowflake } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page';
import { ExpiryBadge, Qty, StockStatusBadge } from '@/components/stock-badges';
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
import { NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useReferences } from '@/lib/catalog';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import type { Product } from '@/lib/types';
import { ProductFormDialog } from './product-form';

export function ProductsPage() {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const state = useTableState({ sort: 'name:asc' });
  const refs = useReferences();
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const filters = {
    categoryId: state.filter('categoryId'),
    laboratoryId: state.filter('laboratoryId'),
    status: state.filter('status') || 'active',
    stock: state.filter('stock'),
  };
  const list = useQuery({
    queryKey: ['products', state.page, state.pageSize, state.q, state.sort, filters],
    queryFn: () =>
      api.get<Paginated<Product>>('/products', {
        query: {
          page: state.page,
          pageSize: state.pageSize,
          q: state.q,
          sort: state.sort,
          ...filters,
        },
      }),
    placeholderData: (prev) => prev,
  });

  const exportCatalog = useMutation({
    mutationFn: () => api.blob('/products/export'),
    onSuccess: (blob) =>
      platform.download(blob, `catalogue-${new Date().toISOString().slice(0, 10)}.xlsx`),
    onError: (err) => toast.error(errorText(err)),
  });

  const columns: Column<Product>[] = [
    {
      accessorKey: 'internalCode',
      header: 'Code',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.internalCode}</span>,
    },
    {
      accessorKey: 'name',
      header: 'Produit',
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 font-medium">
              {p.name}
              {p.requiresPrescription && <Badge variant="blue">Ord.</Badge>}
              {p.controlledClass !== 'NONE' && (
                <Badge variant="red">Tab. {p.controlledClass}</Badge>
              )}
              {p.coldChain && (
                <Snowflake className="size-3.5 text-sky-600" aria-label="Chaîne du froid" />
              )}
              {!p.isActive && <Badge variant="gray">Archivé</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {[p.dci, p.dosage, p.form, p.presentation].filter(Boolean).join(' · ')}
            </div>
          </div>
        );
      },
    },
    {
      id: 'lab',
      header: 'Laboratoire',
      meta: { label: 'Laboratoire' },
      cell: ({ row }) => row.original.laboratory?.name ?? '—',
    },
    {
      id: 'category',
      header: 'Catégorie',
      meta: { label: 'Catégorie' },
      cell: ({ row }) => row.original.category.name,
    },
    {
      accessorKey: 'salePriceTtc',
      header: 'Prix TTC',
      meta: { align: 'right' },
      cell: ({ row }) => fmt.money(row.original.salePriceTtc),
    },
    {
      accessorKey: 'sellable',
      header: 'Stock vendable',
      meta: { align: 'right' },
      cell: ({ row }) => <Qty value={row.original.stock.sellable} product={row.original} />,
    },
    {
      accessorKey: 'nextExpiry',
      header: 'Prochaine péremption',
      cell: ({ row }) =>
        row.original.stock.nextExpiry ? (
          <ExpiryBadge date={row.original.stock.nextExpiry} level="OK" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'status',
      header: 'État',
      cell: ({ row }) => <StockStatusBadge status={row.original.stock.status} />,
    },
    {
      id: 'location',
      header: 'Emplacement',
      meta: { label: 'Emplacement' },
      cell: ({ row }) => row.original.location ?? '—',
    },
  ];

  return (
    <>
      <PageHeader
        title="Produits"
        description="Catalogue : recherche par nom, DCI, code ou code-barres (tolérante aux accents et aux fautes légères)."
        actions={
          can('catalog.manage') && (
            <>
              <Button
                variant="outline"
                onClick={() => exportCatalog.mutate()}
                loading={exportCatalog.isPending}
              >
                <Download /> Exporter
              </Button>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUp /> Importer
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus /> Nouveau produit
              </Button>
            </>
          )
        }
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        state={state}
        searchPlaceholder="Nom, DCI, code, code-barres…"
        onRowClick={(p) => void navigate(`/products/${p.id}`)}
        emptyTitle="Aucun produit"
        emptyDescription={
          can('catalog.manage')
            ? 'Créez un produit ou importez votre catalogue (Excel / CSV).'
            : undefined
        }
        toolbar={
          <>
            <NativeSelect
              className="w-44"
              value={filters.categoryId}
              onChange={(e) => state.update({ categoryId: e.target.value })}
              aria-label="Catégorie"
            >
              <option value="">Toutes catégories</option>
              {refs.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-44"
              value={filters.laboratoryId}
              onChange={(e) => state.update({ laboratoryId: e.target.value })}
              aria-label="Laboratoire"
            >
              <option value="">Tous laboratoires</option>
              {refs.data?.laboratories.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-40"
              value={filters.stock}
              onChange={(e) => state.update({ stock: e.target.value })}
              aria-label="Stock"
            >
              <option value="">Tout stock</option>
              <option value="OUT">Rupture</option>
              <option value="LOW">Sous le seuil</option>
              <option value="OK">Stock OK</option>
            </NativeSelect>
            <NativeSelect
              className="w-32"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="active">Actifs</option>
              <option value="archived">Archivés</option>
              <option value="all">Tous</option>
            </NativeSelect>
          </>
        }
      />
      <ProductFormDialog
        product={null}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(p) => void navigate(`/products/${p.id}`)}
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

interface ImportReport {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: number;
  createdReferences: string[];
  lines: {
    line: number;
    code: string | null;
    name: string | null;
    action: 'CREATE' | 'UPDATE' | 'ERROR';
    errors: string[];
  }[];
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = React.useState<File | null>(null);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  React.useEffect(() => {
    if (!open) {
      setFile(null);
      setReport(null);
    }
  }, [open]);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const body = new FormData();
      body.append('file', file!);
      return api.post<ImportReport>('/products/import', body, {
        query: { dryRun: dryRun ? '1' : '0' },
      });
    },
    onSuccess: (r) => {
      setReport(r);
      if (!r.dryRun) {
        toast.success(`Import terminé : ${r.created} créé(s), ${r.updated} mis à jour`);
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['catalog'] });
      }
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Importer le catalogue</DialogTitle>
          <DialogDescription>
            Fichier Excel (.xlsx) ou CSV au format de l’export. Les produits existants (même code)
            sont mis à jour. Une simulation est faite d’abord : rien n’est enregistré tant que vous
            ne confirmez pas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
            }}
            className="text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm"
          />
          <Button
            variant="outline"
            disabled={!file}
            loading={run.isPending && run.variables === true}
            onClick={() => run.mutate(true)}
          >
            Simuler l’import
          </Button>
        </div>
        {report && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="green">{report.created} à créer</Badge>
              <Badge variant="blue">{report.updated} à mettre à jour</Badge>
              <Badge variant={report.errors > 0 ? 'red' : 'gray'}>{report.errors} en erreur</Badge>
              {report.createdReferences.length > 0 && (
                <Badge variant="yellow">
                  {report.createdReferences.length} référentiel(s) créé(s)
                </Badge>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <THead>
                  <TR>
                    <TH>Ligne</TH>
                    <TH>Code</TH>
                    <TH>Produit</TH>
                    <TH>Résultat</TH>
                  </TR>
                </THead>
                <TBody>
                  {report.lines.map((l) => (
                    <TR key={l.line}>
                      <TD className="tabular">{l.line}</TD>
                      <TD className="font-mono text-xs">{l.code ?? '—'}</TD>
                      <TD>{l.name ?? '—'}</TD>
                      <TD>
                        {l.action === 'ERROR' ? (
                          <span className="flex items-start gap-1 text-destructive">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            {l.errors.join(' · ')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="size-3.5" />
                            {l.action === 'CREATE' ? 'Création' : 'Mise à jour'}
                          </span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          {report?.dryRun && report.created + report.updated > 0 && (
            <Button
              loading={run.isPending && run.variables === false}
              onClick={() => run.mutate(false)}
            >
              Importer {report.created + report.updated} produit(s)
              {report.errors > 0 ? ' (lignes en erreur ignorées)' : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
