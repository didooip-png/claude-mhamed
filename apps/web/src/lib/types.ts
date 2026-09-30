/** Types des réponses de l'API utilisés par l'interface. */

export interface StockSummary {
  total: number;
  sellable: number;
  unavailable: number;
  lotCount: number;
  nextExpiry: string | null;
  valueCost: number;
  status: 'OK' | 'LOW' | 'OUT';
}

export interface Product {
  id: string;
  internalCode: string;
  name: string;
  dci: string | null;
  dosage: string | null;
  form: string | null;
  presentation: string | null;
  laboratoryId: string | null;
  categoryId: string;
  therapeuticClassId: string | null;
  tvaRateId: string;
  refPurchasePriceHt?: number;
  salePriceTtc: number;
  unitsPerPack: number;
  sellByUnit: boolean;
  unitSalePriceTtc: number | null;
  requiresPrescription: boolean;
  controlledClass: 'NONE' | 'A' | 'B' | 'C';
  coldChain: boolean;
  returnable: boolean;
  location: string | null;
  minStock: number;
  maxStock: number | null;
  reorderPoint: number | null;
  isActive: boolean;
  version: number;
  updatedAt: string;
  barcodes: { id: string; barcode: string; isPrimary: boolean }[];
  laboratory: { id: string; name: string } | null;
  category: { id: string; name: string; kind: string };
  therapeuticClass: { id: string; name: string } | null;
  tvaRate: { id: string; label: string; rateBp: number };
  stock: StockSummary;
  hasHistory?: boolean;
}

export interface References {
  categories: {
    id: string;
    name: string;
    kind: string;
    isActive: boolean;
    _count: { products: number };
  }[];
  laboratories: {
    id: string;
    name: string;
    country: string | null;
    isActive: boolean;
    _count: { products: number };
  }[];
  therapeuticClasses: { id: string; name: string; _count: { products: number } }[];
  tvaRates: {
    id: string;
    label: string;
    rateBp: number;
    isActive: boolean;
    isDefault: boolean;
    _count: { products: number };
  }[];
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTermsDays: number;
  leadTimeDays: number | null;
  isActive: boolean;
  notes: string | null;
  version: number;
}

export interface Client {
  id: string;
  code: string;
  type: string;
  name: string;
  nationalIdOrTaxId: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  creditLimit: number;
  defaultDiscountBp: number;
  paymentTermsDays: number;
  isActive: boolean;
  isWalkIn: boolean;
  notes: string | null;
  balance: number;
  emailConsent: boolean;
  emailConsentAt: string | null;
  emailDocPrefs: Record<string, boolean>;
  emailCc: string[];
  emailBounced: boolean;
  version: number;
  createdAt: string;
}

export type ExpiryLevel = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK';

export interface LotRow {
  id: string;
  lotNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  level: ExpiryLevel;
  receivedAt: string;
  initialQty: number;
  remainingQty: number;
  unitCostHt: number | null;
  valueCost: number | null;
  status: 'ACTIVE' | 'BLOCKED' | 'QUARANTINE' | 'EXHAUSTED';
  blockReason: string | null;
  sourceType: string;
  supplierName: string | null;
  product: {
    id: string;
    internalCode: string;
    name: string;
    dosage: string | null;
    unitsPerPack: number;
    sellByUnit: boolean;
  };
}
