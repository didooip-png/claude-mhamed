import type { Paginated } from '@pharmastock/shared';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Search } from 'lucide-react';
import * as React from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type Column<T> = ColumnDef<T, unknown> & {
  meta?: {
    align?: 'left' | 'right' | 'center';
    className?: string;
    hideable?: boolean;
    label?: string;
  };
};

/**
 * État d'un tableau (page, taille, tri, recherche, filtres) stocké dans l'URL :
 * rechargement et partage de lien conservent la vue.
 */
export function useTableState(defaults: { pageSize?: number; sort?: string } = {}) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const pageSize = Number(params.get('pageSize') ?? String(defaults.pageSize ?? 25)) || 25;
  const sort = params.get('sort') ?? defaults.sort ?? undefined;
  const q = params.get('q') ?? '';
  const update = React.useCallback(
    (patch: Record<string, string | number | undefined | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const filter = (key: string) => params.get(key) ?? '';
  return { page, pageSize, sort, q, params, update, filter };
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: Paginated<T> | T[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  state?: ReturnType<typeof useTableState>;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  footer?: React.ReactNode;
  getRowId?: (row: T) => string;
  dense?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  isLoading,
  error,
  onRetry,
  state,
  searchPlaceholder,
  toolbar,
  emptyTitle = 'Aucun résultat',
  emptyDescription,
  onRowClick,
  rowClassName,
  footer,
  getRowId,
  dense,
}: DataTableProps<T>) {
  const rows = Array.isArray(data) ? data : (data?.items ?? []);
  const total = Array.isArray(data) ? data.length : (data?.total ?? 0);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const sorting: SortingState = React.useMemo(() => {
    if (!state?.sort) return [];
    const [id, dir] = state.sort.split(':');
    return id ? [{ id, desc: dir === 'desc' }] : [];
  }, [state?.sort]);
  const [search, setSearch] = React.useState(state?.q ?? '');
  React.useEffect(() => setSearch(state?.q ?? ''), [state?.q]);
  React.useEffect(() => {
    if (!state) return;
    const handle = window.setTimeout(() => {
      if (search !== state.q) state.update({ q: search });
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    state: { sorting, columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    onSortingChange: (updater) => {
      if (!state) return;
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const first = next[0];
      state.update({ sort: first ? `${first.id}:${first.desc ? 'desc' : 'asc'}` : undefined });
    },
  });

  const hideable = table
    .getAllLeafColumns()
    .filter((c) => (c.columnDef as Column<T>).meta?.hideable !== false && c.id !== 'actions');
  const pageCount = state ? Math.max(1, Math.ceil(total / state.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-2">
      {(state || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {state && searchPlaceholder !== undefined && (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
                aria-label="Rechercher"
              />
            </div>
          )}
          {toolbar}
          <div className="ml-auto">
            {hideable.length > 3 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Columns3 /> Colonnes
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                  <DropdownMenuLabel>Colonnes affichées</DropdownMenuLabel>
                  {hideable.map((col) => (
                    <label
                      key={col.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={col.getIsVisible()}
                        onCheckedChange={(v) => col.toggleVisibility(!!v)}
                      />
                      {(col.columnDef as Column<T>).meta?.label ??
                        (typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id)}
                    </label>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <THead>
            {table.getHeaderGroups().map((hg) => (
              <TR key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const meta = (header.column.columnDef as Column<T>).meta;
                  const canSort =
                    header.column.getCanSort() &&
                    !!state &&
                    header.column.columnDef.enableSorting !== false &&
                    'accessorKey' in header.column.columnDef;
                  const sorted = header.column.getIsSorted();
                  return (
                    <TH
                      key={header.id}
                      className={cn(
                        meta?.align === 'right' && 'text-right',
                        meta?.align === 'center' && 'text-center',
                        meta?.className,
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className={cn(
                            'inline-flex cursor-pointer items-center gap-1 hover:text-foreground',
                            meta?.align === 'right' && 'flex-row-reverse',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3" />
                          ) : null}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TH>
                  );
                })}
              </TR>
            ))}
          </THead>
          <TBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TR key={i}>
                  {table.getVisibleLeafColumns().map((c) => (
                    <TD key={c.id}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TD>
                  ))}
                </TR>
              ))
            ) : error ? (
              <TR>
                <TD colSpan={table.getVisibleLeafColumns().length}>
                  <ErrorState error={error} onRetry={onRetry} />
                </TD>
              </TR>
            ) : rows.length === 0 ? (
              <TR className="hover:bg-transparent">
                <TD colSpan={table.getVisibleLeafColumns().length}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </TD>
              </TR>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TR
                  key={row.id}
                  className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef as Column<T>).meta;
                    return (
                      <TD
                        key={cell.id}
                        className={cn(
                          dense && 'py-1.5',
                          meta?.align === 'right' && 'text-right tabular',
                          meta?.align === 'center' && 'text-center',
                          meta?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TD>
                    );
                  })}
                </TR>
              ))
            )}
          </TBody>
          {footer && <TFoot>{footer}</TFoot>}
        </Table>
      </div>
      {state && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {total.toLocaleString('fr-FR')} résultat{total > 1 ? 's' : ''} — page {state.page} /{' '}
            {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <NativeSelect
              className="h-8 w-auto"
              value={state.pageSize}
              onChange={(e) => state.update({ pageSize: e.target.value })}
              aria-label="Lignes par page"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={state.page <= 1}
              onClick={() => state.update({ page: state.page - 1 }, false)}
              aria-label="Page précédente"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={state.page >= pageCount}
              onClick={() => state.update({ page: state.page + 1 }, false)}
              aria-label="Page suivante"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
