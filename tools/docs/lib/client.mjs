import pg from 'pg';
import { API_URL, DATABASE_URL, USERS } from './env.mjs';

async function sql(text, params = []) {
  const client = new pg.Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

/** Poste enregistré et approuvé (comme le ferait un administrateur depuis « Postes de travail »). */
export async function newDevice(name) {
  const res = await fetch(`${API_URL}/devices/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Enregistrement du poste : HTTP ${res.status}`);
  const body = await res.json();
  await sql(`UPDATE devices SET status = 'APPROVED', approved_at = now() WHERE id = $1`, [body.id]);
  return { id: body.id, token: body.token, name };
}

/** Client HTTP authentifié, pour préparer l'état d'une scène sans passer par l'interface. */
export class Api {
  constructor(device, token = '') {
    this.device = device;
    this.token = token;
  }

  static async login(role, deviceName) {
    const api = new Api(await newDevice(deviceName));
    const u = USERS[role];
    const res = await api.call('POST', '/auth/login', {
      username: u.username,
      password: u.password,
    });
    api.token = res.accessToken;
    return api;
  }

  async call(method, path, body, headers = {}) {
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
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    return data;
  }

  get = (path) => this.call('GET', path);
  post = (path, body, headers) => this.call('POST', path, body ?? {}, headers);
  put = (path, body) => this.call('PUT', path, body ?? {});
}
