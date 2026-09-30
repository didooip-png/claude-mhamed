/** Stockage local du poste : réglages (JSON) et secrets chiffrés avec `safeStorage` (DPAPI sous Windows). */
import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, sanitizeSettings, type DesktopSettings } from './config.js';

const dir = () => {
  const d = app.getPath('userData');
  mkdirSync(d, { recursive: true });
  return d;
};

function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export function loadSettings(): DesktopSettings {
  let settings = { ...DEFAULT_SETTINGS };
  try {
    settings = sanitizeSettings(JSON.parse(readFileSync(join(dir(), 'settings.json'), 'utf8')));
  } catch {
    /* premier lancement ou fichier illisible : valeurs par défaut */
  }
  // Variable d'environnement : pratique en développement et pour un déploiement scripté.
  const forced = process.env.PHARMASTOCK_SERVER_URL;
  return forced ? sanitizeSettings({ ...settings, serverUrl: forced }) : settings;
}

export function saveSettings(settings: DesktopSettings): void {
  writeAtomic(join(dir(), 'settings.json'), JSON.stringify(settings, null, 2));
}

/** Secret chiffré sur disque (jeton du poste, cookie de renouvellement). */
export const secret = {
  read(name: string): string | null {
    try {
      const raw = readFileSync(join(dir(), `${name}.bin`));
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : null;
    } catch {
      return null;
    }
  },
  write(name: string, value: string): void {
    // Sans chiffrement disponible, le secret reste en mémoire (l'appelant le garde) plutôt qu'en clair.
    if (!safeStorage.isEncryptionAvailable()) return;
    writeAtomic(join(dir(), `${name}.bin`), safeStorage.encryptString(value));
  },
  remove(name: string): void {
    rmSync(join(dir(), `${name}.bin`), { force: true });
  },
};
