import {
  formatBp,
  formatDate,
  formatDateTime,
  formatIsoDate,
  formatMoney,
  formatTime,
} from '@pharmastock/shared';
import { useSettings } from './queries';

/** Formateurs liés aux paramètres de l'établissement (devise, décimales, fuseau). */
export function useFormat() {
  const s = useSettings();
  const tz = s['general.timezone'];
  const currency = s['general.currency_code'];
  const decimals = s['general.currency_decimals'];
  return {
    money: (v: number | null | undefined) =>
      v === null || v === undefined ? '' : formatMoney(v, { currency, decimals }),
    amount: (v: number | null | undefined) =>
      v === null || v === undefined ? '' : formatMoney(v, { currency: '', decimals }),
    date: (v: Date | string | null | undefined) => formatDate(v, tz),
    dateTime: (v: Date | string | null | undefined) => formatDateTime(v, tz),
    time: (v: Date | string | null | undefined) => formatTime(v, tz),
    isoDate: formatIsoDate,
    percent: formatBp,
    qty: (v: number | null | undefined) =>
      v === null || v === undefined ? '' : v.toLocaleString('fr-FR'),
    tz,
    currency,
  };
}
