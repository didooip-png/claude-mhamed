import {
  formatBp,
  formatIsoDate,
  parseExpiryInput,
  priceReceiptLine,
  SUPPLY_SOURCES,
  todayIso,
  type SupplySource,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  FileText,
  Paperclip,
  Save,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FormField, MoneyInput, PercentInput } from '@/components/form';
import { ErrorState, Field, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/product-picker';
import { LotStatusBadge } from '@/components/stock-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { api, ApiError, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useReferences, useSupplierOptions } from '@/lib/catalog';
import { useFormat } from '@/lib/format';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ReceiptLine {
  id?: string;
  lineNo: number;
  productId: string;
  lotNumber: string;
  expiryDate: string;
  qty: number;
  freeQty: number;
  unitPriceHt: number;
  discountBp: number;
  tvaRateBp: number;
  lineTotalHt: number;
  lotId: string | null;
  product: {
    id: string;
    internalCode: string;
    name: string;
    dosage: string | null;
    form: string | null;
    unitsPerPack: number;
    sellByUnit: boolean;
  };
  lot: { id: string; remainingQty: number; initialQty: number; status: string } | null;
}

interface Receipt {
  id: string;
  number: string | null;
  status: 'DRAFT' | 'VALIDATED' | 'CANCELLED';
  sourceType: SupplySource;
  sourceReason: string | null;
  supplierId: string | null;
  supplier: { id: string; code: string; name: string } | null;
  supplierInvoiceRef: string | null;
  supplierInvoiceDate: string | null;
  receivedAt: string;
  notes: string | null;
  totalHt: number;
  totalTva: number;
  totalTtc: number;
  attachmentId: string | null;
  attachment: { id: string; filename: string } | null;
  purchaseOrderId: string | null;
  purchaseOrder: { id: string; number: string | null; status: string } | null;
  version: number;
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: { code: string; fullName: string } | null;
  validatedBy: { code: string; fullName: string } | null;
  cancelledBy: { code: string; fullName: string } | null;
  lines: ReceiptLine[];
  warnings: Warning[];
}

interface Warning {
  line: number;
  productName: string;
  kind: 'EXPIRY_SOON' | 'PRICE_VARIANCE' | 'ORDER_OVERRUN' | 'NOT_ORDERED';
  message: string;
}

interface DraftLine {
  key: string;
  product: ReceiptLine['product'];
  lotNumber: string;
  expiryText: string;
  qty: number;
  freeQty: number;
  unitPriceHt: number | null;
  discountBp: number;
  tvaRateBp: number;
}

const isoDay = (v: string | null) => (v ? v.slice(0, 10) : '');

export function ReceiptPage() {
  const { id } = useParams();
  const receipt = useQuery({
    queryKey: ['receipts', id],
    queryFn: () => api.get<Receipt>(`/receipts/${id}`),
    enabled: !!id,
  });
  if (!id) return <ReceiptEditor receipt={null} />;
  if (receipt.error)
    return <ErrorState error={receipt.error} onRetry={() => void receipt.refetch()} />;
  if (!receipt.data) return <Skeleton className="h-96" />;
  return receipt.data.status === 'DRAFT' ? (
    <ReceiptEditor receipt={receipt.data} />
  ) : (
    <ReceiptView receipt={receipt.data} />
  );
}

function ReceiptEditor({ receipt }: { receipt: Receipt | null }) {
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const suppliers = useSupplierOptions();
  const refs = useReferences();
  const [header, setHeader] = React.useState({
    sourceType: (receipt?.sourceType ?? 'SUPPLIER') as SupplySource,
    sourceReason: receipt?.sourceReason ?? '',
    supplierId: receipt?.supplierId ?? '',
    supplierInvoiceRef: receipt?.supplierInvoiceRef ?? '',
    supplierInvoiceDate: isoDay(receipt?.supplierInvoiceDate ?? null),
    receivedAt: isoDay(receipt?.receivedAt ?? null) || todayIso(fmt.tz),
    notes: receipt?.notes ?? '',
    attachmentId: receipt?.attachmentId ?? null,
    attachmentName: receipt?.attachment?.filename ?? null,
  });
  const [lines, setLines] = React.useState<DraftLine[]>(
    () =>
      receipt?.lines.map((l) => ({
        key: l.id ?? crypto.randomUUID(),
        product: l.product,
        lotNumber: l.lotNumber,
        expiryText: formatIsoDate(isoDay(l.expiryDate)),
        qty: l.qty,
        freeQty: l.freeQty,
        unitPriceHt: l.unitPriceHt,
        discountBp: l.discountBp,
        tvaRateBp: l.tvaRateBp,
      })) ?? [],
  );
  const [warnings, setWarnings] = React.useState<Warning[]>(receipt?.warnings ?? []);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [updatePrices, setUpdatePrices] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const lotInputs = React.useRef(new Map<string, HTMLInputElement>());
  const pickerRef = React.useRef<HTMLInputElement>(null);
  const today = todayIso(fmt.tz);

  // Réception rattachée à une commande fournisseur : préremplie avec le reliquat à recevoir.
  const [searchParams] = useSearchParams();
  const orderId = receipt?.purchaseOrderId ?? searchParams.get('orderId');
  const order = useQuery({
    queryKey: ['purchase-orders', orderId],
    queryFn: () =>
      api.get<{
        number: string | null;
        supplier: { id: string; name: string };
        lines: {
          id: string;
          remainingQty: number;
          unitPriceHt: number;
          product: ReceiptLine['product'] & { tvaRateBp: number };
        }[];
      }>(`/purchase-orders/${orderId}`),
    enabled: !!orderId,
  });
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (receipt || prefilled.current || !order.data) return;
    prefilled.current = true;
    setHeader((h) => ({ ...h, sourceType: 'SUPPLIER', supplierId: order.data.supplier.id }));
    setLines(
      order.data.lines
        .filter((l) => l.remainingQty > 0)
        .map((l) => ({
          key: crypto.randomUUID(),
          product: l.product,
          lotNumber: '',
          expiryText: '',
          qty: l.remainingQty,
          freeQty: 0,
          unitPriceHt: l.unitPriceHt,
          discountBp: 0,
          tvaRateBp: l.product.tvaRateBp,
        })),
    );
  }, [order.data, receipt]);

  const addProduct = (p: Product) => {
    const key = crypto.randomUUID();
    setLines((prev) => [
      ...prev,
      {
        key,
        product: {
          id: p.id,
          internalCode: p.internalCode,
          name: p.name,
          dosage: p.dosage,
          form: p.form,
          unitsPerPack: p.unitsPerPack,
          sellByUnit: p.sellByUnit,
        },
        lotNumber: '',
        expiryText: '',
        qty: 1,
        freeQty: 0,
        unitPriceHt: p.refPurchasePriceHt ?? 0,
        discountBp: 0,
        tvaRateBp: p.tvaRate.rateBp,
      },
    ]);
    window.setTimeout(() => lotInputs.current.get(key)?.focus(), 30);
  };
  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const priced = lines.map((l) => {
    try {
      return priceReceiptLine({
        qty: l.qty,
        freeQty: l.freeQty,
        unitPriceHt: l.unitPriceHt ?? 0,
        discountBp: l.discountBp,
        tvaBp: l.tvaRateBp,
      });
    } catch {
      return null;
    }
  });
  const totals = priced.reduce(
    (a, p) => ({ ht: a.ht + (p?.lineTotalHt ?? 0), tva: a.tva + (p?.lineTva ?? 0) }),
    { ht: 0, tva: 0 },
  );
  const lineIssues = lines.map((l) => {
    const expiry = parseExpiryInput(l.expiryText);
    if (!l.lotNumber.trim()) return 'N° de lot obligatoire';
    if (!expiry) return 'Péremption invalide (MM/AAAA)';
    if (expiry <= today) return 'Péremption passée';
    if (l.qty + l.freeQty <= 0) return 'Quantité obligatoire';
    if (l.unitPriceHt === null) return 'Prix obligatoire';
    return null;
  });

  const payload = () => ({
    sourceType: header.sourceType,
    sourceReason: header.sourceReason || null,
    supplierId: header.supplierId || null,
    supplierInvoiceRef: header.supplierInvoiceRef || null,
    supplierInvoiceDate: header.supplierInvoiceDate || null,
    receivedAt: header.receivedAt,
    notes: header.notes || null,
    attachmentId: header.attachmentId,
    purchaseOrderId: orderId ?? null,
    lines: lines.map((l) => ({
      productId: l.product.id,
      lotNumber: l.lotNumber,
      expiryDate: parseExpiryInput(l.expiryText) ?? '',
      qty: l.qty,
      freeQty: l.freeQty,
      unitPriceHt: l.unitPriceHt ?? 0,
      discountBp: l.discountBp,
      tvaRateBp: l.tvaRateBp,
    })),
  });

  // Brouillon déjà enregistré (id + version) : les enregistrements suivants le mettent à jour.
  const saved = React.useRef<{ id: string; version: number } | null>(
    receipt ? { id: receipt.id, version: receipt.version } : null,
  );
  const save = useMutation({
    mutationFn: async () => {
      const body = payload();
      let id: string;
      if (saved.current) {
        await api.put(`/receipts/${saved.current.id}`, { ...body, version: saved.current.version });
        id = saved.current.id;
      } else {
        id = (await api.post<{ id: string }>('/receipts', body)).id;
      }
      const fresh = await api.get<Receipt>(`/receipts/${id}`);
      saved.current = { id: fresh.id, version: fresh.version };
      return fresh;
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    },
  });

  const saveDraft = async (options: { navigateToDraft: boolean }) => {
    const draft = await save.mutateAsync();
    setWarnings(draft.warnings);
    void qc.invalidateQueries({ queryKey: ['receipts'] });
    if (options.navigateToDraft) {
      toast.success('Brouillon enregistré');
      if (!receipt) void navigate(`/receipts/${draft.id}`, { replace: true });
    }
    return draft;
  };

  const validate = useMutation({
    mutationFn: async () => {
      const draft = await save.mutateAsync();
      return api.post<{ number: string; id: string }>(`/receipts/${draft.id}/validate`, {
        acknowledgeWarnings: true,
        updateReferencePrices: updatePrices,
      });
    },
    onSuccess: (r) => {
      toast.success(`Réception ${r.number} validée : lots créés et stock mis à jour`);
      void qc.invalidateQueries({ queryKey: ['receipts'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      setConfirmOpen(false);
      void navigate(`/receipts/${r.id}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && Array.isArray(err.details.lines)) {
        toast.error(
          `${err.message} (${(err.details.lines as { product: string }[]).map((l) => l.product).join(', ')})`,
        );
      } else toast.error(errorText(err));
    },
  });

  const discard = useMutation({
    mutationFn: () => api.delete(`/receipts/${saved.current!.id}`),
    onSuccess: () => {
      toast.success('Brouillon abandonné');
      void qc.invalidateQueries({ queryKey: ['receipts'] });
      void navigate('/receipts');
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api.post<{ id: string; filename: string }>('/attachments', body);
    },
    onSuccess: (a) => setHeader((h) => ({ ...h, attachmentId: a.id, attachmentName: a.filename })),
    onError: (err) => toast.error(errorText(err)),
  });

  const canValidate =
    lines.length > 0 &&
    lineIssues.every((i) => i === null) &&
    (header.sourceType !== 'SUPPLIER' || !!header.supplierId) &&
    (header.sourceType !== 'OTHER' || !!header.sourceReason);

  return (
    <>
      <PageHeader
        title={receipt ? 'Réception — brouillon' : 'Nouvelle réception'}
        description="Entrée en stock : chaque ligne crée un lot (numéro, péremption, quantité, source). La péremption se saisit comme sur la boîte : MM/AAAA."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/receipts">
                <ArrowLeft /> Réceptions
              </Link>
            </Button>
            {saved.current && (
              <Button
                variant="outline"
                onClick={() => discard.mutate()}
                loading={discard.isPending}
              >
                <Trash2 /> Abandonner
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void saveDraft({ navigateToDraft: true })}
              loading={save.isPending && !validate.isPending}
              disabled={lines.length === 0}
            >
              <Save /> Enregistrer le brouillon
            </Button>
            {can('receipts.validate') && (
              <Button
                disabled={!canValidate}
                onClick={async () => {
                  await saveDraft({ navigateToDraft: false });
                  setConfirmOpen(true);
                }}
              >
                <CheckCircle2 /> Valider la réception
              </Button>
            )}
          </>
        }
      />
      {orderId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-200">
          <span>
            Réception rattachée à la commande{' '}
            <Link to={`/purchase-orders/${orderId}`} className="font-mono font-medium underline">
              {order.data?.number ?? receipt?.purchaseOrder?.number ?? '…'}
            </Link>
            {order.data ? ` (${order.data.supplier.name})` : ''} : les quantités sont contrôlées à
            la validation.
          </span>
        </div>
      )}
      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Source d’approvisionnement" required>
            <NativeSelect
              value={header.sourceType}
              onChange={(e) =>
                setHeader((h) => ({ ...h, sourceType: e.target.value as SupplySource }))
              }
            >
              {Object.entries(SUPPLY_SOURCES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label="Fournisseur"
            required={header.sourceType === 'SUPPLIER'}
            error={errors.supplierId}
          >
            <NativeSelect
              value={header.supplierId}
              onChange={(e) => setHeader((h) => ({ ...h, supplierId: e.target.value }))}
            >
              <option value="">{header.sourceType === 'SUPPLIER' ? 'Choisir…' : '—'}</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Réf. facture fournisseur">
            <Input
              value={header.supplierInvoiceRef}
              onChange={(e) => setHeader((h) => ({ ...h, supplierInvoiceRef: e.target.value }))}
            />
          </FormField>
          <FormField label="Date facture">
            <Input
              type="date"
              value={header.supplierInvoiceDate}
              onChange={(e) => setHeader((h) => ({ ...h, supplierInvoiceDate: e.target.value }))}
            />
          </FormField>
          <FormField label="Date de réception" required>
            <Input
              type="date"
              max={today}
              value={header.receivedAt}
              onChange={(e) => setHeader((h) => ({ ...h, receivedAt: e.target.value }))}
            />
          </FormField>
          {header.sourceType === 'OTHER' && (
            <FormField label="Motif (source « Autre »)" required error={errors.sourceReason}>
              <Input
                value={header.sourceReason}
                onChange={(e) => setHeader((h) => ({ ...h, sourceReason: e.target.value }))}
              />
            </FormField>
          )}
          <FormField label="Scan de la facture" hint="PDF, PNG ou JPEG (8 Mo max.)">
            <div className="flex items-center gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm hover:bg-muted">
                <Paperclip className="size-4" /> {header.attachmentName ? 'Remplacer' : 'Joindre'}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
                />
              </label>
              {header.attachmentName && (
                <span className="truncate text-xs text-muted-foreground">
                  {header.attachmentName}
                </span>
              )}
            </div>
          </FormField>
          <FormField label="Notes" className="sm:col-span-2">
            <Textarea
              rows={1}
              value={header.notes}
              onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Lignes ({lines.length})</CardTitle>
          <ProductPicker
            inputRef={pickerRef}
            onSelect={addProduct}
            mode="purchase"
            className="w-full max-w-lg"
            placeholder="Scanner ou rechercher un produit à ajouter…"
            autoFocus={!receipt}
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH>N° de lot</TH>
                <TH>Péremption</TH>
                <TH className="text-right">Qté</TH>
                <TH className="text-right">UG</TH>
                <TH className="text-right">Prix HT</TH>
                <TH className="text-right">Remise</TH>
                <TH className="text-right">TVA</TH>
                <TH className="text-right">Total HT</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {lines.length === 0 && (
                <TR>
                  <TD colSpan={10} className="py-8 text-center text-muted-foreground">
                    Scannez un code-barres ou recherchez un produit ci-dessus.
                  </TD>
                </TR>
              )}
              {lines.map((l, i) => {
                const expiry = parseExpiryInput(l.expiryText);
                const issue = lineIssues[i];
                return (
                  <TR key={l.key} className={cn(issue && 'bg-red-50/50 dark:bg-red-950/20')}>
                    <TD className="min-w-48">
                      <div className="font-medium">{l.product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.product.internalCode} {l.product.dosage ?? ''}{' '}
                        {l.product.sellByUnit ? `· ${l.product.unitsPerPack} u/boîte` : ''}
                      </div>
                      {issue && <div className="text-xs text-destructive">{issue}</div>}
                    </TD>
                    <TD>
                      <Input
                        ref={(el) => {
                          if (el) lotInputs.current.set(l.key, el);
                        }}
                        className="w-32 font-mono"
                        value={l.lotNumber}
                        onChange={(e) => update(l.key, { lotNumber: e.target.value.toUpperCase() })}
                        aria-label="Numéro de lot"
                      />
                    </TD>
                    <TD>
                      <Input
                        className="w-28"
                        placeholder="MM/AAAA"
                        value={l.expiryText}
                        onChange={(e) => update(l.key, { expiryText: e.target.value })}
                        onBlur={() =>
                          expiry && update(l.key, { expiryText: formatIsoDate(expiry) })
                        }
                        aria-label="Péremption"
                      />
                    </TD>
                    <TD>
                      <Input
                        type="number"
                        min={0}
                        className="w-20 text-right"
                        value={l.qty}
                        onChange={(e) =>
                          update(l.key, { qty: Math.max(0, Number(e.target.value) || 0) })
                        }
                        aria-label="Quantité"
                      />
                    </TD>
                    <TD>
                      <Input
                        type="number"
                        min={0}
                        className="w-16 text-right"
                        value={l.freeQty}
                        onChange={(e) =>
                          update(l.key, { freeQty: Math.max(0, Number(e.target.value) || 0) })
                        }
                        aria-label="Unités gratuites"
                      />
                    </TD>
                    <TD>
                      <MoneyInput
                        className="w-32"
                        value={l.unitPriceHt}
                        onValueChange={(v) => update(l.key, { unitPriceHt: v })}
                        aria-label="Prix unitaire HT"
                      />
                    </TD>
                    <TD>
                      <PercentInput
                        className="w-20"
                        value={l.discountBp}
                        onValueChange={(v) => update(l.key, { discountBp: v })}
                        aria-label="Remise"
                      />
                    </TD>
                    <TD>
                      <NativeSelect
                        className="w-24"
                        value={l.tvaRateBp}
                        onChange={(e) => update(l.key, { tvaRateBp: Number(e.target.value) })}
                        aria-label="TVA"
                      >
                        {[
                          ...new Set([
                            l.tvaRateBp,
                            ...(refs.data?.tvaRates.map((t) => t.rateBp) ?? []),
                          ]),
                        ].map((bp) => (
                          <option key={bp} value={bp}>
                            {formatBp(bp)}
                          </option>
                        ))}
                      </NativeSelect>
                    </TD>
                    <TD className="text-right tabular">{fmt.money(priced[i]?.lineTotalHt ?? 0)}</TD>
                    <TD>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Retirer la ligne"
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      >
                        <Trash2 />
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
            {lines.length > 0 && (
              <TFoot>
                <TR>
                  <TD colSpan={8} className="text-right">
                    Total HT
                  </TD>
                  <TD className="text-right tabular">{fmt.money(totals.ht)}</TD>
                  <TD />
                </TR>
                <TR>
                  <TD colSpan={8} className="text-right">
                    TVA
                  </TD>
                  <TD className="text-right tabular">{fmt.money(totals.tva)}</TD>
                  <TD />
                </TR>
                <TR>
                  <TD colSpan={8} className="text-right font-semibold">
                    Total TTC
                  </TD>
                  <TD className="text-right font-semibold tabular">
                    {fmt.money(totals.ht + totals.tva)}
                  </TD>
                  <TD />
                </TR>
              </TFoot>
            )}
          </Table>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Valider la réception ?</DialogTitle>
            <DialogDescription>
              La validation crée {lines.length} lot(s), met à jour le stock et attribue un numéro
              définitif. Elle ne peut ensuite être annulée que par un administrateur, et seulement
              si aucune unité n’est sortie.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-3 gap-3 rounded-md bg-muted p-3">
            <Field label="Source">{SUPPLY_SOURCES[header.sourceType]}</Field>
            <Field label="Fournisseur">
              {suppliers.data?.find((s) => s.id === header.supplierId)?.name ?? '—'}
            </Field>
            <Field label="Total TTC">{fmt.money(totals.ht + totals.tva)}</Field>
          </dl>
          {warnings.length > 0 && (
            <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" /> Avertissements à confirmer
              </div>
              <ul className="list-disc pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>
                    Ligne {w.line} — {w.productName} : {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {can('catalog.manage') && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={updatePrices} onCheckedChange={(v) => setUpdatePrices(!!v)} />
              Mettre à jour le prix d’achat de référence des produits (prix net de cette réception)
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => validate.mutate()} loading={validate.isPending}>
              <CheckCircle2 /> {warnings.length > 0 ? 'Confirmer et valider' : 'Valider'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReceiptView({ receipt }: { receipt: Receipt }) {
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const cancel = useMutation({
    mutationFn: () => api.post(`/receipts/${receipt.id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Réception annulée — tracé au mouchard');
      setCancelOpen(false);
      void qc.invalidateQueries({ queryKey: ['receipts'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const openAttachment = async () => {
    const blob = await api.blob(`/attachments/${receipt.attachmentId}`);
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  };
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Réception {receipt.number}
            {receipt.status === 'CANCELLED' ? (
              <Badge variant="red">ANNULÉE</Badge>
            ) : (
              <Badge variant="green">Validée</Badge>
            )}
          </span>
        }
        description={`${SUPPLY_SOURCES[receipt.sourceType]}${receipt.supplier ? ` — ${receipt.supplier.name}` : ''}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/receipts">
                <ArrowLeft /> Réceptions
              </Link>
            </Button>
            {receipt.attachmentId && (
              <Button variant="outline" onClick={() => void openAttachment()}>
                <FileText /> Facture scannée
              </Button>
            )}
            {receipt.status === 'VALIDATED' && can('receipts.cancel') && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban /> Annuler la réception
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Réf. facture fournisseur">{receipt.supplierInvoiceRef ?? '—'}</Field>
          <Field label="Date facture">
            {receipt.supplierInvoiceDate ? fmt.isoDate(isoDay(receipt.supplierInvoiceDate)) : '—'}
          </Field>
          <Field label="Date de réception">{fmt.isoDate(isoDay(receipt.receivedAt))}</Field>
          <Field label="Saisie par">
            {receipt.createdBy
              ? `${receipt.createdBy.code} — ${fmt.dateTime(receipt.createdAt)}`
              : '—'}
          </Field>
          <Field label="Validée par">
            {receipt.validatedBy
              ? `${receipt.validatedBy.code} — ${fmt.dateTime(receipt.validatedAt)}`
              : '—'}
          </Field>
          <Field label="Total TTC">
            <span className="font-semibold">{fmt.money(receipt.totalTtc)}</span>
          </Field>
          {receipt.status === 'CANCELLED' && (
            <Field label="Annulation" className="sm:col-span-3 lg:col-span-6">
              <span className="text-destructive">
                {receipt.cancelledBy?.code} — {fmt.dateTime(receipt.cancelledAt)} —{' '}
                {receipt.cancelReason}
              </span>
            </Field>
          )}
          {receipt.notes && (
            <Field label="Notes" className="sm:col-span-3 lg:col-span-6">
              {receipt.notes}
            </Field>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH>Lot</TH>
                <TH>Péremption</TH>
                <TH className="text-right">Qté</TH>
                <TH className="text-right">UG</TH>
                <TH className="text-right">Prix HT</TH>
                <TH className="text-right">Remise</TH>
                <TH className="text-right">TVA</TH>
                <TH className="text-right">Total HT</TH>
                <TH>Lot créé</TH>
              </TR>
            </THead>
            <TBody>
              {receipt.lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <Link
                      to={`/products/${l.product.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {l.product.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{l.product.internalCode}</div>
                  </TD>
                  <TD className="font-mono">{l.lotNumber}</TD>
                  <TD className="tabular">{fmt.isoDate(isoDay(l.expiryDate))}</TD>
                  <TD className="text-right tabular">{l.qty}</TD>
                  <TD className="text-right tabular">{l.freeQty || '—'}</TD>
                  <TD className="text-right tabular">{fmt.money(l.unitPriceHt)}</TD>
                  <TD className="text-right tabular">
                    {l.discountBp ? formatBp(l.discountBp) : '—'}
                  </TD>
                  <TD className="text-right tabular">{formatBp(l.tvaRateBp)}</TD>
                  <TD className="text-right tabular">{fmt.money(l.lineTotalHt)}</TD>
                  <TD>{l.lot ? <LotStatusBadge status={l.lot.status} /> : '—'}</TD>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={8} className="text-right">
                  Total HT · TVA · TTC
                </TD>
                <TD colSpan={2} className="text-right tabular">
                  {fmt.money(receipt.totalHt)} · {fmt.money(receipt.totalTva)} ·{' '}
                  <strong>{fmt.money(receipt.totalTtc)}</strong>
                </TD>
              </TR>
            </TFoot>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Annuler la réception {receipt.number} ?</DialogTitle>
            <DialogDescription>
              Possible uniquement si aucune unité des lots créés n’est sortie du stock. Sinon,
              utilisez un retour fournisseur ou un ajustement. Le numéro reste attribué et
              apparaîtra « ANNULÉE ».
            </DialogDescription>
          </DialogHeader>
          <FormField label="Motif" required>
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Retour
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancel.mutate()}
              loading={cancel.isPending}
              disabled={reason.trim().length < 3}
            >
              Annuler la réception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
