import { formatMoney, formatStockQty, productLabel } from '@pharmastock/shared';
import { Loader2, ScanLine, Search, Snowflake } from 'lucide-react';
import * as React from 'react';
import { CameraScannerDialog, useCameraScanSupported } from '@/components/camera-scanner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ExpiryBadge } from '@/components/stock-badges';
import { api } from '@/lib/api';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ProductPickerProps {
  onSelect: (product: Product) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Inclure les produits archivés. */
  includeInactive?: boolean;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Affiche la TVA / le prix d'achat plutôt que le prix de vente. */
  mode?: 'sale' | 'purchase';
  clearOnSelect?: boolean;
}

/**
 * Recherche produit au clavier et au scanner (nom, DCI, code, code-barres).
 * Un lecteur de code-barres « tape » le code puis Entrée : le produit correspondant est choisi directement.
 */
export function ProductPicker({
  onSelect,
  placeholder,
  autoFocus,
  includeInactive,
  className,
  inputRef,
  mode = 'sale',
  clearOnSelect = true,
}: ProductPickerProps) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const requestId = React.useRef(0);
  const listId = React.useId();
  const cameraSupported = useCameraScanSupported();
  const [scanning, setScanning] = React.useState(false);

  const run = React.useCallback(
    async (q: string): Promise<Product[]> => {
      const id = ++requestId.current;
      if (!q.trim()) {
        setResults([]);
        return [];
      }
      setLoading(true);
      try {
        const res = await api.get<Product[]>('/products/search', {
          query: { q, all: includeInactive ? '1' : '0' },
        });
        if (id === requestId.current) {
          setResults(res);
          setActive(0);
        }
        return res;
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [includeInactive],
  );

  React.useEffect(() => {
    const handle = window.setTimeout(() => void run(query), 150);
    return () => window.clearTimeout(handle);
  }, [query, run]);

  /** Code lu par la caméra : sélection directe du produit correspondant (comme un lecteur USB). */
  const onScanned = async (code: string) => {
    const list = await run(code);
    const exact = list.find(
      (p) => p.barcodes.some((b) => b.barcode === code) || p.internalCode === code.toUpperCase(),
    );
    const pick = exact ?? list[0];
    if (pick) choose(pick);
    else {
      setQuery(code);
      setOpen(true);
    }
  };

  const choose = (p: Product) => {
    onSelect(p);
    if (clearOnSelect) {
      setQuery('');
      setResults([]);
    }
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        className={cn('pl-8', cameraSupported && 'pr-11')}
        placeholder={placeholder ?? 'Nom, DCI, code ou code-barres…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Délai pour laisser passer le clic sur une suggestion ; pas de fermeture si le champ a repris le focus.
          const input = e.currentTarget;
          window.setTimeout(() => {
            if (document.activeElement !== input) setOpen(false);
          }, 150);
        }}
        onKeyDown={async (e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const q = query.trim();
            if (!q) return;
            // Saisie rapide (scanner) : on interroge immédiatement sans attendre le délai.
            const list = results.length > 0 && !loading ? results : await run(q);
            const exact = list.find(
              (p) => p.barcodes.some((b) => b.barcode === q) || p.internalCode === q.toUpperCase(),
            );
            const pick = exact ?? list[Math.min(active, list.length - 1)];
            if (pick) choose(pick);
          }
        }}
      />
      {loading && (
        <Loader2
          className={cn(
            'absolute top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground',
            cameraSupported ? 'right-12' : 'right-2.5',
          )}
        />
      )}
      {cameraSupported && (
        <>
          <button
            type="button"
            onClick={() => setScanning(true)}
            aria-label="Scanner avec la caméra"
            className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-primary hover:bg-muted"
          >
            <ScanLine className="size-5" />
          </button>
          <CameraScannerDialog
            open={scanning}
            onOpenChange={setScanning}
            onDetect={(code) => void onScanned(code)}
          />
        </>
      )}
      {open && query.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-96 w-full min-w-0 sm:min-w-[28rem] overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
        >
          {!loading && results.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              Aucun produit trouvé.
            </li>
          )}
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-sm px-2.5 py-2',
                i === active && 'bg-muted',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{productLabel(p)}</span>
                  {!p.isActive && <Badge variant="gray">Archivé</Badge>}
                  {p.requiresPrescription && <Badge variant="blue">Ordonnance</Badge>}
                  {p.controlledClass !== 'NONE' && (
                    <Badge variant="red">Tableau {p.controlledClass}</Badge>
                  )}
                  {p.coldChain && (
                    <Snowflake className="size-3.5 text-sky-600" aria-label="Chaîne du froid" />
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {p.internalCode} · {p.dci ?? '—'} · {p.laboratory?.name ?? ''}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                <span className="font-medium tabular">
                  {mode === 'sale'
                    ? formatMoney(p.salePriceTtc)
                    : p.refPurchasePriceHt !== undefined
                      ? `${formatMoney(p.refPurchasePriceHt)} HT`
                      : ''}
                </span>
                <span
                  className={cn(
                    'tabular',
                    p.stock.sellable <= 0 ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  Stock : {formatStockQty(p.stock.sellable, p.unitsPerPack, p.sellByUnit)}
                </span>
                {p.stock.nextExpiry && <ExpiryBadge date={p.stock.nextExpiry} level="OK" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
