import type { PaymentMethod } from '@pharmastock/shared';
import type { UserRef } from '@/pages/sales/sale-types';

export interface ReturnRow {
  id: string;
  number: string;
  createdAt: string;
  sale: { id: string; number: string | null } | null;
  client: { id: string; code: string; name: string };
  totalTtc: number;
  refundMode: 'CREDIT' | 'CASH';
  reason: string;
  lineCount: number;
  creditNote: { id: string; number: string; amount: number; remainingAmount: number } | null;
  createdBy: UserRef | null;
  authorizedBy: UserRef | null;
}

export interface ReturnDetail {
  id: string;
  number: string;
  createdAt: string;
  sale: { id: string; number: string | null } | null;
  client: { id: string; code: string; name: string; isWalkIn: boolean };
  totalTtc: number;
  refundMode: 'CREDIT' | 'CASH';
  reason: string;
  createdBy: UserRef | null;
  authorizedBy: UserRef | null;
  creditNote: {
    id: string;
    number: string;
    amount: number;
    remainingAmount: number;
    appliedTo: { saleId: string; saleNumber: string | null; amount: number }[];
  } | null;
  lines: {
    id: string;
    product: {
      id: string;
      internalCode: string;
      name: string;
      dosage: string | null;
      unitsPerPack: number;
      sellByUnit: boolean;
    } | null;
    lot: { id: string; lotNumber: string; expiryDate: string; status: string } | null;
    qtyBase: number;
    amount: number;
    resellable: boolean;
    destination: 'RESTOCK' | 'QUARANTINE' | 'DESTRUCTION';
  }[];
}

export interface Returnable {
  sale: {
    id: string;
    number: string;
    status: string;
    validatedAt: string;
    totalTtc: number;
    amountPaid: number;
    amountDue: number;
    returnStatus: string;
    client: { id: string; code: string; name: string; isWalkIn: boolean } | null;
  };
  rules: {
    daysSinceSale: number;
    maxDays: number;
    late: boolean;
    requireAdminCode: boolean;
    canCashRefund: boolean;
    walkIn: boolean;
  };
  lines: {
    id: string;
    product: {
      id: string;
      internalCode: string;
      name: string;
      dosage: string | null;
      unitsPerPack: number;
      sellByUnit: boolean;
    };
    unit: 'PACK' | 'UNIT';
    qtyBase: number;
    returnedQtyBase: number;
    returnableQtyBase: number;
    lineTotalTtc: number;
    notReturnable: string | null;
    lots: {
      lotId: string;
      allocationId: string;
      lotNumber: string;
      expiryDate: string;
      expired: boolean;
      status: string;
      qtyBase: number;
      returnedQtyBase: number;
      returnableQtyBase: number;
    }[];
  }[];
}

export interface PaymentRow {
  id: string;
  number: string;
  paidAt: string;
  client: { id: string; code: string; name: string };
  method: PaymentMethod;
  amount: number;
  refundedAmount: number;
  allocated: number;
  unallocated: number;
  status: 'VALID' | 'CANCELLED' | 'BOUNCED';
  chequeNumber: string | null;
  bank: string | null;
  dueDate: string | null;
  chequeStatus: 'IN_PORTFOLIO' | 'DEPOSITED' | 'CASHED' | 'BOUNCED' | null;
  reference: string | null;
  saleId: string | null;
  createdBy: UserRef | null;
}

export interface PaymentDetail extends Omit<PaymentRow, 'client'> {
  client: { id: string; code: string; name: string; isWalkIn: boolean };
  notes: string | null;
  cashSession: { id: string; number: string } | null;
  printCount: number;
  cancelledBy: UserRef | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  allocations: {
    id: string;
    sale: { id: string; number: string | null; validatedAt: string; totalTtc: number };
    amount: number;
    createdAt: string;
    createdBy: UserRef | null;
    cancelledAt: string | null;
  }[];
}

export interface OpenInvoice {
  id: string;
  number: string;
  validatedAt: string;
  dueDate: string | null;
  totalTtc: number;
  amountDue: number;
  ageDays: number;
  overdueDays: number;
}

export interface CreditSource {
  kind: 'CREDIT_NOTE' | 'PAYMENT';
  id: string;
  number: string;
  available: number;
  date: string;
}

export interface AccountView {
  balance: number;
  availableCredit: number;
  creditLimit: number;
  creditRemaining: number;
  overdueCount: number;
  overdueAmount: number;
  openInvoicesAmount: number;
  creditSources: CreditSource[];
}

export interface LedgerEntry {
  id: number;
  createdAt: string;
  entryType: string;
  debit: number;
  credit: number;
  balanceAfter: number;
  documentType: string;
  documentId: string;
  documentNumber: string | null;
  description: string | null;
  user: string | null;
}
