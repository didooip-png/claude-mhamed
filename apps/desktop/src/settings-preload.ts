/** Pont de la fenêtre « Réglages du poste » (jamais exposé au site). */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pharmastockSettings', {
  get: () => ipcRenderer.invoke('ps:settings:get'),
  save: (settings: unknown) => ipcRenderer.invoke('ps:settings:save', settings),
  testPrint: (settings: unknown, format: 'TICKET' | 'A4') =>
    ipcRenderer.invoke('ps:settings:test-print', settings, format),
  testDrawer: (settings: unknown) => ipcRenderer.invoke('ps:settings:test-drawer', settings),
  close: () => ipcRenderer.invoke('ps:settings:close'),
});
