import { uniq, type Api } from './api.js';

/** Date ISO (AAAA-MM-JJ) décalée de n mois (approximation suffisante pour des péremptions). */
export function inMonths(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
export const today = () => new Date().toISOString().slice(0, 10);

export interface Refs {
  categoryId: string;
  categoryName: string;
  tva7Id: string;
  laboratoryId: string;
  supplierId: string;
  supplierName: string;
}

/** Référentiels propres au scénario (noms uniques : les scénarios partagent la base). */
export async function createRefs(admin: Api, tag = uniq('R')): Promise<Refs> {
  const category = await admin.post('/catalog/categories', {
    name: `Médicaments ${tag}`,
    kind: 'MEDICINE',
  });
  const laboratory = await admin.post('/catalog/laboratories', { name: `Labo ${tag}` });
  const supplier = await admin.post('/suppliers', {
    name: `Grossiste ${tag}`,
    email: 'commandes@example.com',
    paymentTermsDays: 30,
  });
  const { tvaRates } = await admin.get<{ tvaRates: { id: string; label: string }[] }>(
    '/catalog/references',
  );
  const tva7 = tvaRates.find((r) => r.label === 'TVA 7 %');
  if (!tva7) throw new Error('TVA 7 % introuvable');
  return {
    categoryId: category.id,
    categoryName: category.name,
    tva7Id: tva7.id,
    laboratoryId: laboratory.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
  };
}

export async function createProduct(
  admin: Api,
  refs: Refs,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string; internalCode: string }> {
  return admin.post('/products', {
    name: `Amoxicilline ${uniq('M')} 1 g`,
    dci: 'Amoxicilline',
    dosage: '1 g',
    form: 'Comprimé',
    laboratoryId: refs.laboratoryId,
    categoryId: refs.categoryId,
    tvaRateId: refs.tva7Id,
    refPurchasePriceHt: 1500,
    salePriceTtc: 2350,
    unitsPerPack: 1,
    sellByUnit: false,
    requiresPrescription: false,
    controlledClass: 'NONE',
    coldChain: false,
    returnable: true,
    minStock: 0,
    barcodes: [],
    ...overrides,
  });
}

/** Réception validée (une ligne = un lot). */
export async function receive(
  admin: Api,
  refs: Refs,
  lines: { productId: string; lotNumber: string; expiryDate: string; qty: number }[],
): Promise<void> {
  const draft = await admin.post('/receipts', {
    sourceType: 'SUPPLIER',
    supplierId: refs.supplierId,
    receivedAt: today(),
    supplierInvoiceRef: uniq('FACT'),
    lines: lines.map((l) => ({
      freeQty: 0,
      discountBp: 0,
      tvaRateBp: 700,
      unitPriceHt: 1500,
      ...l,
    })),
  });
  await admin.post(`/receipts/${draft.id}/validate`, { acknowledgeWarnings: true });
}

export async function createClient(
  admin: Api,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  return admin.post('/clients', {
    type: 'INDIVIDUAL',
    name: `Client ${uniq('C')}`,
    phone: '71 000 000',
    ...overrides,
  });
}
