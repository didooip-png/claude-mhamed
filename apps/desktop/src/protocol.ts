/**
 * Protocole `app://pharmastock` : sert le build local du frontend (aucune URL distante n'est chargée)
 * et les écrans propres au poste. Logique pure ici (chemins, types, CSP) ; le branchement à Electron
 * est dans `main.ts`.
 */
import { extname, join, normalize, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'pharmastock';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
/** Préfixe des écrans du poste (réglages), distincts du site. */
export const DESKTOP_UI_PREFIX = '/__desktop/';
export const API_PREFIX = '/api/';

/** Même politique que le site en production (docker/Caddyfile) : pas de script inline, pas d'eval. */
export const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

export const mimeFor = (file: string) =>
  MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * Chemin de fichier correspondant à une URL de l'application, ou `null` si la demande sort du
 * dossier (`..`, chemins absolus, séparateurs déguisés). Une route sans extension (page du site) renvoie
 * `index.html` : l'application est une SPA.
 */
export function resolveAppFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]?.split('#')[0] ?? '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const target = normalize(join(root, relative || 'index.html'));
  const base = normalize(root.endsWith(sep) ? root : root + sep);
  if (!(target + sep).startsWith(base) && target !== normalize(root)) return null;
  if (!extname(target)) return join(root, 'index.html');
  return target;
}
