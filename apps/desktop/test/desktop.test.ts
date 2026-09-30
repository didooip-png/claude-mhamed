import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, sanitizeSettings } from '../src/config.js';
import { openDrawerCommand } from '../src/escpos.js';
import { checkPrintOptions } from '../src/printing.js';
import { mimeFor, resolveAppFile } from '../src/protocol.js';
import { refreshCookieChange, upstreamHeaders, upstreamUrl } from '../src/proxy.js';
import { encodePowerShell, RAW_PRINT_SCRIPT } from '../src/raw-print.js';

describe('adresse du serveur', () => {
  it('ajoute https:// et ne garde que l’origine', () => {
    expect(normalizeServerUrl('pharmacie.exemple.tn')).toBe('https://pharmacie.exemple.tn');
    expect(normalizeServerUrl(' https://pharmacie.exemple.tn/app/?x=1 ')).toBe(
      'https://pharmacie.exemple.tn',
    );
    expect(normalizeServerUrl('https://pharma.tn:8443/')).toBe('https://pharma.tn:8443');
  });
  it('n’accepte http que sur le réseau local', () => {
    expect(normalizeServerUrl('http://192.168.1.20')).toBe('http://192.168.1.20');
    expect(normalizeServerUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => normalizeServerUrl('http://pharmacie.exemple.tn')).toThrow(/https/);
  });
  it('refuse les adresses invalides', () => {
    expect(() => normalizeServerUrl('')).toThrow();
    expect(() => normalizeServerUrl('ftp://serveur')).toThrow();
    expect(() => normalizeServerUrl('https://admin:secret@serveur.tn')).toThrow(/identifiant/);
  });
  it('assainit des réglages corrompus', () => {
    const s = sanitizeSettings({
      serverUrl: 'n’importe quoi ://',
      ticketPrinter: 42,
      fullscreen: 'oui',
      autoStart: true,
    });
    expect(s).toEqual({
      serverUrl: '',
      ticketPrinter: '',
      a4Printer: '',
      fullscreen: false,
      autoStart: true,
    });
  });
});

describe('protocole app://', () => {
  const root = '/opt/app/renderer';
  it('sert les fichiers et renvoie index.html pour les routes du site', () => {
    expect(resolveAppFile(root, '/assets/app-1a2b.js')).toBe(
      '/opt/app/renderer/assets/app-1a2b.js',
    );
    expect(resolveAppFile(root, '/')).toBe('/opt/app/renderer/index.html');
    expect(resolveAppFile(root, '/sales/123')).toBe('/opt/app/renderer/index.html');
  });
  it('refuse toute sortie du dossier', () => {
    for (const bad of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/a/../../b.js',
      '/..%2f..%2fetc/passwd',
      '/a\\..\\b.js',
      '/x%00.js',
    ])
      expect(resolveAppFile(root, bad), bad).toBeNull();
  });
  it('déclare les bons types', () => {
    expect(mimeFor('a.js')).toContain('javascript');
    expect(mimeFor('a.woff2')).toBe('font/woff2');
    expect(mimeFor('a.xyz')).toBe('application/octet-stream');
  });
});

describe('relais vers l’API', () => {
  it('ne relaie que /api/', () => {
    expect(upstreamUrl('https://s.tn', 'app://pharmastock/api/v1/sales?x=1')).toBe(
      'https://s.tn/api/v1/sales?x=1',
    );
    expect(upstreamUrl('https://s.tn', 'app://pharmastock/sales')).toBeNull();
  });
  it('transmet une liste blanche d’en-têtes, jamais Origin ni Cookie', () => {
    const h = upstreamHeaders(
      [
        ['Origin', 'app://pharmastock'],
        ['Cookie', 'x=1'],
        ['Authorization', 'Bearer t'],
        ['X-Device-Id', 'd'],
        ['Referer', 'app://x'],
      ],
      '/api/v1/sales',
      'refresh-secret',
    );
    expect(h).toMatchObject({ authorization: 'Bearer t', 'x-device-id': 'd' });
    expect(h.origin).toBeUndefined();
    expect(h.referer).toBeUndefined();
    expect(h.cookie).toBeUndefined();
  });
  it('n’ajoute le cookie de renouvellement que sur /api/v1/auth', () => {
    expect(upstreamHeaders([], '/api/v1/auth/refresh', 'tok').cookie).toBe('ps_refresh=tok');
    expect(upstreamHeaders([], '/api/v1/sales', 'tok').cookie).toBeUndefined();
    expect(upstreamHeaders([], '/api/v1/auth/refresh', null).cookie).toBeUndefined();
  });
  it('lit la pose et l’effacement du cookie', () => {
    expect(
      refreshCookieChange([
        'ps_refresh=abc; Max-Age=86400; Path=/api/v1/auth; HttpOnly; SameSite=Strict',
      ]),
    ).toEqual({ kind: 'set', value: 'abc' });
    expect(
      refreshCookieChange([
        'ps_refresh=; Path=/api/v1/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ]),
    ).toEqual({ kind: 'clear' });
    expect(refreshCookieChange(['autre=1'])).toBeNull();
    expect(refreshCookieChange([])).toBeNull();
  });
});

describe('impression et tiroir-caisse', () => {
  it('valide les options venues du site', () => {
    expect(checkPrintOptions({ format: 'A4', copies: 2 })).toEqual({ format: 'A4', copies: 2 });
    expect(checkPrintOptions({ format: 'zzz', copies: 999 })).toEqual({
      format: 'TICKET',
      copies: 5,
    });
    expect(checkPrintOptions(null)).toEqual({ format: 'TICKET', copies: 1 });
  });
  it('envoie la commande ESC/POS d’ouverture du tiroir', () => {
    expect([...openDrawerCommand()]).toEqual([0x1b, 0x70, 0x00, 0x32, 0xc8]);
  });
  it('n’interpole jamais le nom de l’imprimante dans le script PowerShell', () => {
    expect(RAW_PRINT_SCRIPT).toContain('$env:PS_PRINTER');
    expect(RAW_PRINT_SCRIPT).toContain('$env:PS_DATA_FILE');
    const decoded = Buffer.from(encodePowerShell('Write-Output "é"'), 'base64').toString('utf16le');
    expect(decoded).toBe('Write-Output "é"');
  });
});
