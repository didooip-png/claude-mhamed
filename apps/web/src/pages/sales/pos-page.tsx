import {
  formatIsoDate,
  formatStockQty,
  productLabel,
  type OverrideInput,
} from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  Layers,
  Pause,
  Percent,
  Printer,
  Replace,
  ShoppingCart,
  Snowflake,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { FormField, MoneyInput, PercentInput } from '@/components/form';
import { isOverrideCancelled, withOverride } from '@/components/override-dialog';
import { EmptyState } from '@/components/page';
import { ProductPicker } from '@/components/product-picker';
import { ExpiryBadge, LotStatusBadge } from '@/components/stock-badges';
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
import { Input, NativeSelect } from '@/components/ui/input';
import { Checkbox, Kbd, Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText, newIdempotencyKey } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import { useSettings } from '@/lib/queries';
import type { LotRow, Product } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ClientCard, ClientSearch, QuickClientDialog } from './pos-client';
import { PaymentDialog, type ValidatePayload } from './pos-payment';
import type { OnHoldSale, SaleLineView, SaleView } from './sale-types';

type DialogKind =
  | 'payment'
  | 'help'
  | 'onHold'
  | 'line'
  | 'lots'
  | 'equivalents'
  | 'discard'
  | 'quickClient'
  | null;

interface LastSale {
  id: string;
  number: string;
  total: number;
  change: number | null;
  due: number;
  document: ValidatePayload['document'];
}

const SHORTCUTS: [string, string][] = [
  ['F1', 'Aide (cette fenêtre)'],
  ['F2', 'Rechercher / scanner un produit'],
  ['F3', 'Choisir le client'],
  ['F4', 'Remise / prix de la ligne sélectionnée'],
  ['F6', 'Quantité de la ligne sélectionnée'],
  ['F8', 'Mettre la vente en attente'],
  ['F9', 'Paiement'],
  ['F10', 'Valider (depuis le paiement)'],
  ['↑ ↓', 'Sélectionner une ligne'],
  ['Suppr', 'Retirer la ligne sélectionnée'],
  ['Échap', 'Fermer la fenêtre courante'],
];

async function printSale(id: string, format: 'TICKET' | 'A4') {
  const pdf = await api.blob(`/sales/${id}/print`, { query: { format } });
  await platform.print(pdf, { format });
}

/** Écran de caisse (§6.6) : conçu pour le clavier et le scanner. */
export function PosPage() {
  const fmt = useFormat();
  const can = useCan();
  const settings = useSettings();
  const qc = useQueryClient();
  const [sale, setSale] = React.useState<SaleView | null>(null);
  const [booting, setBooting] = React.useState(true);
  const [selected, setSelected] = React.useState(0);
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [equivalentsOf, setEquivalentsOf] = React.useState<{
    id: string;
    name: string;
    replaceLineId?: string;
  } | null>(null);
  const [walkIn, setWalkIn] = React.useState(false);
  const [changingClient, setChangingClient] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [lastSale, setLastSale] = React.useState<LastSale | null>(null);
  const productInput = React.useRef<HTMLInputElement>(null);
  const clientInput = React.useRef<HTMLInputElement>(null);
  const qtyInputs = React.useRef(new Map<string, HTMLInputElement>());
  const chain = React.useRef<Promise<unknown>>(Promise.resolve());
  const saleRef = React.useRef<SaleView | null>(null);
  saleRef.current = sale;
  const walkInAllowed = settings['sales.walk_in_client_enabled'] && can('sales.walk_in');

  // Reprise du panier en cours après une coupure (persisté côté serveur).
  React.useEffect(() => {
    let alive = true;
    api
      .get<{ sale: SaleView | null }>('/sales/draft')
      .then((res) => alive && setSale(res.sale))
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => alive && setBooting(false));
    return () => {
      alive = false;
    };
  }, []);

  const onHold = useQuery({
    queryKey: ['sales', 'on-hold'],
    queryFn: () => api.get<OnHoldSale[]>('/sales/on-hold'),
    enabled: can('sales.hold'),
    refetchInterval: 30_000,
  });

  /** Les opérations sur le panier sont sérialisées (scanner rapide, clics successifs). */
  const run = React.useCallback(<T,>(task: () => Promise<T>): Promise<T | undefined> => {
    const next = chain.current.then(task).catch((err: unknown) => {
      if (!isOverrideCancelled(err)) toast.error(errorText(err));
      return undefined;
    });
    chain.current = next;
    return next;
  }, []);

  const ensureSale = async (): Promise<SaleView> => {
    if (saleRef.current) return saleRef.current;
    const created = await api.post<SaleView>('/sales', { clientId: null });
    saleRef.current = created;
    setSale(created);
    return created;
  };

  const apply = (view: SaleView | undefined) => {
    if (view) {
      saleRef.current = view;
      setSale(view);
    }
    return view;
  };

  const lines = sale?.lines ?? [];
  const selectedLine: SaleLineView | undefined = lines[Math.min(selected, lines.length - 1)];

  // --- Actions -----------------------------------------------------------------------

  const selectClient = (clientId: string) =>
    run(async () => {
      const current = saleRef.current;
      const view = current
        ? await api.put<SaleView>(`/sales/${current.id}/client`, { clientId })
        : await api.post<SaleView>('/sales', { clientId });
      apply(view);
      setWalkIn(false);
      setChangingClient(false);
      window.setTimeout(() => productInput.current?.focus(), 0);
    });

  const addProduct = (p: Product) => {
    if (p.stock.sellable <= 0) {
      setEquivalentsOf({ id: p.id, name: p.name });
      setDialog('equivalents');
      return;
    }
    if (p.requiresPrescription || p.controlledClass !== 'NONE') {
      toast.info(
        `${p.name} : ordonnance requise${p.controlledClass !== 'NONE' ? ` (tableau ${p.controlledClass})` : ''}.`,
      );
    }
    if (p.coldChain) toast.info(`${p.name} : produit de la chaîne du froid.`);
    void run(async () => {
      const current = await ensureSale();
      const view = apply(
        await api.post<SaleView>(`/sales/${current.id}/lines`, {
          productId: p.id,
          qty: 1,
          unit: 'PACK',
        }),
      );
      const index = view?.lines.findIndex((l) => l.product.id === p.id && l.unit === 'PACK') ?? -1;
      if (index >= 0) setSelected(index);
    });
  };

  const updateLine = (lineId: string, patch: Record<string, unknown>) =>
    run(async () => {
      const current = saleRef.current;
      if (!current) return;
      apply(
        await withOverride((override?: OverrideInput) =>
          api.patch<SaleView>(`/sales/${current.id}/lines/${lineId}`, { ...patch, override }),
        ),
      );
    });

  const removeLine = (lineId: string) =>
    run(async () => {
      const current = saleRef.current;
      if (!current) return;
      apply(await api.delete<SaleView>(`/sales/${current.id}/lines/${lineId}`));
      setSelected((s) => Math.max(0, s - 1));
    });

  const setGlobalDiscount = (discountBp: number) =>
    run(async () => {
      const current = saleRef.current;
      if (!current) return;
      apply(
        await withOverride((override?: OverrideInput) =>
          api.put<SaleView>(`/sales/${current.id}/discount`, { discountBp, override }),
        ),
      );
    });

  const savePrescription = (patch: Partial<SaleView['prescription']>) =>
    run(async () => {
      const current = saleRef.current;
      if (!current) return;
      const p = { ...current.prescription, ...patch };
      apply(
        await api.put<SaleView>(`/sales/${current.id}/prescription`, {
          prescriberName: p.prescriberName || null,
          prescriptionRef: p.prescriptionRef || null,
          prescriptionDate: p.prescriptionDate || null,
        }),
      );
    });

  const reset = () => {
    saleRef.current = null;
    setSale(null);
    setSelected(0);
    setWalkIn(false);
    setChangingClient(false);
    window.setTimeout(() => productInput.current?.focus(), 0);
  };

  const hold = () =>
    run(async () => {
      const current = saleRef.current;
      if (!current || current.lines.length === 0) {
        toast.info('Le panier est vide.');
        return;
      }
      await api.post(`/sales/${current.id}/hold`);
      toast.success('Vente mise en attente : elle peut être reprise depuis n’importe quel poste.');
      reset();
      void qc.invalidateQueries({ queryKey: ['sales', 'on-hold'] });
    });

  const resume = (id: string) =>
    run(async () => {
      const current = saleRef.current;
      if (current && current.id !== id) {
        if (current.lines.length > 0) {
          await api.post(`/sales/${current.id}/hold`);
          toast.info('La vente en cours a été mise en attente.');
        } else await api.post(`/sales/${current.id}/discard`);
      }
      apply(await api.post<SaleView>(`/sales/${id}/resume`));
      setSelected(0);
      setDialog(null);
      void qc.invalidateQueries({ queryKey: ['sales', 'on-hold'] });
    });

  const discard = () =>
    run(async () => {
      const current = saleRef.current;
      if (!current) return;
      await api.post(`/sales/${current.id}/discard`);
      toast.success('Panier abandonné.');
      setDialog(null);
      reset();
    });

  const validate = async (payload: ValidatePayload) => {
    const current = saleRef.current;
    if (!current) return;
    setValidating(true);
    const idempotencyKey = newIdempotencyKey();
    try {
      await chain.current;
      const res = await withOverride((override?: OverrideInput) =>
        api.post<{ sale: SaleView; warnings: string[] }>(
          `/sales/${current.id}/validate`,
          { ...payload, override },
          { idempotencyKey },
        ),
      );
      const v = res.sale;
      setDialog(null);
      setLastSale({
        id: v.id,
        number: v.number ?? '',
        total: v.totals.totalTtc,
        change: v.changeGiven,
        due: v.amountDue,
        document: payload.document,
      });
      toast.success(`Vente ${v.number} validée.`);
      res.warnings.forEach((w) => toast.warning(w));
      reset();
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['cash'] });
      if (payload.document !== 'NONE') {
        printSale(v.id, payload.document).catch((err: unknown) =>
          toast.error(`Impression impossible : ${errorText(err)}`),
        );
      }
    } catch (err) {
      if (!isOverrideCancelled(err)) toast.error(errorText(err));
    } finally {
      setValidating(false);
    }
  };

  const openPayment = () => {
    const current = saleRef.current;
    if (!current || current.lines.length === 0) {
      toast.info('Ajoutez au moins un produit.');
      productInput.current?.focus();
      return;
    }
    if (!current.client && !walkIn) {
      toast.error('Choisissez l’acheteur (F3) avant le paiement.');
      setChangingClient(true);
      window.setTimeout(() => clientInput.current?.focus(), 0);
      return;
    }
    if (current.lines.some((l) => l.stockIssue)) {
      toast.error(
        'Stock insuffisant sur au moins une ligne : corrigez les quantités ou proposez un équivalent.',
      );
      return;
    }
    const p = current.prescription;
    if (p.required && (!p.prescriberName || !p.prescriptionRef)) {
      toast.error('Renseignez le prescripteur et le numéro d’ordonnance.');
      document.getElementById('rx-prescriber')?.focus();
      return;
    }
    setDialog('payment');
  };

  // --- Raccourcis clavier --------------------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      const target = e.target as HTMLElement;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      switch (e.key) {
        case 'F1':
          e.preventDefault();
          setDialog('help');
          break;
        case 'F2':
          e.preventDefault();
          productInput.current?.focus();
          break;
        case 'F3':
          e.preventDefault();
          setChangingClient(true);
          window.setTimeout(() => clientInput.current?.focus(), 0);
          break;
        case 'F4':
          e.preventDefault();
          if (selectedLine) setDialog('line');
          break;
        case 'F6':
          e.preventDefault();
          if (selectedLine) qtyInputs.current.get(selectedLine.id)?.select();
          break;
        case 'F8':
          e.preventDefault();
          if (can('sales.hold')) void hold();
          break;
        case 'F9':
        case 'F10':
          e.preventDefault();
          openPayment();
          break;
        case 'Delete':
          if (!inField && selectedLine) {
            e.preventDefault();
            void removeLine(selectedLine.id);
          }
          break;
        case 'ArrowDown':
          if (!inField && lines.length > 0) {
            e.preventDefault();
            setSelected((s) => Math.min(s + 1, lines.length - 1));
          }
          break;
        case 'ArrowUp':
          if (!inField && lines.length > 0) {
            e.preventDefault();
            setSelected((s) => Math.max(s - 1, 0));
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (booting) return <Skeleton className="h-[70vh]" />;

  const showClientSearch = changingClient || (!sale?.client && !walkIn);
  const totals = sale?.totals;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {lastSale && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/40">
          <CheckCircle2 className="size-5 text-emerald-600" />
          <div className="text-sm">
            Vente{' '}
            <Link to={`/sales/${lastSale.id}`} className="font-semibold hover:underline">
              {lastSale.number}
            </Link>{' '}
            validée — <span className="tabular">{fmt.money(lastSale.total)}</span>
            {lastSale.due > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {' '}
                · reste dû {fmt.money(lastSale.due)}
              </span>
            )}
          </div>
          {lastSale.change !== null && lastSale.change > 0 && (
            <div className="text-lg">
              Rendu :{' '}
              <span className="font-bold text-emerald-700 tabular dark:text-emerald-400">
                {fmt.money(lastSale.change)}
              </span>
            </div>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                printSale(lastSale.id, 'TICKET').catch((err: unknown) =>
                  toast.error(errorText(err)),
                )
              }
            >
              <Printer /> Ticket
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                printSale(lastSale.id, 'A4').catch((err: unknown) => toast.error(errorText(err)))
              }
            >
              <FileText /> Facture A4
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setLastSale(null)}
              aria-label="Masquer"
            >
              <X />
            </Button>
          </div>
        </div>
      )}

      {/* Acheteur (obligatoire, RG-09) */}
      <div className="flex flex-col gap-2">
        {showClientSearch ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-72 flex-1">
              <ClientSearch
                inputRef={clientInput}
                autoFocus={!sale?.client}
                onSelect={(c) => void selectClient(c.id)}
              />
            </div>
            <Button variant="outline" onClick={() => setDialog('quickClient')}>
              <UserPlus /> Nouveau client
            </Button>
            {walkInAllowed && (
              <Button
                variant="outline"
                onClick={() => {
                  setWalkIn(true);
                  setChangingClient(false);
                  if (saleRef.current?.client) {
                    void run(async () =>
                      apply(
                        await api.put<SaleView>(`/sales/${saleRef.current!.id}/client`, {
                          clientId: null,
                        }),
                      ),
                    );
                  }
                }}
              >
                Client comptoir
              </Button>
            )}
            {changingClient && sale?.client && (
              <Button variant="ghost" onClick={() => setChangingClient(false)}>
                Annuler
              </Button>
            )}
          </div>
        ) : (
          <ClientCard
            client={sale?.client ?? null}
            walkIn={walkIn}
            onClear={() => setWalkIn(false)}
            onChange={() => {
              setChangingClient(true);
              window.setTimeout(() => clientInput.current?.focus(), 0);
            }}
          />
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Panier */}
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <ProductPicker
              inputRef={productInput}
              autoFocus={!!sale?.client}
              onSelect={addProduct}
              className="flex-1"
              placeholder="Scanner ou rechercher un produit (F2)…"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDialog('help')}
              aria-label="Aide (F1)"
            >
              <HelpCircle />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {lines.length === 0 ? (
              <EmptyState
                icon={<ShoppingCart />}
                title="Panier vide"
                description="Scannez un code-barres ou recherchez un produit (nom, DCI, code)."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH className="w-8">#</TH>
                    <TH className="min-w-56">Produit · lots qui seront sortis</TH>
                    <TH className="text-right">Quantité</TH>
                    <TH className="text-right">PU TTC</TH>
                    <TH className="text-right">Remise</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="w-20" />
                  </TR>
                </THead>
                <TBody>
                  {lines.map((l, i) => (
                    <CartRow
                      key={l.id}
                      line={l}
                      index={i}
                      selected={selectedLine?.id === l.id}
                      onSelect={() => setSelected(i)}
                      qtyRef={(el) => {
                        if (el) qtyInputs.current.set(l.id, el);
                        else qtyInputs.current.delete(l.id);
                      }}
                      onQty={(qty) => qty !== l.qty && void updateLine(l.id, { qty })}
                      onUnit={(unit) => void updateLine(l.id, { unit })}
                      onEdit={() => {
                        setSelected(i);
                        setDialog('line');
                      }}
                      onLots={() => {
                        setSelected(i);
                        setDialog('lots');
                      }}
                      onEquivalents={() => {
                        setEquivalentsOf({
                          id: l.product.id,
                          name: l.product.name,
                          replaceLineId: l.id,
                        });
                        setDialog('equivalents');
                      }}
                      onRemove={() => void removeLine(l.id)}
                    />
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </div>

        {/* Totaux et actions */}
        <div className="flex flex-col gap-3">
          {sale?.prescription.required && (
            <PrescriptionCard sale={sale} onSave={savePrescription} />
          )}
          <div className="rounded-lg border bg-card p-4">
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total HT</dt>
                <dd className="tabular">{fmt.money(totals?.subtotalHt ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">TVA</dt>
                <dd className="tabular">{fmt.money(totals?.totalTva ?? 0)}</dd>
              </div>
              {(totals?.totalDiscount ?? 0) > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <dt>Remises</dt>
                  <dd className="tabular">−{fmt.money(totals!.totalDiscount)}</dd>
                </div>
              )}
              {(totals?.stampDuty ?? 0) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Timbre fiscal</dt>
                  <dd className="tabular">{fmt.money(totals!.stampDuty)}</dd>
                </div>
              )}
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t pt-3">
              <span className="font-medium">Total TTC</span>
              <span className="text-3xl font-bold tabular" data-testid="pos-total">
                {fmt.money(totals?.totalTtc ?? 0)}
              </span>
            </div>
            {sale && sale.globalDiscountBp > 0 && (
              <p className="mt-1 text-right text-xs text-muted-foreground">
                Remise globale {fmt.percent(sale.globalDiscountBp)}
              </p>
            )}
          </div>
          <Button
            size="xl"
            onClick={openPayment}
            disabled={!sale || lines.length === 0 || validating}
          >
            <Wallet /> Paiement{' '}
            <Kbd className="bg-primary-foreground/20 text-primary-foreground">F9</Kbd>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            {can('sales.hold') && (
              <Button variant="outline" onClick={() => void hold()} disabled={lines.length === 0}>
                <Pause /> Attente <Kbd>F8</Kbd>
              </Button>
            )}
            {can('sales.hold') && (
              <Button variant="outline" onClick={() => setDialog('onHold')}>
                <Clock /> En attente
                {(onHold.data?.length ?? 0) > 0 && (
                  <Badge variant="orange">{onHold.data!.length}</Badge>
                )}
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialog('line')} disabled={!selectedLine}>
              <Percent /> Remise <Kbd>F4</Kbd>
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setDialog('discard')}
              disabled={!sale || lines.length === 0}
            >
              <Trash2 /> Abandonner
            </Button>
          </div>
        </div>
      </div>

      {sale && (
        <PaymentDialog
          sale={sale}
          open={dialog === 'payment'}
          onOpenChange={(o) => setDialog(o ? 'payment' : null)}
          onSubmit={(p) => void validate(p)}
          busy={validating}
        />
      )}
      {sale && selectedLine && dialog === 'line' && (
        <LineDialog
          sale={sale}
          line={selectedLine}
          onClose={() => setDialog(null)}
          onApply={async (patch, global) => {
            setDialog(null);
            if (global !== null) await setGlobalDiscount(global);
            else await updateLine(selectedLine.id, patch);
          }}
        />
      )}
      {sale && selectedLine && dialog === 'lots' && (
        <LotsDialog
          line={selectedLine}
          onClose={() => setDialog(null)}
          onForce={(lotId) => {
            setDialog(null);
            void updateLine(selectedLine.id, { forcedLotId: lotId });
          }}
        />
      )}
      {dialog === 'equivalents' && equivalentsOf && (
        <EquivalentsDialog
          product={equivalentsOf}
          onClose={() => setDialog(null)}
          onPick={(p) => {
            setDialog(null);
            if (equivalentsOf.replaceLineId) void removeLine(equivalentsOf.replaceLineId);
            addProduct(p);
          }}
        />
      )}
      <Dialog open={dialog === 'onHold'} onOpenChange={(o) => setDialog(o ? 'onHold' : null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Ventes en attente</DialogTitle>
            <DialogDescription>
              Visibles depuis tous les postes. La vente reprise devient votre panier.
            </DialogDescription>
          </DialogHeader>
          {(onHold.data ?? []).length === 0 ? (
            <EmptyState title="Aucune vente en attente" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Mise en attente</TH>
                  <TH>Par</TH>
                  <TH>Client</TH>
                  <TH className="text-right">Lignes</TH>
                  <TH className="text-right">Montant</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {onHold.data!.map((h) => (
                  <TR key={h.id}>
                    <TD className="tabular">{fmt.dateTime(h.heldAt)}</TD>
                    <TD>{h.heldBy}</TD>
                    <TD>{h.client?.name ?? '—'}</TD>
                    <TD className="text-right tabular">{h.lineCount}</TD>
                    <TD className="text-right tabular">{fmt.money(h.estimatedTotal)}</TD>
                    <TD className="text-right">
                      <Button size="sm" onClick={() => void resume(h.id)}>
                        Reprendre
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === 'discard'} onOpenChange={(o) => setDialog(o ? 'discard' : null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Abandonner le panier ?</DialogTitle>
            <DialogDescription>
              Les {lines.length} ligne(s) seront retirées. L’abandon est enregistré au mouchard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Non
            </Button>
            <Button variant="destructive" autoFocus onClick={() => void discard()}>
              Abandonner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === 'help'} onOpenChange={(o) => setDialog(o ? 'help' : null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Raccourcis clavier</DialogTitle>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5 text-sm">
            {SHORTCUTS.map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <span>{v}</span>
                <Kbd>{k}</Kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <QuickClientDialog
        open={dialog === 'quickClient'}
        onOpenChange={(o) => setDialog(o ? 'quickClient' : null)}
        onCreated={(c) => void selectClient(c.id)}
      />
    </div>
  );
}

function CartRow({
  line: l,
  index,
  selected,
  onSelect,
  qtyRef,
  onQty,
  onUnit,
  onEdit,
  onLots,
  onEquivalents,
  onRemove,
}: {
  line: SaleLineView;
  index: number;
  selected: boolean;
  onSelect: () => void;
  qtyRef: (el: HTMLInputElement | null) => void;
  onQty: (qty: number) => void;
  onUnit: (unit: 'PACK' | 'UNIT') => void;
  onEdit: () => void;
  onLots: () => void;
  onEquivalents: () => void;
  onRemove: () => void;
}) {
  const fmt = useFormat();
  const [qty, setQty] = React.useState(String(l.qty));
  React.useEffect(() => setQty(String(l.qty)), [l.qty]);
  const commit = () => {
    const n = Number.parseInt(qty, 10);
    if (Number.isInteger(n) && n > 0 && n <= 100_000) onQty(n);
    else setQty(String(l.qty));
  };
  const p = l.product;
  return (
    <TR
      onClick={onSelect}
      className={cn(
        'cursor-pointer',
        selected && 'bg-primary/5 outline-1 -outline-offset-1 outline-primary/40',
        l.stockIssue && 'bg-destructive/5',
      )}
      aria-selected={selected}
    >
      <TD className="text-xs text-muted-foreground tabular">{index + 1}</TD>
      <TD>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{productLabel(p)}</span>
          {p.requiresPrescription && <Badge variant="blue">Ordonnance</Badge>}
          {p.controlledClass !== 'NONE' && <Badge variant="red">Tableau {p.controlledClass}</Badge>}
          {p.coldChain && (
            <Snowflake className="size-3.5 text-sky-600" aria-label="Chaîne du froid" />
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {p.internalCode}
          {p.sellable !== null &&
            ` · vendable ${formatStockQty(p.sellable, p.unitsPerPack, p.sellByUnit)}`}
          {p.nextExpiry && ` · proch. pér. ${formatIsoDate(p.nextExpiry)}`}
        </div>
        {l.lots.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {l.lots.map((lot) => (
              <Badge
                key={lot.lotId}
                variant={l.forcedLotId === lot.lotId ? 'orange' : 'gray'}
                className="tabular"
                title={`Péremption ${formatIsoDate(lot.expiryDate)}`}
              >
                {lot.lotNumber} · {formatIsoDate(lot.expiryDate).slice(3)} ×{' '}
                {formatStockQty(lot.qty, p.unitsPerPack, p.sellByUnit)}
              </Badge>
            ))}
          </div>
        )}
        {l.stockIssue && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="size-3.5" />
            Stock insuffisant : vendable {l.stockIssue.sellable}
            {l.stockIssue.blocked > 0 && `, bloqué ${l.stockIssue.blocked}`}
            {l.stockIssue.expired > 0 && `, périmé ${l.stockIssue.expired}`}
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onEquivalents();
              }}
            >
              <Replace /> Équivalents
            </Button>
          </div>
        )}
      </TD>
      <TD className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Input
            ref={qtyRef}
            inputMode="numeric"
            aria-label={`Quantité de ${p.name}`}
            className="h-8 w-16 text-right tabular"
            value={qty}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') setQty(String(l.qty));
            }}
          />
          {p.sellByUnit && (
            <NativeSelect
              className="h-8 w-20 px-1 text-xs"
              value={l.unit}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onUnit(e.target.value as 'PACK' | 'UNIT')}
              aria-label="Unité"
            >
              <option value="PACK">Boîte</option>
              <option value="UNIT">Unité</option>
            </NativeSelect>
          )}
        </div>
      </TD>
      <TD className="text-right tabular">
        {fmt.amount(l.unitPriceTtc)}
        {l.authorized.price && <div className="text-[11px] text-amber-700">prix modifié 🔑</div>}
      </TD>
      <TD className="text-right tabular">
        {l.discountBp > 0 ? fmt.percent(l.discountBp) : '—'}
        {l.authorized.discount && <div className="text-[11px] text-amber-700">🔑</div>}
      </TD>
      <TD className="text-right font-medium tabular">{fmt.amount(l.lineTotalTtc)}</TD>
      <TD>
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label="Remise / prix"
          >
            <Percent />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onLots();
            }}
            aria-label="Choisir le lot"
          >
            <Layers />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="Retirer la ligne"
          >
            <Trash2 />
          </Button>
        </div>
      </TD>
    </TR>
  );
}

function PrescriptionCard({
  sale,
  onSave,
}: {
  sale: SaleView;
  onSave: (patch: Partial<SaleView['prescription']>) => void;
}) {
  const p = sale.prescription;
  const [form, setForm] = React.useState({
    prescriberName: p.prescriberName ?? '',
    prescriptionRef: p.prescriptionRef ?? '',
    prescriptionDate: p.prescriptionDate ?? '',
  });
  React.useEffect(() => {
    setForm({
      prescriberName: p.prescriberName ?? '',
      prescriptionRef: p.prescriptionRef ?? '',
      prescriptionDate: p.prescriptionDate ?? '',
    });
  }, [p.prescriberName, p.prescriptionRef, p.prescriptionDate]);
  const save = (key: keyof typeof form) => {
    if ((form[key] || null) !== (p[key] || null)) onSave({ [key]: form[key] || null });
  };
  const missing = !p.prescriberName || !p.prescriptionRef;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        missing ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/30' : 'bg-card',
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText className="size-4" /> Ordonnance obligatoire
      </div>
      <FormField label="Médecin prescripteur" htmlFor="rx-prescriber" required>
        <Input
          id="rx-prescriber"
          value={form.prescriberName}
          onChange={(e) => setForm((f) => ({ ...f, prescriberName: e.target.value }))}
          onBlur={() => save('prescriberName')}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <FormField label="N° d’ordonnance" htmlFor="rx-ref" required>
          <Input
            id="rx-ref"
            value={form.prescriptionRef}
            onChange={(e) => setForm((f) => ({ ...f, prescriptionRef: e.target.value }))}
            onBlur={() => save('prescriptionRef')}
          />
        </FormField>
        <FormField label="Date" htmlFor="rx-date">
          <Input
            id="rx-date"
            type="date"
            value={form.prescriptionDate}
            onChange={(e) => setForm((f) => ({ ...f, prescriptionDate: e.target.value }))}
            onBlur={() => save('prescriptionDate')}
          />
        </FormField>
      </div>
    </div>
  );
}

/** Remise (ligne ou globale) et prix unitaire (F4) ; au-delà des droits, code administrateur. */
function LineDialog({
  sale,
  line,
  onClose,
  onApply,
}: {
  sale: SaleView;
  line: SaleLineView;
  onClose: () => void;
  onApply: (patch: Record<string, unknown>, global: number | null) => Promise<unknown>;
}) {
  const fmt = useFormat();
  const settings = useSettings();
  const can = useCan();
  const [discountBp, setDiscountBp] = React.useState(line.discountBp);
  const [price, setPrice] = React.useState<number | null>(line.unitPriceTtc);
  const [global, setGlobal] = React.useState(false);
  const limit = Math.max(
    settings['sales.preparer_max_discount_bp'],
    sale.client?.defaultDiscountBp ?? 0,
  );
  const overLimit = discountBp > limit && !can('sales.discount_over_limit');
  const priceChanged = price !== null && price !== line.unitPriceTtc;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (global) void onApply({}, discountBp);
            else {
              const patch: Record<string, unknown> = {};
              if (discountBp !== line.discountBp) patch.discountBp = discountBp;
              if (priceChanged) patch.unitPriceTtc = price;
              if (Object.keys(patch).length === 0) onClose();
              else void onApply(patch, null);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Remise et prix</DialogTitle>
            <DialogDescription>
              {line.product.name} — prix catalogue {fmt.money(line.catalogPriceTtc)}
            </DialogDescription>
          </DialogHeader>
          <FormField label="Remise" hint={`Plafond sans autorisation : ${fmt.percent(limit)}`}>
            <PercentInput
              autoFocus
              value={discountBp}
              onValueChange={setDiscountBp}
              aria-label="Remise en pourcentage"
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={global} onCheckedChange={(v) => setGlobal(v === true)} />
            Appliquer cette remise à tout le panier (remise globale)
          </label>
          {!global && (
            <FormField
              label="Prix unitaire TTC"
              hint="Toute modification du prix est tracée au mouchard."
            >
              <MoneyInput value={price} onValueChange={setPrice} aria-label="Prix unitaire TTC" />
            </FormField>
          )}
          {(overLimit || (priceChanged && !can('sales.price_override'))) && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              🔑 Une autorisation administrateur sera demandée.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">Appliquer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Choix d'un lot hors règle FEFO/FIFO (🔑 LOT_FORCED). */
function LotsDialog({
  line,
  onClose,
  onForce,
}: {
  line: SaleLineView;
  onClose: () => void;
  onForce: (lotId: string | null) => void;
}) {
  const fmt = useFormat();
  const lots = useQuery({
    queryKey: ['stock', 'lots', line.product.id, 'sellable'],
    queryFn: () =>
      api.get<{ items: LotRow[] }>('/stock/lots', {
        query: { productId: line.product.id, withStock: '1', pageSize: 50, sort: 'expiryDate:asc' },
      }),
  });
  const sellable = (lots.data?.items ?? []).filter(
    (l) => l.status === 'ACTIVE' && l.level !== 'EXPIRED',
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Lots de {line.product.name}</DialogTitle>
          <DialogDescription>
            Par défaut, les lots sont sortis selon la règle {'FEFO/FIFO'}. Forcer un autre lot
            demande une autorisation administrateur et est tracé.
          </DialogDescription>
        </DialogHeader>
        {lots.isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Lot</TH>
                <TH>Péremption</TH>
                <TH>Statut</TH>
                <TH className="text-right">Restant</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {(lots.data?.items ?? []).map((lot) => (
                <TR key={lot.id}>
                  <TD className="font-medium">
                    {lot.lotNumber}
                    {line.forcedLotId === lot.id && (
                      <Badge variant="orange" className="ml-2">
                        forcé
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    <ExpiryBadge date={lot.expiryDate} level={lot.level} days={lot.daysToExpiry} />
                  </TD>
                  <TD>
                    <LotStatusBadge status={lot.status} />
                  </TD>
                  <TD className="text-right tabular">{fmt.qty(lot.remainingQty)}</TD>
                  <TD className="text-right">
                    {sellable.some((s) => s.id === lot.id) && line.forcedLotId !== lot.id && (
                      <Button size="sm" variant="outline" onClick={() => onForce(lot.id)}>
                        Forcer ce lot
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <DialogFooter>
          {line.forcedLotId && (
            <Button variant="outline" onClick={() => onForce(null)}>
              Revenir à la règle automatique
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rupture : équivalents disponibles (même DCI, dosage et forme). */
function EquivalentsDialog({
  product,
  onClose,
  onPick,
}: {
  product: { id: string; name: string };
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const fmt = useFormat();
  const eq = useQuery({
    queryKey: ['products', product.id, 'equivalents'],
    queryFn: () => api.get<Product[]>(`/products/${product.id}/equivalents`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" /> {product.name} : stock insuffisant
          </DialogTitle>
          <DialogDescription>
            Équivalents disponibles (même DCI, dosage et forme).
          </DialogDescription>
        </DialogHeader>
        {eq.isLoading ? (
          <Skeleton className="h-24" />
        ) : (eq.data ?? []).length === 0 ? (
          <EmptyState title="Aucun équivalent en stock" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH>Laboratoire</TH>
                <TH className="text-right">Stock vendable</TH>
                <TH className="text-right">Prix</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {eq.data!.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <div className="font-medium">
                      {p.name}{' '}
                      {p.dosage && (
                        <span className="text-xs text-muted-foreground">{p.dosage}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{p.internalCode}</div>
                  </TD>
                  <TD>{p.laboratory?.name ?? '—'}</TD>
                  <TD className="text-right tabular">
                    {formatStockQty(p.stock.sellable, p.unitsPerPack, p.sellByUnit)}
                  </TD>
                  <TD className="text-right tabular">{fmt.money(p.salePriceTtc)}</TD>
                  <TD className="text-right">
                    <Button size="sm" onClick={() => onPick(p)}>
                      Ajouter
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
