import {
  CONTROLLED_CLASSES,
  formatBp,
  htFromTtc,
  marginBp,
  PRODUCT_FORMS,
  productSchema,
} from '@pharmastock/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField, MoneyInput } from '@/components/form';
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
import { Switch } from '@/components/ui/misc';
import { api, ApiError, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useReferences } from '@/lib/catalog';
import { useFormat } from '@/lib/format';
import type { Product } from '@/lib/types';

type FormState = {
  internalCode: string;
  name: string;
  dci: string;
  dosage: string;
  form: string;
  presentation: string;
  laboratoryId: string;
  categoryId: string;
  therapeuticClassId: string;
  tvaRateId: string;
  refPurchasePriceHt: number | null;
  salePriceTtc: number | null;
  unitsPerPack: number;
  sellByUnit: boolean;
  unitSalePriceTtc: number | null;
  requiresPrescription: boolean;
  controlledClass: 'NONE' | 'A' | 'B' | 'C';
  coldChain: boolean;
  returnable: boolean;
  location: string;
  minStock: number;
  maxStock: string;
  reorderPoint: string;
  barcodes: string[];
  isActive: boolean;
};

function fromProduct(
  p: Product | null,
  defaults: { tvaRateId: string; categoryId: string },
): FormState {
  return {
    internalCode: p?.internalCode ?? '',
    name: p?.name ?? '',
    dci: p?.dci ?? '',
    dosage: p?.dosage ?? '',
    form: p?.form ?? '',
    presentation: p?.presentation ?? '',
    laboratoryId: p?.laboratoryId ?? '',
    categoryId: p?.categoryId ?? defaults.categoryId,
    therapeuticClassId: p?.therapeuticClassId ?? '',
    tvaRateId: p?.tvaRateId ?? defaults.tvaRateId,
    refPurchasePriceHt: p?.refPurchasePriceHt ?? 0,
    salePriceTtc: p?.salePriceTtc ?? null,
    unitsPerPack: p?.unitsPerPack ?? 1,
    sellByUnit: p?.sellByUnit ?? false,
    unitSalePriceTtc: p?.unitSalePriceTtc ?? null,
    requiresPrescription: p?.requiresPrescription ?? false,
    controlledClass: p?.controlledClass ?? 'NONE',
    coldChain: p?.coldChain ?? false,
    returnable: p?.returnable ?? true,
    location: p?.location ?? '',
    minStock: p?.minStock ?? 0,
    maxStock: p?.maxStock?.toString() ?? '',
    reorderPoint: p?.reorderPoint?.toString() ?? '',
    barcodes: p?.barcodes.map((b) => b.barcode) ?? [],
    isActive: p?.isActive ?? true,
  };
}

export function ProductFormDialog({
  product,
  open,
  onClose,
  onSaved,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (p: Product) => void;
}) {
  const refs = useReferences();
  const can = useCan();
  const fmt = useFormat();
  const qc = useQueryClient();
  const defaultTva =
    refs.data?.tvaRates.find((t) => t.isDefault)?.id ?? refs.data?.tvaRates[0]?.id ?? '';
  const defaultCategory = refs.data?.categories.find((c) => c.isActive)?.id ?? '';
  const [f, setF] = React.useState<FormState>(() =>
    fromProduct(product, { tvaRateId: defaultTva, categoryId: defaultCategory }),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [newBarcode, setNewBarcode] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setF(fromProduct(product, { tvaRateId: defaultTva, categoryId: defaultCategory }));
      setErrors({});
      setNewBarcode('');
    }
  }, [open, product, defaultTva, defaultCategory]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const locked = !!product?.hasHistory;
  const tvaBp = refs.data?.tvaRates.find((t) => t.id === f.tvaRateId)?.rateBp ?? 0;
  const saleHt = f.salePriceTtc !== null ? htFromTtc(f.salePriceTtc, tvaBp) : null;
  const margin =
    saleHt !== null && f.refPurchasePriceHt !== null
      ? marginBp(saleHt, f.refPurchasePriceHt)
      : null;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        internalCode: f.internalCode || undefined,
        name: f.name,
        dci: f.dci,
        dosage: f.dosage,
        form: f.form,
        presentation: f.presentation,
        laboratoryId: f.laboratoryId || null,
        categoryId: f.categoryId,
        therapeuticClassId: f.therapeuticClassId || null,
        tvaRateId: f.tvaRateId,
        refPurchasePriceHt: f.refPurchasePriceHt ?? 0,
        salePriceTtc: f.salePriceTtc ?? 0,
        unitsPerPack: f.unitsPerPack,
        sellByUnit: f.sellByUnit,
        unitSalePriceTtc: f.sellByUnit ? f.unitSalePriceTtc : null,
        requiresPrescription: f.requiresPrescription,
        controlledClass: f.controlledClass,
        coldChain: f.coldChain,
        returnable: f.returnable,
        location: f.location,
        minStock: f.minStock,
        maxStock: f.maxStock === '' ? null : Number(f.maxStock),
        reorderPoint: f.reorderPoint === '' ? null : Number(f.reorderPoint),
        barcodes: f.barcodes,
        isActive: f.isActive,
        version: product?.version,
      };
      const parsed = productSchema.safeParse(payload);
      if (!parsed.success) {
        const errs: Record<string, string> = {};
        for (const issue of parsed.error.issues) errs[issue.path.join('.')] ??= issue.message;
        setErrors(errs);
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Certaines informations saisies sont invalides.',
          { fieldErrors: errs },
        );
      }
      return product
        ? api.put<Product>(`/products/${product.id}`, payload)
        : api.post<Product>('/products', payload);
    },
    onSuccess: (p) => {
      toast.success(product ? 'Produit enregistré' : `Produit ${p.internalCode} créé`);
      void qc.invalidateQueries({ queryKey: ['products'] });
      onSaved?.(p);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0)
        setErrors(err.fieldErrors);
      toast.error(errorText(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            {product ? `${product.internalCode} — ${product.name}` : 'Nouveau produit'}
          </DialogTitle>
          <DialogDescription>
            Les champs marqués * sont obligatoires. Les modifications de prix sont historisées.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField
              label="Nom commercial"
              required
              error={errors.name}
              className="sm:col-span-2"
            >
              <Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} />
            </FormField>
            <FormField
              label="Code interne"
              error={errors.internalCode}
              hint={product ? undefined : 'Vide = attribué automatiquement'}
            >
              <Input
                value={f.internalCode}
                onChange={(e) => set('internalCode', e.target.value.toUpperCase())}
              />
            </FormField>
            <FormField label="Catégorie" required error={errors.categoryId}>
              <NativeSelect
                value={f.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              >
                <option value="">Choisir…</option>
                {refs.data?.categories
                  .filter((c) => c.isActive || c.id === f.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
            <FormField
              label="DCI (molécule)"
              error={errors.dci}
              className="sm:col-span-2"
              help="Dénomination commune internationale : le nom de la molécule active (ex. paracétamol). Elle sert à retrouver le produit à la recherche et à proposer des équivalents."
            >
              <Input
                value={f.dci}
                onChange={(e) => set('dci', e.target.value)}
                placeholder="Ex. Paracétamol"
              />
            </FormField>
            <FormField label="Dosage" error={errors.dosage}>
              <Input
                value={f.dosage}
                onChange={(e) => set('dosage', e.target.value)}
                placeholder="500 mg"
              />
            </FormField>
            <FormField label="Forme" error={errors.form}>
              <Input
                list="product-forms"
                value={f.form}
                onChange={(e) => set('form', e.target.value)}
              />
              <datalist id="product-forms">
                {PRODUCT_FORMS.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </FormField>
            <FormField label="Présentation" error={errors.presentation}>
              <Input
                value={f.presentation}
                onChange={(e) => set('presentation', e.target.value)}
                placeholder="Boîte de 30"
              />
            </FormField>
            <FormField label="Laboratoire" error={errors.laboratoryId}>
              <NativeSelect
                value={f.laboratoryId}
                onChange={(e) => set('laboratoryId', e.target.value)}
              >
                <option value="">—</option>
                {refs.data?.laboratories
                  .filter((l) => l.isActive || l.id === f.laboratoryId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
            <FormField label="Famille thérapeutique">
              <NativeSelect
                value={f.therapeuticClassId}
                onChange={(e) => set('therapeuticClassId', e.target.value)}
              >
                <option value="">—</option>
                {refs.data?.therapeuticClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Emplacement" hint="Rayon, étagère, casier">
              <Input value={f.location} onChange={(e) => set('location', e.target.value)} />
            </FormField>
          </section>

          <section className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="TVA" required error={errors.tvaRateId}>
              <NativeSelect value={f.tvaRateId} onChange={(e) => set('tvaRateId', e.target.value)}>
                {refs.data?.tvaRates
                  .filter((t) => t.isActive || t.id === f.tvaRateId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
            {can('catalog.view_costs') && (
              <FormField
                label="Prix d’achat de référence HT"
                error={errors.refPurchasePriceHt}
                help="Prix d’achat hors taxe de référence, utilisé pour estimer la marge à l’écran. Le coût réel de chaque lot est enregistré à la réception."
              >
                <MoneyInput
                  value={f.refPurchasePriceHt}
                  onValueChange={(v) => set('refPurchasePriceHt', v)}
                />
              </FormField>
            )}
            <FormField
              label="Prix de vente TTC (boîte)"
              help="Prix affiché en caisse pour une boîte, toutes taxes comprises. Le prix hors taxe est calculé d’après la TVA choisie."
              required
              error={errors.salePriceTtc}
              hint={saleHt !== null ? `HT : ${fmt.money(saleHt)}` : undefined}
            >
              <MoneyInput value={f.salePriceTtc} onValueChange={(v) => set('salePriceTtc', v)} />
            </FormField>
            {can('catalog.view_costs') && (
              <div className="flex flex-col justify-end gap-1 pb-1 text-sm">
                <span className="text-xs text-muted-foreground">Marge calculée</span>
                <span
                  className={
                    margin !== null && margin < 0 ? 'font-medium text-destructive' : 'font-medium'
                  }
                >
                  {margin === null
                    ? '—'
                    : `${formatBp(margin)} (${fmt.money((saleHt ?? 0) - (f.refPurchasePriceHt ?? 0))})`}
                </span>
              </div>
            )}
            <FormField
              label="Unités par boîte"
              help="Nombre d’unités (comprimés, ampoules…) dans une boîte. Nécessaire pour la vente à l’unité. Non modifiable dès que le produit a du stock."
              error={errors.unitsPerPack}
              hint={locked ? 'Non modifiable : le produit a du stock' : undefined}
            >
              <Input
                type="number"
                min={1}
                disabled={locked}
                value={f.unitsPerPack}
                onChange={(e) => set('unitsPerPack', Math.max(1, Number(e.target.value) || 1))}
              />
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch
                disabled={locked}
                checked={f.sellByUnit}
                onCheckedChange={(v) => set('sellByUnit', v)}
              />
              Vente à l’unité (déconditionnement)
            </label>
            {f.sellByUnit && (
              <FormField label="Prix unitaire TTC" required error={errors.unitSalePriceTtc}>
                <MoneyInput
                  value={f.unitSalePriceTtc}
                  onValueChange={(v) => set('unitSalePriceTtc', v)}
                />
              </FormField>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={f.requiresPrescription}
                onCheckedChange={(v) => set('requiresPrescription', v)}
              />{' '}
              Ordonnance obligatoire
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.coldChain} onCheckedChange={(v) => set('coldChain', v)} /> Chaîne
              du froid (2–8 °C)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.returnable} onCheckedChange={(v) => set('returnable', v)} /> Retour
              client autorisé
            </label>
            <FormField
              label="Classement (produit à tableau)"
              help="Classement réglementaire des substances vénéneuses (tableaux A, B, C). La vente d’un produit classé demande l’ordonnance et alimente le registre des produits à tableau."
            >
              <NativeSelect
                value={f.controlledClass}
                onChange={(e) =>
                  set('controlledClass', e.target.value as FormState['controlledClass'])
                }
              >
                {Object.entries(CONTROLLED_CLASSES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label="Stock minimum (alerte)"
              error={errors.minStock}
              help="En dessous de ce nombre d’unités, le produit passe en « bas » et une alerte est émise. Le réapprovisionnement l’utilise aussi pour calculer le seuil de commande."
            >
              <Input
                type="number"
                min={0}
                value={f.minStock}
                onChange={(e) => set('minStock', Math.max(0, Number(e.target.value) || 0))}
              />
            </FormField>
            <FormField
              label="Stock maximum"
              error={errors.maxStock}
              help="Niveau visé après une commande : le réapprovisionnement propose de commander jusqu’à ce stock. Laissé vide, il est calculé d’après les ventes récentes."
            >
              <Input
                type="number"
                min={0}
                value={f.maxStock}
                onChange={(e) => set('maxStock', e.target.value)}
              />
            </FormField>
            <FormField label="Point de commande">
              <Input
                type="number"
                min={0}
                value={f.reorderPoint}
                onChange={(e) => set('reorderPoint', e.target.value)}
              />
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} /> Actif
              (décocher = archiver)
            </label>
          </section>

          <FormField
            label="Codes-barres"
            error={errors.barcodes}
            hint="Scannez ou saisissez un code puis Entrée. Le premier est le code principal."
          >
            <div className="flex flex-wrap items-center gap-2">
              {f.barcodes.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 font-mono text-xs"
                >
                  {b}
                  <button
                    type="button"
                    aria-label={`Retirer ${b}`}
                    className="cursor-pointer"
                    onClick={() =>
                      set(
                        'barcodes',
                        f.barcodes.filter((x) => x !== b),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <Input
                className="w-52 font-mono"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newBarcode && !f.barcodes.includes(newBarcode))
                      set('barcodes', [...f.barcodes, newBarcode]);
                    setNewBarcode('');
                  }
                }}
                placeholder="EAN-13…"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!newBarcode}
                onClick={() => {
                  if (!f.barcodes.includes(newBarcode))
                    set('barcodes', [...f.barcodes, newBarcode]);
                  setNewBarcode('');
                }}
              >
                <Plus /> Ajouter
              </Button>
            </div>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" loading={save.isPending}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
