import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  amountInWords,
  applyBp,
  formatMoney,
  htFromTtc,
  lotUnitCost,
  mulDivRound,
  numberToFrenchWords,
  parseMoney,
  parsePercentToBp,
  ttcFromHt,
} from '../src/money.js';

describe('mulDivRound (arrondi half up symétrique)', () => {
  it('arrondit au plus proche, 0,5 vers le haut', () => {
    expect(mulDivRound(5, 1, 2)).toBe(3); // 2,5 → 3
    expect(mulDivRound(7, 1, 2)).toBe(4); // 3,5 → 4
    expect(mulDivRound(4, 1, 3)).toBe(1); // 1,33 → 1
    expect(mulDivRound(5, 1, 3)).toBe(2); // 1,67 → 2
  });
  it('est symétrique pour les négatifs', () => {
    expect(mulDivRound(-5, 1, 2)).toBe(-3);
    expect(mulDivRound(5, -1, 2)).toBe(-3);
    expect(mulDivRound(-4, 1, 3)).toBe(-1);
  });
  it('ne perd pas de précision sur de grands nombres', () => {
    expect(mulDivRound(9_000_000_000_000, 3, 3)).toBe(9_000_000_000_000);
  });
  it('refuse les non-entiers et la division par zéro', () => {
    expect(() => mulDivRound(1.5, 1, 1)).toThrow();
    expect(() => mulDivRound(1, 1, 0)).toThrow();
  });
});

describe('TVA', () => {
  it('calcule HT depuis TTC au millime', () => {
    expect(htFromTtc(10_700, 700)).toBe(10_000);
    expect(htFromTtc(1_000, 1900)).toBe(840); // 840,336 → 840
    expect(ttcFromHt(10_000, 1900)).toBe(11_900);
  });
  it('applique un pourcentage en points de base', () => {
    expect(applyBp(12_345, 500)).toBe(617); // 617,25 → 617
    expect(applyBp(12_350, 500)).toBe(618); // 617,5 → 618
  });
});

describe('coût unitaire de lot avec unités gratuites (RG-08)', () => {
  it('répartit le coût sur quantité + UG', () => {
    // 10 boîtes à 3,000 DT + 2 UG → 30,000 / 12 = 2,500 DT
    expect(lotUnitCost(10, 3000, 2)).toBe(2500);
    expect(lotUnitCost(3, 1000, 0)).toBe(1000);
    expect(lotUnitCost(3, 1000, 1)).toBe(750);
    expect(lotUnitCost(7, 1000, 2)).toBe(778); // 777,78 → 778
  });
});

describe('allocateProportionally', () => {
  it('conserve exactement le total', () => {
    const parts = allocateProportionally(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });
  it('gère les totaux négatifs et les poids nuls', () => {
    expect(allocateProportionally(-10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(-10);
    expect(allocateProportionally(10, [0, 0])).toEqual([10, 0]);
  });
});

describe('formatage et saisie', () => {
  it('formate 1 234,567 DT', () => {
    expect(formatMoney(1_234_567)).toBe('1 234,567 DT');
    expect(formatMoney(-500)).toBe('−0,500 DT');
    expect(formatMoney(5, { currency: '' })).toBe('0,005');
    expect(formatMoney(1_234_567, { decimals: 2, currency: '' })).toBe('1 234,57');
  });
  it('lit les saisies utilisateur', () => {
    expect(parseMoney('1 234,5')).toBe(1_234_500);
    expect(parseMoney('12.345')).toBe(12_345);
    expect(parseMoney('7')).toBe(7_000);
    expect(parseMoney('1,2345')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parsePercentToBp('12,5')).toBe(1250);
    expect(parsePercentToBp('5')).toBe(500);
  });
});

describe('montant en toutes lettres', () => {
  it('écrit les nombres en français', () => {
    expect(numberToFrenchWords(0)).toBe('zéro');
    expect(numberToFrenchWords(21)).toBe('vingt et un');
    expect(numberToFrenchWords(71)).toBe('soixante et onze');
    expect(numberToFrenchWords(80)).toBe('quatre-vingts');
    expect(numberToFrenchWords(81)).toBe('quatre-vingt-un');
    expect(numberToFrenchWords(99)).toBe('quatre-vingt-dix-neuf');
    expect(numberToFrenchWords(200)).toBe('deux cents');
    expect(numberToFrenchWords(201)).toBe('deux cent un');
    expect(numberToFrenchWords(1000)).toBe('mille');
    expect(numberToFrenchWords(80_000)).toBe('quatre-vingt mille');
    expect(numberToFrenchWords(200_000)).toBe('deux cent mille');
    expect(numberToFrenchWords(1_234)).toBe('mille deux cent trente-quatre');
    expect(numberToFrenchWords(2_000_000)).toBe('deux millions');
  });
  it('écrit un montant en dinars et millimes', () => {
    expect(amountInWords(1_234_567)).toBe(
      'Mille deux cent trente-quatre dinars et cinq cent soixante-sept millimes',
    );
    expect(amountInWords(1_000)).toBe('Un dinar');
    expect(amountInWords(500)).toBe('Zéro dinar et cinq cents millimes');
  });
});
