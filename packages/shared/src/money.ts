/**
 * Module `money` — unique point de passage pour tous les calculs monétaires.
 *
 * Règles (cahier des charges §3.1) :
 * - les montants sont des ENTIERS exprimés en millimes (1 DT = 1000 millimes) ;
 * - jamais de nombres flottants pour stocker ou cumuler un montant ;
 * - toute division / tout arrondi passe par `mulDivRound` (arrondi au millime, « half up »).
 *
 * « Half up » est appliqué de façon symétrique : 0,5 millime s'arrondit en s'éloignant de zéro
 * (2,5 → 3 ; −2,5 → −3). C'est l'arrondi commercial usuel ; il garantit qu'une annulation
 * produit exactement l'opposé du montant initial.
 */

export type Millimes = number;

export const MILLIMES_PER_UNIT = 1000;
/** Base des pourcentages exprimés en points de base : 10 000 bp = 100 %. */
export const BP_BASE = 10_000;

export class MoneyError extends Error {}

export function assertInteger(value: number, label = 'montant'): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} invalide : ${value} (entier attendu)`);
  }
}

/** Calcule round(a × b / c) avec un arrondi « half up » symétrique, sans perte de précision. */
export function mulDivRound(a: number, b: number, c: number): number {
  assertInteger(a, 'a');
  assertInteger(b, 'b');
  assertInteger(c, 'c');
  if (c === 0) throw new MoneyError('Division par zéro');
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const q = absNum / absDen;
  const r = absNum % absDen;
  const rounded = r * 2n >= absDen ? q + 1n : q;
  const result = negative ? -rounded : rounded;
  const asNumber = Number(result);
  assertInteger(asNumber, 'résultat');
  return asNumber;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertInteger(v);
    total += v;
  }
  assertInteger(total, 'total');
  return total;
}

/** Montant × pourcentage (en points de base), arrondi au millime. */
export function applyBp(amount: Millimes, bp: number): Millimes {
  return mulDivRound(amount, bp, BP_BASE);
}

/** HT à partir d'un TTC et d'un taux de TVA en points de base. */
export function htFromTtc(ttc: Millimes, tvaBp: number): Millimes {
  return mulDivRound(ttc, BP_BASE, BP_BASE + tvaBp);
}

/** TTC à partir d'un HT et d'un taux de TVA en points de base. */
export function ttcFromHt(ht: Millimes, tvaBp: number): Millimes {
  return mulDivRound(ht, BP_BASE + tvaBp, BP_BASE);
}

/**
 * Répartit `total` proportionnellement aux poids (méthode du plus fort reste).
 * La somme des parts est toujours exactement égale à `total`.
 */
export function allocateProportionally(total: Millimes, weights: readonly number[]): Millimes[] {
  assertInteger(total, 'total');
  if (weights.length === 0) return [];
  const weightSum = sum(weights);
  if (weightSum === 0) {
    const parts = weights.map(() => 0);
    parts[0] = total;
    return parts;
  }
  const big = BigInt(total);
  const bigSum = BigInt(weightSum);
  const floors: bigint[] = [];
  const remainders: { index: number; rem: bigint }[] = [];
  weights.forEach((w, index) => {
    const n = big * BigInt(w);
    const q = n / bigSum;
    floors.push(q);
    remainders.push({ index, rem: n - q * bigSum });
  });
  let distributed = floors.reduce((a, b) => a + b, 0n);
  const diff = big - distributed;
  const step = diff >= 0n ? 1n : -1n;
  remainders.sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.index - y.index));
  let i = 0;
  while (distributed !== big) {
    const target = remainders[i % remainders.length]!;
    floors[target.index] = floors[target.index]! + step;
    distributed += step;
    i += 1;
  }
  return floors.map((f) => Number(f));
}

/** Coût unitaire d'un lot (RG-08) : (quantité × prix net HT) / (quantité + unités gratuites). */
export function lotUnitCost(qty: number, netUnitPriceHt: Millimes, freeQty: number): Millimes {
  assertInteger(qty, 'quantité');
  assertInteger(freeQty, 'unités gratuites');
  if (qty + freeQty <= 0) throw new MoneyError('Quantité totale nulle');
  return mulDivRound(qty, netUnitPriceHt, qty + freeQty);
}

// ---------------------------------------------------------------------------
// Formatage et saisie
// ---------------------------------------------------------------------------

const NBSP = '\u202f';

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export interface FormatMoneyOptions {
  /** Suffixe de devise (défaut « DT »). Chaîne vide pour ne pas l'afficher. */
  currency?: string;
  decimals?: number;
}

/** Formate un montant en millimes : 1234567 → « 1 234,567 DT ». */
export function formatMoney(amount: Millimes, options: FormatMoneyOptions = {}): string {
  const { currency = 'DT' } = options;
  const decimals = Math.min(3, Math.max(0, options.decimals ?? 3));
  assertInteger(amount);
  const negative = amount < 0;
  // Arrondi à la précision d'affichage demandée (la valeur stockée reste au millime).
  const scaled = mulDivRound(Math.abs(amount), 1, 10 ** (3 - decimals));
  const divisor = 10 ** decimals;
  const units = Math.floor(scaled / divisor);
  const fraction = scaled % divisor;
  const body =
    decimals === 0
      ? groupThousands(String(units))
      : `${groupThousands(String(units))},${String(fraction).padStart(decimals, '0')}`;
  const signed = negative && scaled !== 0 ? `−${body}` : body;
  return currency ? `${signed}${NBSP}${currency}` : signed;
}

/**
 * Convertit une saisie utilisateur en millimes : « 1 234,5 » → 1234500 ; « 12.345 » → 12345.
 * Retourne `null` si la saisie est invalide ou a plus de 3 décimales.
 */
export function parseMoney(input: string): Millimes | null {
  const cleaned = input
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/DT$/i, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d{0,3})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [intPart = '0', fracPart = ''] = cleaned.replace('-', '').split('.');
  const value = Number(intPart) * MILLIMES_PER_UNIT + Number(fracPart.padEnd(3, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** Millimes → chaîne de saisie « 1234,567 » (sans séparateur de milliers). */
export function toMoneyInput(amount: Millimes): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const s = `${Math.floor(abs / MILLIMES_PER_UNIT)},${String(abs % MILLIMES_PER_UNIT).padStart(3, '0')}`;
  return negative ? `-${s}` : s;
}

/** Points de base → « 7 % » / « 12,5 % ». */
export function formatBp(bp: number): string {
  const pct = bp / 100;
  return `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${NBSP}%`;
}

/** Saisie « 12,5 » (%) → 1250 bp. Retourne null si invalide. */
export function parsePercentToBp(input: string): number | null {
  const cleaned = input.replace(/[\s%]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [i = '0', f = ''] = cleaned.split('.');
  return Number(i) * 100 + Number(f.padEnd(2, '0'));
}

// ---------------------------------------------------------------------------
// Montant en toutes lettres (factures)
// ---------------------------------------------------------------------------

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
  'dix-sept',
  'dix-huit',
  'dix-neuf',
];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n: number): string {
  if (n < 20) return UNITS[n]!;
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t]!;
    if (u === 1) return `${TENS[t]} et un`;
    return `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) {
    const rest = n - 60;
    if (rest === 11) return 'soixante et onze';
    return `soixante-${UNITS[rest]}`;
  }
  const rest = n - 80;
  if (rest === 0) return 'quatre-vingts';
  return `quatre-vingt-${UNITS[rest]}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return below100(r);
  const head = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
  return r === 0 ? head : `${head} ${below100(r)}`;
}

/** Nombre entier positif en toutes lettres, orthographe traditionnelle française. */
export function numberToFrenchWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new MoneyError(`Nombre invalide : ${n}`);
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const scales: [number, string, string][] = [
    [1_000_000_000, 'milliard', 'milliards'],
    [1_000_000, 'million', 'millions'],
  ];
  let rest = n;
  for (const [value, singular, plural] of scales) {
    const q = Math.floor(rest / value);
    if (q > 0) {
      parts.push(`${numberToFrenchWords(q)} ${q > 1 ? plural : singular}`);
      rest %= value;
    }
  }
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) {
    // « cent » et « vingt » ne prennent pas de « s » devant « mille ».
    const words = thousands === 1 ? '' : below1000(thousands).replace(/(cent|vingt)s$/, '$1');
    parts.push(words ? `${words} mille` : 'mille');
    rest %= 1000;
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' ');
}

/** « Mille deux cent trente-quatre dinars et cinq cent soixante-sept millimes ». */
export function amountInWords(amount: Millimes, currencyName = 'dinar'): string {
  assertInteger(amount);
  const abs = Math.abs(amount);
  const units = Math.floor(abs / MILLIMES_PER_UNIT);
  const millimes = abs % MILLIMES_PER_UNIT;
  const unitWords = `${numberToFrenchWords(units)} ${currencyName}${units > 1 ? 's' : ''}`;
  let text = unitWords;
  if (millimes > 0) {
    text += ` et ${numberToFrenchWords(millimes)} millime${millimes > 1 ? 's' : ''}`;
  }
  if (amount < 0) text = `moins ${text}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Taille lisible (« 12,4 Mo »). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}
