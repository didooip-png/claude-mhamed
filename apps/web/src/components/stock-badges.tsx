import { formatIsoDate, formatStockQty } from '@pharmastock/shared';
import { Badge } from '@/components/ui/badge';
import type { ExpiryLevel } from '@/lib/types';

const LEVEL: Record<
  ExpiryLevel,
  { variant: 'red' | 'orange' | 'yellow' | 'green'; label: string }
> = {
  EXPIRED: { variant: 'red', label: 'Périmé' },
  CRITICAL: { variant: 'orange', label: '< 30 j' },
  WARNING: { variant: 'yellow', label: '< 90 j' },
  OK: { variant: 'green', label: 'OK' },
};

/** Date de péremption avec code couleur constant (§10). */
export function ExpiryBadge({
  date,
  level,
  days,
}: {
  date: string;
  level: ExpiryLevel;
  days?: number;
}) {
  const cfg = LEVEL[level];
  const title =
    days === undefined ? cfg.label : days <= 0 ? `Périmé depuis ${-days} j` : `Dans ${days} j`;
  return (
    <Badge variant={cfg.variant} title={title} className="tabular">
      {formatIsoDate(date)}
    </Badge>
  );
}

export function StockStatusBadge({ status }: { status: 'OK' | 'LOW' | 'OUT' }) {
  if (status === 'OUT') return <Badge variant="red">Rupture</Badge>;
  if (status === 'LOW') return <Badge variant="yellow">Sous le seuil</Badge>;
  return <Badge variant="green">OK</Badge>;
}

const LOT_STATUS: Record<string, { variant: 'green' | 'red' | 'orange' | 'gray'; label: string }> =
  {
    ACTIVE: { variant: 'green', label: 'Actif' },
    BLOCKED: { variant: 'red', label: 'Bloqué' },
    QUARANTINE: { variant: 'orange', label: 'Quarantaine' },
    EXHAUSTED: { variant: 'gray', label: 'Épuisé' },
  };

export function LotStatusBadge({ status }: { status: string }) {
  const cfg = LOT_STATUS[status] ?? { variant: 'gray' as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function Qty({
  value,
  product,
}: {
  value: number;
  product: { unitsPerPack: number; sellByUnit: boolean };
}) {
  return (
    <span className="tabular">
      {formatStockQty(value, product.unitsPerPack, product.sellByUnit)}
    </span>
  );
}
