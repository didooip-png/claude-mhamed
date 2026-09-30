/**
 * PharmaStock — application de bureau (§14).
 *
 *  - charge le build LOCAL du site (protocole `app://pharmastock`), jamais une URL distante ;
 *  - relaie les appels d'API vers le serveur configuré (HTTPS) : le site reste « même origine » ;
 *  - isolation stricte (contextIsolation, sandbox, pas de Node dans le site), navigation externe bloquée ;
 *  - impression silencieuse, tiroir-caisse, jeton du poste chiffré (safeStorage), instance unique,
 *    mises à jour proposées à la fermeture.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeServerUrl,
  sanitizeSettings,
  SettingsError,
  type DesktopSettings,
} from './config.js';
import {
  checkPrintOptions,
  openCashDrawer,
  printPdfSilently,
  type PrintFormat,
} from './printing.js';
import {
  API_PREFIX,
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  CSP,
  DESKTOP_UI_PREFIX,
  mimeFor,
  resolveAppFile,
} from './protocol.js';
import { refreshCookieChange, upstreamHeaders, upstreamUrl } from './proxy.js';
import { loadSettings, saveSettings, secret } from './store.js';

// Doit être déclaré avant `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const appRoot = app.getAppPath();
const rendererRoot = join(appRoot, 'renderer');
const uiRoot = join(appRoot, 'dist', 'desktop-ui');

let settings: DesktopSettings = { ...loadSettings() };
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let refreshToken: string | null = null;
let deviceJson: string | null = null;
let updateReady = false;
let quitting = false;

// ------------------------------------------------------------------------- Journal
function log(message: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'desktop.log');
    try {
      if (statSync(file).size > 1_000_000) renameSync(file, `${file}.old`);
    } catch {
      /* pas encore de journal */
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* le journal ne doit jamais faire échouer l'application */
  }
}

// ------------------------------------------------------------------------- Protocole app://
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

async function serveStatic(pathname: string): Promise<Response> {
  const isUi = pathname.startsWith(DESKTOP_UI_PREFIX);
  const root = isUi ? uiRoot : rendererRoot;
  const file = resolveAppFile(root, isUi ? pathname.slice(DESKTOP_UI_PREFIX.length - 1) : pathname);
  if (!file) return new Response('Interdit', { status: 403 });
  try {
    const data = await readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': mimeFor(file),
        'content-security-policy': CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': file.endsWith('.html')
          ? 'no-cache'
          : 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
}

const DROPPED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

/** Transmet un appel d'API au serveur ; gère à part le cookie de renouvellement de session. */
async function proxyApi(request: Request, url: URL): Promise<Response> {
  if (!settings.serverUrl)
    return json(503, {
      code: 'SERVER_NOT_CONFIGURED',
      message: 'Aucun serveur n’est configuré sur ce poste.',
    });
  const target = upstreamUrl(settings.serverUrl, request.url);
  if (!target) return new Response('Introuvable', { status: 404 });
  const method = request.method.toUpperCase();
  const headers = upstreamHeaders(request.headers.entries(), url.pathname, refreshToken);
  let upstream: Response;
  try {
    upstream = await net.fetch(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
      // Le cookie de renouvellement est géré ici (le site est en `app://`, donc « cross-site »).
      credentials: 'omit',
    });
  } catch (error) {
    log(`API injoignable (${method} ${url.pathname}) : ${String(error)}`);
    // Même comportement que le navigateur hors ligne : le site affiche son bandeau de connexion.
    throw error;
  }
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  const change = refreshCookieChange(setCookies);
  if (change?.kind === 'set') {
    refreshToken = change.value;
    secret.write('refresh', change.value);
  } else if (change?.kind === 'clear') {
    refreshToken = null;
    secret.remove('refresh');
  }
  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) out.append(name, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

function registerProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Introuvable', { status: 404 });
    if (url.pathname.startsWith(API_PREFIX)) return proxyApi(request, url);
    return serveStatic(url.pathname);
  });
}

// ------------------------------------------------------------------------- Fenêtres
const secureWebPreferences = (preload: string) => ({
  preload: join(appRoot, 'dist', preload),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
  devTools: !app.isPackaged,
});

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'PharmaStock',
    backgroundColor: '#f6f8f9',
    autoHideMenuBar: true,
    fullscreen: settings.fullscreen,
    webPreferences: secureWebPreferences('preload.cjs'),
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());

  // Aucune navigation hors de l'application ; seuls les aperçus PDF (blob:) s'ouvrent, dans une fenêtre isolée.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:'))
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 1000,
          title: 'Aperçu — PharmaStock',
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      };
    return { action: 'deny' };
  });

  // Mise à jour prête : proposée uniquement quand on ferme, jamais en pleine vente.
  win.on('close', (event) => {
    if (quitting || !updateReady) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      title: 'Mise à jour prête',
      message: 'Une nouvelle version de PharmaStock est prête.',
      detail:
        'L’installer maintenant ? PharmaStock redémarrera. Les paniers en cours sont conservés sur le serveur.',
      buttons: ['Installer maintenant', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    });
    quitting = true;
    if (choice === 0) autoUpdater.quitAndInstall(false, true);
    else win.close();
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  void win.loadURL(`${APP_ORIGIN}/`);
}

function openSettingsWindow(): void {
  if (settingsWindow) return void settingsWindow.focus();
  const win = new BrowserWindow({
    width: 560,
    height: 700,
    parent: mainWindow ?? undefined,
    modal: Boolean(mainWindow),
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Réglages du poste — PharmaStock',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences('settings-preload.cjs'),
  });
  settingsWindow = win;
  win.removeMenu();
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    settingsWindow = null;
    // Sans serveur configuré, l'application ne peut rien faire : fermer les réglages la quitte.
    if (!settings.serverUrl) app.quit();
  });
  void win.loadURL(`${APP_ORIGIN}${DESKTOP_UI_PREFIX}settings.html`);
}

function applySettings(previous: DesktopSettings): void {
  app.setLoginItemSettings({ openAtLogin: settings.autoStart });
  mainWindow?.setFullScreen(settings.fullscreen);
  if (previous.serverUrl !== settings.serverUrl) {
    // Un autre serveur : l'ancienne session ne vaut plus rien.
    refreshToken = null;
    secret.remove('refresh');
    if (mainWindow) void mainWindow.loadURL(`${APP_ORIGIN}/`);
    else createMainWindow();
  }
}

// ------------------------------------------------------------------------- IPC
const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
  Boolean(event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) &&
  !event.senderFrame?.url.startsWith(`${APP_ORIGIN}${DESKTOP_UI_PREFIX}`);
const trustedSettings = (event: IpcMainInvokeEvent) =>
  Boolean(event.senderFrame?.url.startsWith(`${APP_ORIGIN}${DESKTOP_UI_PREFIX}`));
const refuse = () => new Error('Appel refusé.');

function isDeviceJson(value: string): boolean {
  try {
    const d = JSON.parse(value) as Record<string, unknown>;
    return ['id', 'token', 'name'].every(
      (k) => typeof d[k] === 'string' && (d[k] as string).length < 500,
    );
  } catch {
    return false;
  }
}

function toBuffer(pdf: unknown): Buffer {
  if (!(pdf instanceof ArrayBuffer) || pdf.byteLength === 0 || pdf.byteLength > MAX_PDF_BYTES)
    throw new Error('Document invalide.');
  const buf = Buffer.from(pdf);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new Error('Le document n’est pas un PDF.');
  return buf;
}

/** Repli hors Windows (développement) : ouvre le PDF dans le lecteur du système. */
async function previewPdf(pdf: Buffer): Promise<void> {
  const file = join(tmpdir(), `pharmastock-${Date.now()}.pdf`);
  writeFileSync(file, pdf);
  await shell.openPath(file);
}

async function testPage(candidate: DesktopSettings, format: PrintFormat): Promise<void> {
  const ticket = format === 'TICKET';
  const html = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;margin:${ticket ? '4mm' : '20mm'};width:${ticket ? '72mm' : 'auto'}">
    <h2 style="margin:0 0 6px">PharmaStock</h2><p>Impression de test — ${ticket ? 'ticket 80 mm' : 'facture A4'}</p>
    <p>${new Date().toLocaleString('fr-FR')}</p><p>Poste : ${hostname()}</p><hr><p>Si vous lisez ceci, l’imprimante est bien réglée.</p>`;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF(
      ticket
        ? {
            pageSize: { width: 3.15, height: 4.5 },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
          }
        : { pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    );
    const printed = await printPdfSilently(pdf, { format, copies: 1 }, candidate);
    if (!printed) throw new Error('L’impression silencieuse n’est disponible que sous Windows.');
  } finally {
    win.destroy();
  }
}

function registerIpc(): void {
  // --- site (pont « platform »)
  ipcMain.on('ps:device:load', (event) => {
    event.returnValue = trusted(event) ? deviceJson : null;
  });
  ipcMain.on('ps:version', (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.on('ps:device:save', (event, value: unknown) => {
    if (!trusted(event) || typeof value !== 'string' || !isDeviceJson(value)) return;
    deviceJson = value;
    secret.write('device', value);
  });
  ipcMain.on('ps:device:clear', (event) => {
    if (!trusted(event)) return;
    deviceJson = null;
    secret.remove('device');
  });
  ipcMain.handle('ps:print', async (event, pdf: unknown, options: unknown) => {
    if (!trusted(event)) throw refuse();
    const buf = toBuffer(pdf);
    const printed = await printPdfSilently(buf, checkPrintOptions(options), settings);
    if (!printed) await previewPdf(buf);
  });
  ipcMain.handle('ps:drawer', async (event) => {
    if (!trusted(event)) throw refuse();
    await openCashDrawer(settings);
  });
  ipcMain.handle('ps:device-info', (event) => {
    if (!trusted(event)) throw refuse();
    return { hostname: hostname(), platform: process.platform };
  });
  ipcMain.handle('ps:open-settings', (event) => {
    if (!trusted(event)) throw refuse();
    openSettingsWindow();
  });

  // --- fenêtre des réglages
  ipcMain.handle('ps:settings:get', async (event) => {
    if (!trustedSettings(event)) throw refuse();
    const printers = (await (mainWindow ?? settingsWindow)?.webContents.getPrintersAsync()) ?? [];
    return {
      settings,
      printers: printers.map((p) => p.name),
      version: app.getVersion(),
      firstRun: !settings.serverUrl,
    };
  });
  ipcMain.handle('ps:settings:save', (event, value: unknown) => {
    if (!trustedSettings(event)) throw refuse();
    const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(String(input.serverUrl ?? ''));
    } catch (error) {
      throw new Error(error instanceof SettingsError ? error.message : 'Adresse invalide.', {
        cause: error,
      });
    }
    const previous = settings;
    settings = sanitizeSettings({ ...input, serverUrl });
    saveSettings(settings);
    applySettings(previous);
  });
  ipcMain.handle('ps:settings:test-print', async (event, value: unknown, format: unknown) => {
    if (!trustedSettings(event)) throw refuse();
    await testPage(sanitizeSettings(value), format === 'A4' ? 'A4' : 'TICKET');
  });
  ipcMain.handle('ps:settings:test-drawer', async (event, value: unknown) => {
    if (!trustedSettings(event)) throw refuse();
    await openCashDrawer(sanitizeSettings(value));
  });
  ipcMain.handle('ps:settings:close', (event) => {
    if (!trustedSettings(event)) throw refuse();
    settingsWindow?.close();
  });
}

// ------------------------------------------------------------------------- Menu, mises à jour
function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Poste',
      submenu: [
        { label: 'Réglages du poste…', accelerator: 'CmdOrCtrl+,', click: openSettingsWindow },
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        {
          label: 'Plein écran',
          accelerator: 'F11',
          click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
        },
        { label: 'Zoom avant', role: 'zoomIn' },
        { label: 'Zoom arrière', role: 'zoomOut' },
        { label: 'Taille réelle', role: 'resetZoom' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'Ouvrir le dossier des journaux',
          click: () => void shell.openPath(join(app.getPath('userData'), 'logs')),
        },
        { label: 'Rechercher une mise à jour', click: () => void checkForUpdates(true) },
        { type: 'separator' },
        { label: `PharmaStock ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function checkForUpdates(manual = false): Promise<void> {
  if (!app.isPackaged) {
    if (manual)
      void dialog.showMessageBox({
        message: 'Les mises à jour ne sont actives que dans la version installée.',
      });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (manual && !result?.isUpdateAvailable)
      void dialog.showMessageBox({ message: 'PharmaStock est à jour.' });
  } catch (error) {
    log(`Mise à jour : ${String(error)}`);
    if (manual)
      void dialog.showMessageBox({
        type: 'warning',
        message: 'Recherche de mise à jour impossible.',
        detail: String(error),
      });
  }
}

function setupUpdater(): void {
  autoUpdater.autoDownload = true;
  // L'installation à la fermeture est proposée par notre boîte de dialogue, pas faite en silence.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-downloaded', () => {
    updateReady = true;
    log('Mise à jour téléchargée : proposée à la fermeture.');
  });
  autoUpdater.on('error', (error) => log(`Mise à jour : ${String(error)}`));
  setTimeout(() => void checkForUpdates(), 30_000);
  setInterval(() => void checkForUpdates(), 4 * 60 * 60 * 1000);
}

// ------------------------------------------------------------------------- Démarrage
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    refreshToken = secret.read('refresh');
    deviceJson = secret.read('device');
    // Aucune autorisation (caméra, micro, géolocalisation…) : rien de tout cela n'est utile au poste.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    registerProtocol();
    registerIpc();
    buildMenu();
    createMainWindow();
    if (!settings.serverUrl) openSettingsWindow();
    if (app.isPackaged) setupUpdater();
    log(`Démarrage v${app.getVersion()} — serveur : ${settings.serverUrl || '(non configuré)'}`);
  });
}
