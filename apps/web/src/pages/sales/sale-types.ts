import type { PaymentMethod } from '@pharmastock/shared';

export interface UserRef {
  id: string;
  code: string;
  fullName: string;
}

export interface ClientAccount {
  balance: number;
  availableCredit: number;
  creditLimit: number;
  creditRemaining: number;
  overdueCount: number;
  overdueAmount: number;
  openInvoicesAmount: number;
}

export interface SaleClient {
  id: string;
  code: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  emailConsent: boolean;
  emailDocPrefs: Record<string, boolean> | null;
  isWalkIn: boolean;
  defaultDiscountBp: number;
  account: ClientAccount;
}

export interface SaleLineLot {
  lotId: string;
  lotNumber: string;
  expiryDate: string;
  qty: number;
  returnedQty?: number;
  unitCostHt?: number | null;
}

export interface SaleLineView {
  id: string;
  lineNo: number;
  qty: number;
  unit: 'PACK' | 'UNIT';
  qtyBase: number;
  catalogPriceTtc: number;
  unitPriceTtc: number;
  discountBp: number;
  discountAmount: number;
  lineTotalTtc: number;
  tvaRateBp: number;
  forcedLotId: string | null;
  returnedQtyBase: number;
  costTotal: number | null;
  authorized: { discount: boolean; price: boolean; lot: boolean };
  product: {
    id: string;
    internalCode: string;
    name: string;
    dosage: string | null;
    form: string | null;
    unitsPerPack: number;
    sellByUnit: boolean;
    salePriceTtc: number;
    unitSalePriceTtc: number | null;
    requiresPrescription: boolean;
    controlledClass: 'NONE' | 'A' | 'B' | 'C';
    coldChain: boolean;
    returnable: boolean;
    sellable: number | null;
    nextExpiry: string | null;
  };
  lots: SaleLineLot[];
  stockIssue: {
    productId: string;
    requested: number;
    sellable: number;
    blocked: number;
    expired: number;
  } | null;
}

export interface SaleTotals {
  subtotalHt: number;
  totalTva: number;
  totalDiscount: number;
  stampDuty: number;
  totalTtc: number;
  taxes: { tvaBp: number; totalHt: number; totalTva: number; totalTtc: number }[];
}

export interface SalePayment {
  kind: 'PAYMENT' | 'CREDIT_NOTE';
  id: string;
  number: string;
  method: PaymentMethod;
  amount: number;
  paidAt: string;
  chequeNumber?: string | null;
  bank?: string | null;
  reference?: string | null;
  /** Affectation annulée (vente annulée ou modifiée : règlement remboursé ou converti en crédit). */
  cancelledAt: string | null;
}

export type SaleStatus = 'DRAFT' | 'ON_HOLD' | 'VALIDATED' | 'CANCELLED' | 'DISCARDED';

export interface SaleView {
  id: string;
  number: string | null;
  status: SaleStatus;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  returnStatus: 'NONE' | 'PARTIALLY_RETURNED' | 'RETURNED';
  createdAt: string;
  validatedAt: string | null;
  heldAt: string | null;
  dueDate: string | null;
  deviceId: string | null;
  client: SaleClient | null;
  lines: SaleLineView[];
  totals: SaleTotals;
  globalDiscountBp: number;
  prescription: {
    required: boolean;
    prescriberName: string | null;
    prescriptionRef: string | null;
    prescriptionDate: string | null;
  };
  amountPaid: number;
  amountDue: number;
  returnedAmount: number;
  cashTendered: number | null;
  changeGiven: number | null;
  totalCost: number | null;
  payments: SalePayment[];
  createdBy: UserRef | null;
  validatedBy: UserRef | null;
  cancelledBy: UserRef | null;
  cancelAuthorizedBy: UserRef | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  creditAuthorizedBy: UserRef | null;
  replaces: { id: string; number: string | null } | null;
  replacedBy: { id: string; number: string | null } | null;
  printCount: number;
}

export interface ClientSearchResult {
  id: string;
  code: string;
  name: string;
  type: string;
  phone: string | null;
  nationalIdOrTaxId: string | null;
  email: string | null;
  balance: number;
  creditLimit: number;
}

export interface OnHoldSale {
  id: string;
  heldAt: string;
  heldBy: string | null;
  client: { id: string; name: string; code: string } | null;
  lineCount: number;
  estimatedTotal: number;
}

export const PAYMENT_STATUS_LABELS = {
  UNPAID: 'Non payée',
  PARTIALLY_PAID: 'Partiellement payée',
  PAID: 'Payée',
} as const;
