/**
 * Réglages du poste (application de bureau) : logique pure, testable sans Electron.
 * Le stockage sur disque est dans `store.ts`.
 */

export interface DesktopSettings {
  /** Adresse du serveur PharmaStock (origine, ex. https://pharmacie.exemple.tn). Vide = premier lancement. */
  serverUrl: string;
  /** Imprimante des tickets 80 mm et du tiroir-caisse (vide = imprimante par défaut de Windows). */
  ticketPrinter: string;
  /** Imprimante des factures A4 (vide = imprimante par défaut de Windows). */
  a4Printer: string;
  fullscreen: boolean;
  /** Lancer PharmaStock à l'ouverture de la session Windows. */
  autoStart: boolean;
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  serverUrl: '',
  ticketPrinter: '',
  a4Printer: '',
  fullscreen: false,
  autoStart: false,
};

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/i;

export class SettingsError extends Error {}

/**
 * Nettoie l'adresse saisie : origine seule (sans chemin), HTTPS obligatoire sauf réseau local.
 * « pharmacie.exemple.tn » devient « https://pharmacie.exemple.tn ».
 */
export function normalizeServerUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new SettingsError('Saisissez l’adresse du serveur.');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new SettingsError('Adresse invalide. Exemple : https://pharmacie.exemple.tn');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new SettingsError('L’adresse doit commencer par https://');
  if (url.protocol === 'http:' && !PRIVATE_HOST.test(url.hostname))
    throw new SettingsError(
      'Une adresse sur Internet doit utiliser https:// (http:// n’est admis que sur le réseau local).',
    );
  if (url.username || url.password)
    throw new SettingsError('L’adresse ne doit contenir ni identifiant ni mot de passe.');
  return url.origin;
}

/** Ne garde que les champs connus, avec le bon type ; le reste retombe sur les valeurs par défaut. */
export function sanitizeSettings(input: unknown): DesktopSettings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (k: keyof DesktopSettings) =>
    typeof src[k] === 'string' ? (src[k] as string).trim().slice(0, 300) : '';
  const bool = (k: keyof DesktopSettings) => src[k] === true;
  let serverUrl: string;
  try {
    serverUrl = str('serverUrl') ? normalizeServerUrl(str('serverUrl')) : '';
  } catch {
    serverUrl = '';
  }
  return {
    serverUrl,
    ticketPrinter: str('ticketPrinter'),
    a4Printer: str('a4Printer'),
    fullscreen: bool('fullscreen'),
    autoStart: bool('autoStart'),
  };
}
