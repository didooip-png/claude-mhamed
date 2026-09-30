/**
 * Service « platform » (§14) : implémentation navigateur (étape 1).
 * L'application de bureau (étape 2) fournira la même interface via un pont IPC
 * (`window.pharmastockDesktop`) : impression silencieuse, tiroir-caisse, infos du poste.
 */
export interface PrintOptions {
  format: 'TICKET' | 'A4';
  copies?: number;
}

interface DesktopBridge {
  print(pdf: ArrayBuffer, options: PrintOptions): Promise<void>;
  openCashDrawer(): Promise<void>;
  getDeviceInfo(): Promise<{ hostname: string; platform: string }>;
}

declare global {
  interface Window {
    pharmastockDesktop?: DesktopBridge;
  }
}

const desktop = typeof window !== 'undefined' ? window.pharmastockDesktop : undefined;

export const platform = {
  isDesktop: !!desktop,

  /** Imprime un PDF (ticket 80 mm ou A4). Navigateur : boîte de dialogue d'impression. */
  async print(pdf: Blob, options: PrintOptions): Promise<void> {
    if (desktop) return desktop.print(await pdf.arrayBuffer(), options);
    const url = URL.createObjectURL(pdf);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = url;
    document.body.appendChild(iframe);
    await new Promise<void>((resolve) => {
      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch {
            window.open(url, '_blank');
          }
          resolve();
        }, 150);
      };
    });
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  },

  /** Ouvre un PDF dans un nouvel onglet (aperçu). */
  preview(pdf: Blob): void {
    const url = URL.createObjectURL(pdf);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  },

  /** Télécharge un fichier (exports Excel / PDF). */
  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  /** Tiroir-caisse : disponible uniquement dans l'application de bureau (ESC/POS). */
  async openCashDrawer(): Promise<boolean> {
    if (!desktop) return false;
    await desktop.openCashDrawer();
    return true;
  },

  async getDeviceInfo(): Promise<{ hostname: string; platform: string }> {
    if (desktop) return desktop.getDeviceInfo();
    return { hostname: location.hostname, platform: navigator.platform };
  },
};
