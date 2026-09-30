import type { AdjustmentType } from '@pharmastock/shared';

export interface ProductLite {
  id: string;
  internalCode: string;
  name: string;
  dosage: string | null;
  form?: string | null;
  unitsPerPack: number;
  sellByUnit: boolean;
  location?: string | null;
}

export interface UserLite {
  id: string;
  code: string;
  fullName: string;
}

export interface InventoryRow {
  id: string;
  number: string;
  scopeLabel: string;
  status: 'COUNTING' | 'VALIDATED' | 'CANCELLED';
  startedAt: string;
  startedBy: UserLite | null;
  validatedAt: string | null;
  validatedBy: UserLite | null;
  lineCount: number;
  countedCount: number;
}

export interface InventoryDetail {
  id: string;
  number: string;
  scopeLabel: string;
  status: InventoryRow['status'];
  notes: string | null;
  startedAt: string;
  startedBy: UserLite | null;
  validatedAt: string | null;
  validatedBy: UserLite | null;
  cancelledAt: string | null;
  cancelledBy: UserLite | null;
  stats: {
    lines: number;
    counted: number;
    uncounted: number;
    differences: number | null;
    unitsPlus: number | null;
    unitsMinus: number | null;
    valueDifference: number | null;
  };
}

export interface InventoryLine {
  id: string;
  product: ProductLite | null;
  lot: { id: string; lotNumber: string; expiryDate: string; status: string } | null;
  countedQty: number | null;
  countedBy: UserLite | null;
  countedAt: string | null;
  countCount: number;
  snapshotQty: number | null;
  theoreticalAtCount: number | null;
  difference: number | null;
  unitCostHt: number | null;
}

export interface AdjustmentRow {
  id: string;
  number: string | null;
  type: AdjustmentType;
  status: 'PENDING' | 'VALIDATED' | 'REJECTED';
  reason: string;
  lineCount: number;
  createdAt: string;
  createdBy: UserLite | null;
  validatedAt: string | null;
  validatedBy: UserLite | null;
}

export interface AdjustmentDetail extends Omit<AdjustmentRow, 'lineCount'> {
  rejectedReason: string | null;
  lines: {
    id: string;
    qty: number;
    product: ProductLite | null;
    lot: {
      id: string;
      lotNumber: string;
      expiryDate: string;
      remainingQty: number;
      status: string;
    } | null;
    unitCostHt: number | null;
    valueAtCost: number | null;
  }[];
  totalValueAtCost: number | null;
}

export interface SupplierRef {
  id: string;
  code: string;
  name: string;
}

export interface SupplierReturnRow {
  id: string;
  number: string;
  status: 'PENDING_CREDIT' | 'CREDIT_RECEIVED' | 'CANCELLED';
  supplier: SupplierRef;
  reason: string;
  totalHt: number;
  creditAmount: number | null;
  creditReference: string | null;
  lineCount: number;
  createdAt: string;
  createdBy: UserLite | null;
}

export interface SupplierReturnDetail {
  id: string;
  number: string;
  status: SupplierReturnRow['status'];
  supplier: SupplierRef & { phone: string | null; email: string | null };
  reason: string;
  notes: string | null;
  totalHt: number;
  creditAmount: number | null;
  creditReceivedAt: string | null;
  creditReference: string | null;
  createdAt: string;
  createdBy: UserLite | null;
  lines: {
    id: string;
    qty: number;
    unitCostHt: number;
    amountHt: number;
    reason: string;
    product: ProductLite | null;
    lot: { id: string; lotNumber: string; expiryDate: string } | null;
  }[];
}

export interface RecallReport {
  lotNumber: string;
  lots: {
    id: string;
    lotNumber: string;
    product: ProductLite;
    supplier: SupplierRef | null;
    status: 'ACTIVE' | 'BLOCKED' | 'QUARANTINE' | 'EXHAUSTED';
    blockReason: string | null;
    expiryDate: string;
    initialQty: number;
    remainingQty: number;
    soldQty: number;
    unitCostHt: number;
  }[];
  customers: {
    clientId: string;
    code: string;
    name: string;
    phone: string | null;
    email: string | null;
    isWalkIn: boolean;
    qty: number;
    sales: { id: string; number: string | null; date: string | null; qty: number }[];
  }[];
}

export interface ReorderItem extends ProductLite {
  productId: string;
  sellable: number;
  minStock: number;
  maxStock: number | null;
  avgDaily: number;
  leadDays: number;
  daysOfStock: number | null;
  suggestedQty: number;
  supplier: SupplierRef | null;
  lastUnitCostHt: number | null;
  estimatedCostHt: number | null;
}
