/**
 * Sérialisation JSON des BIGINT (montants en millimes) : convertis en nombre.
 * Les montants restent très en deçà de Number.MAX_SAFE_INTEGER (9 × 10^15 millimes).
 */
declare global {
  interface BigInt {
    toJSON(): number;
  }
}

export function installBigIntJson(): void {
  if (Object.prototype.hasOwnProperty.call(BigInt.prototype, 'toJSON')) return;
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint): number {
      const n = Number(this);
      if (!Number.isSafeInteger(n)) throw new Error(`Entier hors limites : ${this.toString()}`);
      return n;
    },
    writable: false,
    configurable: false,
  });
}

/** Convertit une valeur en structure JSON pure (bigint → number, Date → ISO, undefined supprimé). */
export function toPlainJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => toPlainJson(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = toPlainJson(v);
    }
    return out;
  }
  return value;
}

/** JSON canonique : clés triées récursivement (utilisé pour la chaîne de hash du journal). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Conversion BigInt → number sûre. */
export function num(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(n)) throw new Error(`Entier hors limites : ${String(value)}`);
  return n;
}
