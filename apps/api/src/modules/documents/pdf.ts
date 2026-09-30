import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Sous-ensemble typé de pdfmake 0.3 (serveur). */
interface PdfMakeServer {
  setFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (path: string) => boolean): void;
  createPdf(doc: Record<string, unknown>): { getBuffer(): Promise<Buffer> };
}

let instance: PdfMakeServer | null = null;

function pdfmake(): PdfMakeServer {
  if (instance) return instance;
  const lib = require('pdfmake') as PdfMakeServer;
  const fontsDir = join(dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  lib.setFonts({
    Roboto: {
      normal: join(fontsDir, 'Roboto-Regular.ttf'),
      bold: join(fontsDir, 'Roboto-Medium.ttf'),
      italics: join(fontsDir, 'Roboto-Italic.ttf'),
      bolditalics: join(fontsDir, 'Roboto-MediumItalic.ttf'),
    },
  });
  // Aucun accès réseau ; accès disque limité aux polices.
  lib.setUrlAccessPolicy(() => false);
  lib.setLocalAccessPolicy((path) => path.startsWith(fontsDir));
  instance = lib;
  return lib;
}

export type DocDefinition = Record<string, unknown>;

export function renderPdf(doc: DocDefinition): Promise<Buffer> {
  return pdfmake().createPdf(doc).getBuffer();
}

/** Largeur d'un ticket 80 mm en points PDF (zone imprimable ~72 mm). */
export const TICKET_WIDTH = 226.77;
