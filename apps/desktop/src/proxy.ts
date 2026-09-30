/**
 * Relais vers l'API : le site chargé en local appelle `app://pharmastock/api/v1/...` (même origine,
 * donc ni CORS ni cookie « SameSite » à contourner) ; le processus principal transmet la requête au
 * serveur configuré. Logique pure : en-têtes, cookie de renouvellement, adresse cible.
 */
import { API_PREFIX } from './protocol.js';

/** Cookie de renouvellement de session posé par l'API (httpOnly, chemin /api/v1/auth). */
export const REFRESH_COOKIE = 'ps_refresh';
export const REFRESH_PATH = '/api/v1/auth';

const FORWARDED_HEADERS = new Set([
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'idempotency-key',
  'if-none-match',
  'x-background',
  'x-device-id',
  'x-device-token',
]);

/** Adresse du serveur pour une URL `app://…/api/…` ; `null` si ce n'est pas un appel d'API. */
export function upstreamUrl(serverOrigin: string, appUrl: string): string | null {
  const u = new URL(appUrl);
  if (!u.pathname.startsWith(API_PREFIX)) return null;
  return `${serverOrigin}${u.pathname}${u.search}`;
}

/** En-têtes transmis au serveur : liste blanche (jamais Origin, Referer ni le Cookie du navigateur). */
export function upstreamHeaders(
  incoming: Iterable<[string, string]>,
  pathname: string,
  refreshToken: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of incoming) {
    if (FORWARDED_HEADERS.has(name.toLowerCase())) out[name.toLowerCase()] = value;
  }
  out['user-agent'] = 'PharmaStock-Desktop';
  if (refreshToken && pathname.startsWith(REFRESH_PATH))
    out.cookie = `${REFRESH_COOKIE}=${refreshToken}`;
  return out;
}

export type RefreshCookieChange = { kind: 'set'; value: string } | { kind: 'clear' } | null;

/** Lit les en-têtes `Set-Cookie` d'une réponse : pose ou effacement du cookie de renouvellement. */
export function refreshCookieChange(setCookies: string[]): RefreshCookieChange {
  for (const line of setCookies) {
    const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (eq < 1 || pair.slice(0, eq) !== REFRESH_COOKIE) continue;
    const value = pair.slice(eq + 1);
    const expired = attrs.some((a) => {
      const [k = '', v = ''] = a.split('=');
      if (k.toLowerCase() === 'max-age') return Number(v) <= 0;
      if (k.toLowerCase() === 'expires') return Date.parse(v) <= Date.now();
      return false;
    });
    return !value || expired ? { kind: 'clear' } : { kind: 'set', value };
  }
  return null;
}
