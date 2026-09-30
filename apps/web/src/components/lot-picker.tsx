import { formatStockQty, productLabel } from '@pharmastock/shared';
import { Loader2, Search } from 'lucide-react';
import * as React from 'react';
import { ExpiryBadge, LotStatusBadge } from '@/components/stock-badges';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { LotRow } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Recherche d'un lot en stock (produit, DCI, code, numéro de lot). Les lots sont proposés avec
 * leur péremption, leur statut et la quantité restante ; l'appelant reçoit la ligne choisie.
 */
export function LotPicker({
  onSelect,
  supplierId,
  excludeIds = [],
  placeholder = 'Produit ou numéro de lot…',
  autoFocus,
  className,
}: {
  onSelect: (lot: LotRow) => void;
  supplierId?: string;
  excludeIds?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<LotRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const request = React.useRef(0);

  React.useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .get<{ items: LotRow[] }>('/stock/lots', {
          query: {
            q: query,
            withStock: '1',
            pageSize: 12,
            sort: 'expiryDate:asc',
            ...(supplierId ? { supplierId } : {}),
          },
        })
        .then((res) => {
          if (id === request.current) setResults(res.items);
        })
        .catch(() => undefined)
        .finally(() => {
          if (id === request.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, supplierId]);

  const choices = results.filter((r) => !excludeIds.includes(r.id));
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="pl-8"
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          const input = e.currentTarget;
          window.setTimeout(() => {
            if (document.activeElement !== input) setOpen(false);
          }, 150);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {loading && <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin" />}
      {open && query.trim() && (
        <div className="absolute z-50 mt-1 max-h-80 w-full min-w-[28rem] overflow-auto rounded-md border bg-popover shadow-lg">
          {choices.length === 0 && !loading && (
            <p className="px-3 py-3 text-sm text-muted-foreground">Aucun lot en stock.</p>
          )}
          {choices.map((lot) => (
            <button
              key={lot.id}
              type="button"
              className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-0 hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(lot);
                setQuery('');
                setResults([]);
                setOpen(false);
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{productLabel(lot.product)}</div>
                <div className="text-xs text-muted-foreground">
                  Lot <span className="font-mono">{lot.lotNumber}</span> ·{' '}
                  {lot.supplierName ?? 'sans fournisseur'}
                </div>
              </div>
              <ExpiryBadge date={lot.expiryDate} level={lot.level} days={lot.daysToExpiry} />
              {lot.status !== 'ACTIVE' && <LotStatusBadge status={lot.status} />}
              <span className="w-24 text-right text-sm tabular">
                {formatStockQty(lot.remainingQty, lot.product.unitsPerPack, lot.product.sellByUnit)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
