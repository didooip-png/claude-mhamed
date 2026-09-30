import {
  applyBp,
  assertInteger,
  BP_BASE,
  htFromTtc,
  MoneyError,
  mulDivRound,
  sum,
  type Millimes,
} from './money.js';

// ---------------------------------------------------------------------------
// Lignes de vente (prix saisis TTC)
// ---------------------------------------------------------------------------

export interface SaleLinePricingInput {
  /** Quantité dans l'unité de vente (boîte ou unité). */
  qty: number;
  /** Prix unitaire TTC dans l'unité de vente, en millimes. */
  unitPriceTtc: Millimes;
  /** Remise de la ligne en points de base (0–10 000). */
  discountBp: number;
  /** Taux de TVA en points de base. */
  tvaBp: number;
}

export interface SaleLinePricing {
  grossTtc: Millimes;
  discountAmount: Millimes;
  lineTotalTtc: Millimes;
}

export function priceSaleLine(line: SaleLinePricingInput): SaleLinePricing {
  assertInteger(line.qty, 'quantité');
  if (line.qty <= 0) throw new MoneyError('Quantité invalide');
  if (line.discountBp < 0 || line.discountBp > BP_BASE) throw new MoneyError('Remise invalide');
  const grossTtc = line.qty * line.unitPriceTtc;
  assertInteger(grossTtc, 'montant de ligne');
  const discountAmount = applyBp(grossTtc, line.discountBp);
  return { grossTtc, discountAmount, lineTotalTtc: grossTtc - discountAmount };
}

export interface TaxBreakdownRow {
  tvaBp: number;
  totalTtc: Millimes;
  totalHt: Millimes;
  totalTva: Millimes;
}

export interface SaleTotals {
  lines: SaleLinePricing[];
  taxes: TaxBreakdownRow[];
  subtotalHt: Millimes;
  totalTva: Millimes;
  totalDiscount: Millimes;
  stampDuty: Millimes;
  /** Total TTC des lignes + timbre fiscal. */
  totalTtc: Millimes;
}

/**
 * Calcule les totaux d'une vente. Le HT et la TVA sont calculés par taux sur le cumul TTC
 * (et non ligne par ligne) pour limiter les écarts d'arrondi sur la facture.
 */
export function computeSaleTotals(
  lines: readonly SaleLinePricingInput[],
  stampDuty: Millimes = 0,
): SaleTotals {
  assertInteger(stampDuty, 'timbre fiscal');
  const priced = lines.map(priceSaleLine);
  const byRate = new Map<number, Millimes>();
  lines.forEach((line, i) => {
    byRate.set(line.tvaBp, (byRate.get(line.tvaBp) ?? 0) + priced[i]!.lineTotalTtc);
  });
  const taxes: TaxBreakdownRow[] = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tvaBp, totalTtc]) => {
      const totalHt = htFromTtc(totalTtc, tvaBp);
      return { tvaBp, totalTtc, totalHt, totalTva: totalTtc - totalHt };
    });
  const linesTtc = sum(priced.map((p) => p.lineTotalTtc));
  return {
    lines: priced,
    taxes,
    subtotalHt: sum(taxes.map((t) => t.totalHt)),
    totalTva: sum(taxes.map((t) => t.totalTva)),
    totalDiscount: sum(priced.map((p) => p.discountAmount)),
    stampDuty,
    totalTtc: linesTtc + stampDuty,
  };
}

// ---------------------------------------------------------------------------
// Lignes de réception (prix d'achat saisis HT)
// ---------------------------------------------------------------------------

export interface ReceiptLinePricingInput {
  qty: number;
  freeQty: number;
  unitPriceHt: Millimes;
  discountBp: number;
  tvaBp: number;
}

export interface ReceiptLinePricing {
  lineTotalHt: Millimes;
  lineTva: Millimes;
  lineTotalTtc: Millimes;
  /** Coût unitaire du lot : (quantité × prix net HT) / (quantité + UG) — RG-08. */
  unitCostHt: Millimes;
}

export function priceReceiptLine(line: ReceiptLinePricingInput): ReceiptLinePricing {
  assertInteger(line.qty, 'quantité');
  assertInteger(line.freeQty, 'unités gratuites');
  if (line.qty < 0 || line.freeQty < 0 || line.qty + line.freeQty <= 0) {
    throw new MoneyError('Quantités invalides');
  }
  if (line.discountBp < 0 || line.discountBp > BP_BASE) throw new MoneyError('Remise invalide');
  const lineTotalHt = mulDivRound(line.qty * line.unitPriceHt, BP_BASE - line.discountBp, BP_BASE);
  const lineTva = applyBp(lineTotalHt, line.tvaBp);
  const unitCostHt = mulDivRound(lineTotalHt, 1, line.qty + line.freeQty);
  return { lineTotalHt, lineTva, lineTotalTtc: lineTotalHt + lineTva, unitCostHt };
}

/** Taux de marge (en bp) = (prix HT − coût) / prix HT. */
export function marginBp(saleHt: Millimes, cost: Millimes): number | null {
  if (saleHt <= 0) return null;
  return mulDivRound(saleHt - cost, BP_BASE, saleHt);
}
