/** Impression silencieuse (sans boîte de dialogue) des PDF du serveur et ouverture du tiroir-caisse. */
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDrawerCommand } from './escpos.js';
import { sendRaw } from './raw-print.js';
import type { DesktopSettings } from './config.js';

export type PrintFormat = 'TICKET' | 'A4';

export interface PrintOptions {
  format: PrintFormat;
  copies?: number;
}

/** Valide ce que le site transmet par le pont (rien n'est supposé fiable côté rendu). */
export function checkPrintOptions(options: unknown): Required<PrintOptions> {
  const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
  const format = o.format === 'A4' ? 'A4' : 'TICKET';
  const copies = Number.isInteger(o.copies) ? Math.min(5, Math.max(1, o.copies as number)) : 1;
  return { format, copies };
}

export const printerFor = (settings: DesktopSettings, format: PrintFormat) =>
  (format === 'TICKET' ? settings.ticketPrinter : settings.a4Printer) || undefined;

/**
 * Imprime un PDF sur l'imprimante choisie pour le poste (Windows : SumatraPDF embarqué par
 * `pdf-to-printer`). Sur les autres systèmes (développement), renvoie `false` : l'appelant ouvre alors
 * l'aperçu.
 */
export async function printPdfSilently(
  pdf: Buffer,
  options: Required<PrintOptions>,
  settings: DesktopSettings,
): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const { print } = await import('pdf-to-printer');
  const file = join(tmpdir(), `pharmastock-${randomBytes(6).toString('hex')}.pdf`);
  await writeFile(file, pdf);
  try {
    await print(file, {
      printer: printerFor(settings, options.format),
      copies: options.copies,
      // Un ticket 80 mm est déjà à la bonne taille ; une facture A4 est ajustée à la page.
      scale: options.format === 'TICKET' ? 'noscale' : 'fit',
      silent: true,
    });
  } finally {
    // SumatraPDF a lu le fichier quand la promesse se résout ; on le retire un peu plus tard par prudence.
    setTimeout(() => void rm(file, { force: true }), 30_000);
  }
  return true;
}

export async function openCashDrawer(settings: DesktopSettings): Promise<void> {
  await sendRaw(settings.ticketPrinter, openDrawerCommand());
}
