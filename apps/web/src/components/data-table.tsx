import type { Paginated } from '@pharmastock/shared';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
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
import { useIsMobile } from '@/lib/media';
import { cn } from '@/lib/utils';

export type Column<T> = ColumnDef<T, unknown> & {
  meta?: {
    align?: 'left' | 'right' | 'center';
    className?: string;
    hideable?: boolean;
    label?: string;
    /** Téléphone (affichage en cartes) : 'hidden' = colonne omise, 'full' = sur toute la largeur. */
    mobile?: 'hidden' | 'full';
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
  const isMobile = useIsMobile();
  const [filtersOpen, setFiltersOpen] = React.useState(false);
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
  const labelOf = (col: { id: string; columnDef: unknown }) => {
    const def = col.columnDef as Column<T>;
    return def.meta?.label ?? (typeof def.header === 'string' ? def.header : col.id);
  };
  const sortable = table
    .getAllLeafColumns()
    .filter((c) => 'accessorKey' in c.columnDef && c.columnDef.enableSorting !== false)
    .map((c) => ({ id: c.id, label: labelOf(c) }));

  return (
    <div className="flex flex-col gap-2">
      {(state || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {state && searchPlaceholder !== undefined && (
            <div className="relative w-full sm:max-w-xs">
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
          {isMobile ? (
            (toolbar || sortable.length > 0) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  <SlidersHorizontal /> Filtres et tri
                </Button>
                {filtersOpen && (
                  <div className="grid w-full grid-cols-2 gap-2 [&>*]:w-full [&>*]:min-w-0">
                    {sortable.length > 0 && state && (
                      <NativeSelect
                        aria-label="Trier par"
                        className="col-span-2"
                        value={state.sort ?? ''}
                        onChange={(e) => state.update({ sort: e.target.value })}
                      >
                        <option value="">Tri par défaut</option>
                        {sortable.flatMap((c) => [
                          <option key={`${c.id}:asc`} value={`${c.id}:asc`}>
                            {c.label} ↑
                          </option>,
                          <option key={`${c.id}:desc`} value={`${c.id}:desc`}>
                            {c.label} ↓
                          </option>,
                        ])}
                      </NativeSelect>
                    )}
                    {toolbar}
                  </div>
                )}
              </>
            )
          ) : (
            <>
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
                            (typeof col.columnDef.header === 'string'
                              ? col.columnDef.header
                              : col.id)}
                        </label>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {isMobile ? (
        <div className="flex flex-col gap-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))
          ) : error ? (
            <ErrorState error={error} onRetry={onRetry} />
          ) : rows.length === 0 ? (
            <div className="rounded-lg border bg-card">
              <EmptyState title={emptyTitle} description={emptyDescription} />
            </div>
          ) : (
            table.getRowModel().rows.map((row) => {
              const cells = row.getVisibleCells();
              const actions = cells.find((c) => c.column.id === 'actions');
              const shown = cells.filter(
                (c) =>
                  c.column.id !== 'actions' &&
                  (c.column.columnDef as Column<T>).meta?.mobile !== 'hidden',
              );
              const [head, ...rest] = shown;
              return (
                <div
                  key={row.id}
                  role={onRowClick ? 'button' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter') onRowClick(row.original);
                        }
                      : undefined
                  }
                  className={cn(
                    'rounded-lg border bg-card p-3 shadow-xs',
                    onRowClick && 'cursor-pointer active:bg-muted',
                    rowClassName?.(row.original),
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 font-medium break-words">
                      {head && flexRender(head.column.columnDef.cell, head.getContext())}
                    </div>
                    {actions && (
                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        {flexRender(actions.column.columnDef.cell, actions.getContext())}
                      </div>
                    )}
                  </div>
                  {rest.length > 0 && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {rest.map((c) => (
                        <div
                          key={c.id}
                          className={cn(
                            'min-w-0',
                            (c.column.columnDef as Column<T>).meta?.mobile === 'full' &&
                              'col-span-2',
                          )}
                        >
                          <dt className="text-[11px] text-muted-foreground">{labelOf(c.column)}</dt>
                          <dd className="text-sm break-words">
                            {flexRender(c.column.columnDef.cell, c.getContext())}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              );
            })
          )}
          {footer && (
            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <TFoot>{footer}</TFoot>
              </Table>
            </div>
          )}
        </div>
      ) : (
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
      )}
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
