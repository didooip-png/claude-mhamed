import { describe, expect, it } from 'vitest';
import { computeSaleTotals, priceReceiptLine, priceSaleLine } from '../src/pricing.js';

describe('priceSaleLine', () => {
  it('applique la remise en points de base', () => {
    expect(priceSaleLine({ qty: 3, unitPriceTtc: 4_500, discountBp: 1000, tvaBp: 700 })).toEqual({
      grossTtc: 13_500,
      discountAmount: 1_350,
      lineTotalTtc: 12_150,
    });
  });
  it('refuse quantité et remise invalides', () => {
    expect(() => priceSaleLine({ qty: 0, unitPriceTtc: 1, discountBp: 0, tvaBp: 0 })).toThrow();
    expect(() => priceSaleLine({ qty: 1, unitPriceTtc: 1, discountBp: 10001, tvaBp: 0 })).toThrow();
  });
});

describe('computeSaleTotals', () => {
  it('ventile HT/TVA par taux et ajoute le timbre', () => {
    const totals = computeSaleTotals(
      [
        { qty: 2, unitPriceTtc: 5_350, discountBp: 0, tvaBp: 700 }, // 10,700 TTC à 7 %
        { qty: 1, unitPriceTtc: 11_900, discountBp: 0, tvaBp: 1900 }, // 11,900 TTC à 19 %
        { qty: 1, unitPriceTtc: 1_070, discountBp: 0, tvaBp: 700 },
      ],
      1_000,
    );
    expect(totals.taxes).toEqual([
      { tvaBp: 700, totalTtc: 11_770, totalHt: 11_000, totalTva: 770 },
      { tvaBp: 1900, totalTtc: 11_900, totalHt: 10_000, totalTva: 1_900 },
    ]);
    expect(totals.subtotalHt).toBe(21_000);
    expect(totals.totalTva).toBe(2_670);
    expect(totals.stampDuty).toBe(1_000);
    expect(totals.totalTtc).toBe(24_670);
    expect(totals.subtotalHt + totals.totalTva + totals.stampDuty).toBe(totals.totalTtc);
  });
});

describe('priceReceiptLine', () => {
  it('calcule le total HT net, la TVA et le coût unitaire avec UG', () => {
    expect(priceReceiptLine({ qty: 10, freeQty: 2, unitPriceHt: 3_000, discountBp: 0, tvaBp: 700 })).toEqual({
      lineTotalHt: 30_000,
      lineTva: 2_100,
      lineTotalTtc: 32_100,
      unitCostHt: 2_500,
    });
    const withDiscount = priceReceiptLine({ qty: 10, freeQty: 0, unitPriceHt: 3_000, discountBp: 1000, tvaBp: 0 });
    expect(withDiscount.lineTotalHt).toBe(27_000);
    expect(withDiscount.unitCostHt).toBe(2_700);
  });
});
