import { errorMessage } from '@pharmastock/shared';
import { getDevice } from './device';
import { createStore } from './store';

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get fieldErrors(): Record<string, string> {
    return (this.details.fieldErrors as Record<string, string> | undefined) ?? {};
  }
}

// ---------------------------------------------------------------------------
// État de connexion (bandeau « Connexion perdue », §9)
// ---------------------------------------------------------------------------
export const connection = createStore<{ online: boolean; lastError: number | null }>({
  online: true,
  lastError: null,
});

function markOnline(online: boolean) {
  connection.set((s) =>
    s.online === online ? s : { online, lastError: online ? null : Date.now() },
  );
}

// ---------------------------------------------------------------------------
// Jeton d'accès (en mémoire uniquement) et événements d'authentification
// ---------------------------------------------------------------------------
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function hasAccessToken(): boolean {
  return accessToken !== null;
}

type AuthEvent = 'unauthenticated' | 'locked' | 'passwordChangeRequired' | 'deviceRejected';
const authListeners = new Set<(e: AuthEvent, code: string) => void>();
export function onAuthEvent(listener: (e: AuthEvent, code: string) => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}
function emit(event: AuthEvent, code: string) {
  authListeners.forEach((l) => l(event, code));
}

/** Renouvellement unique partagé entre requêtes concurrentes. */
let refreshing: Promise<boolean> | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;
export function setRefreshHandler(handler: () => Promise<boolean>): void {
  refreshHandler = handler;
}
export function refreshOnce(): Promise<boolean> {
  if (!refreshHandler) return Promise.resolve(false);
  refreshing ??= refreshHandler().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  idempotencyKey?: string;
  /** Requête d'arrière-plan (sondage) : ne compte pas comme activité de l'utilisateur. */
  background?: boolean;
  /** Pas de tentative de renouvellement automatique (routes d'authentification). */
  noRefresh?: boolean;
  signal?: AbortSignal;
  responseType?: 'json' | 'blob';
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const device = getDevice();
  if (device) {
    headers['X-Device-Id'] = device.id;
    headers['X-Device-Token'] = device.token;
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.background) headers['X-Background'] = '1';
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) body = options.body;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    markOnline(false);
    throw new ApiError(
      0,
      'NETWORK',
      'Connexion au serveur impossible. Vérifiez la connexion Internet.',
    );
  }
  if (res.status >= 500 && res.status !== 503) markOnline(true);
  else if (res.status === 502 || res.status === 503 || res.status === 504) markOnline(false);
  else markOnline(true);

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    if (options.responseType === 'blob') return (await res.blob()) as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  let payload: { code?: string; message?: string; details?: Record<string, unknown> } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    /* réponse non JSON */
  }
  const code = payload.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR');
  const error = new ApiError(
    res.status,
    code,
    payload.message ?? errorMessage(code),
    payload.details ?? {},
  );

  if (code === 'UNAUTHENTICATED' && !options.noRefresh && !retried) {
    if (await refreshOnce()) return apiRequest<T>(method, path, options, true);
    emit('unauthenticated', code);
  } else if (code === 'SCREEN_LOCKED') {
    emit('locked', code);
  } else if (code === 'PASSWORD_CHANGE_REQUIRED') {
    emit('passwordChangeRequired', code);
  } else if (code === 'DEVICE_UNKNOWN' || code === 'DEVICE_REVOKED' || code === 'DEVICE_PENDING') {
    emit('deviceRejected', code);
  }
  throw error;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>('DELETE', path, options),
  blob: (path: string, options?: RequestOptions) =>
    apiRequest<Blob>('GET', path, { ...options, responseType: 'blob' }),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Message d'erreur lisible pour l'utilisateur. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = Object.values(err.fieldErrors);
    return fields.length > 0 && err.code === 'VALIDATION_ERROR'
      ? `${err.message} ${fields.slice(0, 3).join(' · ')}`
      : err.message;
  }
  return 'Erreur inattendue.';
}
