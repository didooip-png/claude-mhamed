import { describe, expect, it } from 'vitest';
import {
  addMonthsIso,
  diffDaysIso,
  expiryLevel,
  formatDateTime,
  parseExpiryInput,
  todayIso,
  zonedDateTimeToUtc,
} from '../src/dates.js';

describe('dates', () => {
  it('lit MM/AAAA comme le dernier jour du mois', () => {
    expect(parseExpiryInput('02/2028')).toBe('2028-02-29');
    expect(parseExpiryInput('4/2027')).toBe('2027-04-30');
    expect(parseExpiryInput('15/03/2027')).toBe('2027-03-15');
    expect(parseExpiryInput('31/02/2027')).toBeNull();
    expect(parseExpiryInput('13/2027')).toBeNull();
  });
  it('affiche en heure de Tunis (UTC+1)', () => {
    expect(formatDateTime(new Date('2026-09-30T13:05:32Z'))).toBe('30/09/2026 14:05:32');
    expect(todayIso('Africa/Tunis', new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01');
  });
  it('convertit une heure locale en UTC', () => {
    expect(zonedDateTimeToUtc('2026-09-30', '00:00:00').toISOString()).toBe('2026-09-29T23:00:00.000Z');
  });
  it('calcule les écarts de dates et le niveau de péremption', () => {
    expect(diffDaysIso('2026-09-30', '2026-10-30')).toBe(30);
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(expiryLevel('2026-09-30', '2026-09-30')).toBe('EXPIRED');
    expect(expiryLevel('2026-10-10', '2026-09-30')).toBe('CRITICAL');
    expect(expiryLevel('2026-12-01', '2026-09-30')).toBe('WARNING');
    expect(expiryLevel('2027-12-01', '2026-09-30')).toBe('OK');
  });
});
