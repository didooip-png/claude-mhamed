import {
  formatStockQty,
  mulDivRound,
  productLabel,
  RETURN_CONDITIONS,
  type OverrideInput,
  type Paginated,
  type ReturnCondition,
} from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Search, Undo2 } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FormField } from '@/components/form';
import { isOverrideCancelled, withOverride } from '@/components/override-dialog';
import { ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { api, errorText, newIdempotencyKey } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SaleStatusBadge } from '@/pages/sales/sales-pages';
import type { ReturnDetail, Returnable } from './return-types';

interface SaleHit {
  id: string;
  number: string;
  status: string;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  returnStatus: string;
  validatedAt: string;
  totalTtc: number;
  client: { name: string } | null;
}

/** Étape 1 : retrouver la vente d'origine (numéro de facture, client). */
function SaleFinder({ onPick }: { onPick: (id: string) => void }) {
  const fmt = useFormat();
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<SaleHit[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const request = React.useRef(0);

  React.useEffect(() => {
    const id = ++request.current;
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .get<Paginated<SaleHit>>('/sales', {
          query: { q: query, status: 'VALIDATED', pageSize: 10 },
        })
        .then((res) => id === request.current && setHits(res.items))
        .catch(() => undefined)
        .finally(() => id === request.current && setLoading(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vente d’origine</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="N° de facture (FAC-…), nom ou téléphone du client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher la vente d’origine"
          />
        </div>
        {loading && <Skeleton className="h-16" />}
        {hits && hits.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">Aucune vente trouvée.</p>
        )}
        {hits && hits.length > 0 && (
          <ul className="divide-y rounded-md border">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => onPick(h.id)}
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="font-mono text-xs">{h.number}</span>
                  <span className="min-w-0 flex-1 truncate">{h.client?.name ?? '—'}</span>
                  <span className="text-xs text-muted-foreground tabular">
                    {fmt.dateTime(h.validatedAt)}
                  </span>
                  <SaleStatusBadge status={h.status} paymentStatus={h.paymentStatus} />
                  {h.returnStatus !== 'NONE' && (
                    <Badge variant={h.returnStatus === 'RETURNED' ? 'red' : 'yellow'}>
                      {h.returnStatus === 'RETURNED' ? 'Déjà retournée' : 'Retour partiel'}
                    </Badge>
                  )}
                  <span className="font-medium tabular">{fmt.money(h.totalTtc)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface EntryState {
  qty: string;
  unit: 'PACK' | 'UNIT';
  condition: ReturnCondition;
}

const entryKey = (lineId: string, lotId: string) => `${lineId}:${lotId}`;

/** Assistant de retour client (§6.8) : vente → produits, lots, état → remboursement. */
export function ReturnWizardPage() {
  const [params, setParams] = useSearchParams();
  const saleId = params.get('saleId');
  if (!saleId) {
    return (
      <>
        <PageHeader
          title="Nouveau retour client"
          description="Retrouvez d’abord la vente d’origine."
        />
        <SaleFinder onPick={(id) => setParams({ saleId: id })} />
      </>
    );
  }
  return <ReturnForm saleId={saleId} onChangeSale={() => setParams({})} />;
}

function ReturnForm({ saleId, onChangeSale }: { saleId: string; onChangeSale: () => void }) {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['returns', 'returnable', saleId],
    queryFn: () => api.get<Returnable>(`/returns/sale/${saleId}/returnable`),
  });
  const [entries, setEntries] = React.useState<Record<string, EntryState>>({});
  const [reason, setReason] = React.useState('');
  const [refundMode, setRefundMode] = React.useState<'CREDIT' | 'CASH'>('CREDIT');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (info.data?.rules.walkIn) setRefundMode('CASH');
  }, [info.data]);

  if (info.error) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  if (!info.data) return <Skeleton className="h-96" />;
  const data = info.data;
  const { sale, rules } = data;

  const factor = (line: Returnable['lines'][number], unit: 'PACK' | 'UNIT') =>
    line.product.sellByUnit && unit === 'PACK' ? line.product.unitsPerPack : 1;
  const stateOf = (
    line: Returnable['lines'][number],
    lot: Returnable['lines'][number]['lots'][number],
  ): EntryState =>
    entries[entryKey(line.id, lot.lotId)] ?? {
      qty: '',
      unit: line.unit,
      condition: lot.expired || lot.status === 'QUARANTINE' ? 'QUARANTINE' : 'RESELLABLE',
    };
  const setEntry = (key: string, patch: Partial<EntryState>, base: EntryState) =>
    setEntries((e) => ({ ...e, [key]: { ...base, ...(e[key] ?? {}), ...patch } }));

  // Sélection et estimation du montant (même arrondi cumulé que le serveur).
  const selected = data.lines.flatMap((line) =>
    line.lots.flatMap((lot) => {
      const st = stateOf(line, lot);
      const qty = Number.parseInt(st.qty, 10);
      if (!Number.isInteger(qty) || qty <= 0) return [];
      return [{ line, lot, st, qty, base: qty * factor(line, st.unit) }];
    }),
  );
  const errors = selected
    .filter((s) => s.base > s.lot.returnableQtyBase)
    .map(
      (s) =>
        `${productLabel(s.line.product)} (lot ${s.lot.lotNumber}) : maximum ${formatStockQty(s.lot.returnableQtyBase, s.line.product.unitsPerPack, s.line.product.sellByUnit)}`,
    );
  const perLine = data.lines.map((line) => {
    const base = selected.filter((s) => s.line.id === line.id).reduce((a, s) => a + s.base, 0);
    const cum = (r: number) => mulDivRound(line.lineTotalTtc, r, line.qtyBase);
    return base > 0 ? cum(line.returnedQtyBase + base) - cum(line.returnedQtyBase) : 0;
  });
  const total = perLine.reduce((a, v) => a + v, 0);
  const reduction = Math.min(total, sale.amountDue);
  const excess = total - reduction;
  const needsCode =
    (rules.requireAdminCode && !can('returns.approve')) ||
    (rules.late && !can('returns.late')) ||
    (selected.some((s) => s.line.notReturnable) && !can('returns.non_returnable'));
  const canSubmit =
    selected.length > 0 && errors.length === 0 && reason.trim().length >= 3 && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      const idempotencyKey = newIdempotencyKey();
      const res = await withOverride((override?: OverrideInput) =>
        api.post<{ return: ReturnDetail; warnings: string[] }>(
          '/returns',
          {
            saleId,
            reason: reason.trim(),
            refundMode,
            entries: selected.map((s) => ({
              saleLineId: s.line.id,
              lotId: s.lot.lotId,
              qty: s.qty,
              unit: s.st.unit,
              condition: s.st.condition,
            })),
            override,
          },
          { idempotencyKey },
        ),
      );
      toast.success(
        `Retour ${res.return.number} enregistré${res.return.creditNote ? ` — avoir ${res.return.creditNote.number}` : ''}.`,
      );
      res.warnings.forEach((w) => toast.warning(w));
      void navigate(`/returns/${res.return.id}`);
    } catch (err) {
      if (!isOverrideCancelled(err)) toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nouveau retour client"
        description={`Facture ${sale.number}`}
        actions={
          <Button variant="outline" onClick={onChangeSale}>
            <ArrowLeft /> Changer de vente
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-card px-4 py-2.5 text-sm">
        <span>
          <span className="text-muted-foreground">Client : </span>
          <strong>{sale.client?.name ?? '—'}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">Vente du </span>
          {fmt.dateTime(sale.validatedAt)}
        </span>
        <span>
          <span className="text-muted-foreground">Total </span>
          <span className="tabular">{fmt.money(sale.totalTtc)}</span>
        </span>
        {sale.amountDue > 0 && (
          <Badge variant="orange">Reste à payer : {fmt.money(sale.amountDue)}</Badge>
        )}
        {rules.late && (
          <Badge variant="red" className="gap-1">
            <AlertTriangle className="size-3" /> Hors délai : {rules.daysSinceSale} j (max{' '}
            {rules.maxDays} j) — code administrateur
          </Badge>
        )}
        {sale.status !== 'VALIDATED' && (
          <Badge variant="red">Vente non retournable ({sale.status})</Badge>
        )}
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Produits retournés</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.lines.map((line) => (
            <div key={line.id} className="rounded-md border">
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="font-medium">{productLabel(line.product)}</span>
                <span className="text-xs text-muted-foreground">{line.product.internalCode}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  Vendu{' '}
                  {formatStockQty(line.qtyBase, line.product.unitsPerPack, line.product.sellByUnit)}{' '}
                  · déjà retourné{' '}
                  {formatStockQty(
                    line.returnedQtyBase,
                    line.product.unitsPerPack,
                    line.product.sellByUnit,
                  )}{' '}
                  · total ligne {fmt.money(line.lineTotalTtc)}
                </span>
                {line.notReturnable && (
                  <Badge variant="red" title={line.notReturnable}>
                    Retour non autorisé — code administrateur
                  </Badge>
                )}
              </div>
              {line.returnableQtyBase <= 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">Entièrement retournée.</p>
              ) : (
                <ul className="divide-y">
                  {line.lots
                    .filter((lot) => lot.returnableQtyBase > 0)
                    .map((lot) => {
                      const key = entryKey(line.id, lot.lotId);
                      const st = stateOf(line, lot);
                      return (
                        <li key={lot.lotId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                          <div className="min-w-40">
                            <div className="font-mono text-sm">{lot.lotNumber}</div>
                            <div className="text-xs text-muted-foreground">
                              exp. {fmt.isoDate(lot.expiryDate)}
                              {lot.expired && (
                                <Badge variant="red" className="ml-1">
                                  Périmé
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Retournable :{' '}
                            {formatStockQty(
                              lot.returnableQtyBase,
                              line.product.unitsPerPack,
                              line.product.sellByUnit,
                            )}
                          </div>
                          <div className="ml-auto flex flex-wrap items-center gap-2">
                            <Input
                              inputMode="numeric"
                              className="h-8 w-20 text-right tabular"
                              placeholder="Qté"
                              aria-label={`Quantité retournée, lot ${lot.lotNumber}`}
                              value={st.qty}
                              onChange={(e) =>
                                setEntry(key, { qty: e.target.value.replace(/\D/g, '') }, st)
                              }
                            />
                            {line.product.sellByUnit && (
                              <NativeSelect
                                className="h-8 w-24 text-xs"
                                value={st.unit}
                                onChange={(e) =>
                                  setEntry(key, { unit: e.target.value as 'PACK' | 'UNIT' }, st)
                                }
                                aria-label="Unité"
                              >
                                <option value="PACK">Boîte</option>
                                <option value="UNIT">Unité</option>
                              </NativeSelect>
                            )}
                            <NativeSelect
                              className="h-8 w-72 text-xs"
                              value={st.condition}
                              onChange={(e) =>
                                setEntry(key, { condition: e.target.value as ReturnCondition }, st)
                              }
                              aria-label={`État du produit, lot ${lot.lotNumber}`}
                            >
                              {(
                                Object.entries(RETURN_CONDITIONS) as [ReturnCondition, string][]
                              ).map(([k, v]) => (
                                <option
                                  key={k}
                                  value={k}
                                  disabled={k === 'RESELLABLE' && lot.expired}
                                >
                                  {v}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Motif et remboursement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <FormField label="Motif du retour" required>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Motif du retour"
              />
            </FormField>
            <FormField label="Mode de remboursement">
              <div className="flex flex-col gap-1.5 text-sm">
                {!rules.walkIn && (
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="refund"
                      checked={refundMode === 'CREDIT'}
                      onChange={() => setRefundMode('CREDIT')}
                    />
                    Avoir sur le compte du client (utilisable dès maintenant)
                  </label>
                )}
                <label
                  className={cn(
                    'flex items-center gap-2',
                    !rules.canCashRefund && 'text-muted-foreground',
                  )}
                >
                  <input
                    type="radio"
                    name="refund"
                    checked={refundMode === 'CASH'}
                    disabled={!rules.canCashRefund}
                    onChange={() => setRefundMode('CASH')}
                  />
                  Remboursement en espèces (administrateur, session de caisse ouverte)
                </label>
              </div>
            </FormField>
            {needsCode && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                🔑 Un code administrateur sera demandé à la validation.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Récapitulatif</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between text-base font-semibold">
              <span>Montant du retour</span>
              <span className="tabular" data-testid="return-total">
                {fmt.money(total)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Prix réellement payé (après remises), au prorata des quantités.
            </p>
            {reduction > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Vient réduire le reste à payer de la facture</span>
                <span className="tabular">−{fmt.money(reduction)}</span>
              </div>
            )}
            {total > 0 && (
              <div className="flex justify-between">
                <span>
                  {refundMode === 'CASH'
                    ? 'Remboursé en espèces'
                    : 'Crédit disponible pour le client'}
                </span>
                <span className="font-medium tabular">{fmt.money(excess)}</span>
              </div>
            )}
            {errors.length > 0 && (
              <ul className="text-destructive">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <Button
              size="lg"
              className="mt-2"
              disabled={!canSubmit}
              loading={busy}
              onClick={() => void submit()}
            >
              <Undo2 /> Enregistrer le retour
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/returns">Annuler</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
