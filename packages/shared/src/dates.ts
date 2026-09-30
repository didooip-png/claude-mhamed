/**
 * Dates : stockage en UTC, affichage dans le fuseau de l'établissement (Africa/Tunis par défaut).
 * Les dates « calendaires » (péremption, échéance) circulent au format ISO `AAAA-MM-JJ`.
 */

export const DEFAULT_TIMEZONE = 'Africa/Tunis';

const pad = (n: number) => String(n).padStart(2, '0');

function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Date calendaire du jour dans le fuseau donné, format AAAA-MM-JJ. */
export function todayIso(timeZone = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const p = partsInTz(now, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** AAAA-MM-JJ → « 30/09/2026 ». */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Instant → « 30/09/2026 » dans le fuseau donné. */
export function formatDate(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!value) return '';
  const p = partsInTz(new Date(value), timeZone);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** Instant → « 30/09/2026 14:05:32 » dans le fuseau donné. */
export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!value) return '';
  const p = partsInTz(new Date(value), timeZone);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Instant → « 14:05 » dans le fuseau donné. */
export function formatTime(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!value) return '';
  const p = partsInTz(new Date(value), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Date calendaire (AAAA-MM-JJ) et heure d'un instant dans le fuseau donné. */
export function localParts(value: Date, timeZone = DEFAULT_TIMEZONE) {
  const p = partsInTz(value, timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    hour: p.hour,
    minute: p.minute,
    weekday: weekdayOf(`${p.year}-${pad(p.month)}-${pad(p.day)}`),
  };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m);
}

/**
 * Saisie d'une date de péremption :
 * - « MM/AAAA » (comme imprimé sur les boîtes) → dernier jour du mois ;
 * - « JJ/MM/AAAA » ; « AAAA-MM-JJ ».
 * Retourne AAAA-MM-JJ ou null si invalide.
 */
export function parseExpiryInput(input: string): string | null {
  const s = input.trim();
  let m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  if (isValidIsoDate(s)) return s;
  return null;
}

/** Ajoute N jours à une date calendaire ISO. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Ajoute N mois à une date calendaire ISO (fin de mois conservée si dépassement). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDayOfMonth(ny, nm)))}`;
}

/** Nombre de jours entre deux dates calendaires ISO (b − a). */
export function diffDaysIso(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayOf(iso: string): number {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}

/**
 * Convertit une date calendaire + heure locale (dans le fuseau donné) en instant UTC.
 * Utilisé pour les bornes de période (« depuis le 01/09/2026 à 00:00 heure de Tunis »).
 */
export function zonedDateTimeToUtc(iso: string, time: string, timeZone = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const [hh = 0, mm = 0, ss = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Décalage du fuseau à cet instant (deux passes pour gérer un éventuel changement d'heure).
  let ts = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = partsInTz(new Date(ts), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ts = guess - (asUtc - ts);
  }
  return new Date(ts);
}

/** Début de journée (00:00 locale) d'une date calendaire, en UTC. */
export function startOfLocalDay(iso: string, timeZone = DEFAULT_TIMEZONE): Date {
  return zonedDateTimeToUtc(iso, '00:00:00', timeZone);
}

/** Début de la journée suivante (borne exclusive) d'une date calendaire, en UTC. */
export function endOfLocalDayExclusive(iso: string, timeZone = DEFAULT_TIMEZONE): Date {
  return zonedDateTimeToUtc(addDaysIso(iso, 1), '00:00:00', timeZone);
}

export type ExpiryLevel = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK';

/** Niveau de péremption pour le code couleur (rouge / orange / jaune / vert). */
export function expiryLevel(
  expiryIso: string,
  todayIsoValue: string,
  orangeDays = 30,
  yellowDays = 90,
): ExpiryLevel {
  const days = diffDaysIso(todayIsoValue, expiryIso);
  if (days <= 0) return 'EXPIRED';
  if (days < orangeDays) return 'CRITICAL';
  if (days < yellowDays) return 'WARNING';
  return 'OK';
}
