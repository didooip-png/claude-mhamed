/**
 * Pont minimal entre le site (isolé) et le poste : uniquement le service « platform » du site
 * (impression silencieuse, tiroir-caisse, identité du poste). Aucun accès Node, aucun `ipcRenderer` exposé.
 */
import { contextBridge, ipcRenderer } from 'electron';

// Le jeton du poste est déchiffré par le processus principal (safeStorage) et gardé ici en mémoire.
let deviceJson = ipcRenderer.sendSync('ps:device:load') as string | null;

contextBridge.exposeInMainWorld('pharmastockDesktop', {
  version: ipcRenderer.sendSync('ps:version') as string,
  print: (pdf: ArrayBuffer, options: unknown): Promise<void> =>
    ipcRenderer.invoke('ps:print', pdf, options),
  openCashDrawer: (): Promise<void> => ipcRenderer.invoke('ps:drawer'),
  getDeviceInfo: (): Promise<{ hostname: string; platform: string }> =>
    ipcRenderer.invoke('ps:device-info'),
  openSettings: (): Promise<void> => ipcRenderer.invoke('ps:open-settings'),
  deviceStore: {
    load: (): string | null => deviceJson,
    save: (json: string): void => {
      deviceJson = json;
      ipcRenderer.send('ps:device:save', json);
    },
    clear: (): void => {
      deviceJson = null;
      ipcRenderer.send('ps:device:clear');
    },
  },
});
