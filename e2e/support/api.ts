import pg from 'pg';
import { API_URL, DATABASE_URL, MAIL_URL, USERS } from './env.js';

/** Réponses JSON de l'API dans les scénarios : volontairement non typées (le contrat est celui de l'interface testée). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

export interface Device {
  id: string;
  token: string;
  name: string;
}

let counter = 0;
export const uniq = (prefix = 'E') =>
  `${prefix}${Date.now().toString(36).toUpperCase().slice(-5)}${++counter}`;

/** Accès direct à la base E2E (approbation de postes, vérifications). */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Enregistre un poste et l'approuve (sans passer par l'écran d'administration). */
export async function newDevice(name: string): Promise<Device> {
  const res = await fetch(`${API_URL}/devices/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Enregistrement du poste : HTTP ${res.status}`);
  const body = (await res.json()) as { id: string; token: string };
  await sql(`UPDATE devices SET status = 'APPROVED', approved_at = now() WHERE id = $1`, [body.id]);
  return { id: body.id, token: body.token, name };
}

/** Client HTTP authentifié : préparation des données de test hors du parcours vérifié. */
export class Api {
  token = '';
  constructor(readonly device: Device) {}

  static async login(user: keyof typeof USERS, deviceName = `Poste ${uniq('API')}`): Promise<Api> {
    const api = new Api(await newDevice(deviceName));
    const res = await api.raw('POST', '/auth/login', {
      username: USERS[user].username,
      password: USERS[user].password,
    });
    api.token = (res as { accessToken: string }).accessToken;
    return api;
  }

  private async raw(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-device-id': this.device.id,
        'x-device-token': this.device.token,
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
    return json;
  }

  get<T = Loose>(path: string): Promise<T> {
    return this.raw('GET', path) as Promise<T>;
  }
  post<T = Loose>(path: string, body: unknown = {}, headers?: Record<string, string>): Promise<T> {
    return this.raw('POST', path, body, headers) as Promise<T>;
  }
  put<T = Loose>(path: string, body: unknown = {}): Promise<T> {
    return this.raw('PUT', path, body) as Promise<T>;
  }
}

export interface Mail {
  receivedAt: string;
  from: string | null;
  to: string[];
  bcc: string[];
  subject: string;
  text: string;
  attachments: { filename: string; contentType: string; size: number; pdf: boolean }[];
}

export const mailbox = {
  async list(): Promise<Mail[]> {
    return (await fetch(`${MAIL_URL}/messages`)).json() as Promise<Mail[]>;
  },
  async clear(): Promise<void> {
    await fetch(`${MAIL_URL}/messages`, { method: 'DELETE' });
  },
  async smtp(up: boolean): Promise<void> {
    await fetch(`${MAIL_URL}/smtp/${up ? 'up' : 'down'}`, { method: 'POST' });
  },
  /** Attend un message correspondant au filtre (l'envoi est asynchrone : file d'attente). */
  async waitFor(match: (m: Mail) => boolean, timeoutMs = 60_000): Promise<Mail> {
    const start = Date.now();
    for (;;) {
      const found = (await this.list()).find(match);
      if (found) return found;
      if (Date.now() - start > timeoutMs) throw new Error('E-mail attendu non reçu.');
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
};
