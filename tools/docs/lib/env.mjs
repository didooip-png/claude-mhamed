import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const TOOL_DIR = resolve(ROOT, 'tools/docs');
export const CACHE_DIR = resolve(TOOL_DIR, '.cache');
export const SHOTS_DIR = resolve(CACHE_DIR, 'shots');
export const OUT_DIR = resolve(ROOT, 'docs/manuels');
export const WEB_PUBLIC_DIR = resolve(ROOT, 'apps/web/public/manuels');

export const API_PORT = process.env.DOCS_API_PORT ?? '3400';
export const WEB_PORT = process.env.DOCS_WEB_PORT ?? '5373';
export const SMTP_SINK_PORT = process.env.DOCS_SMTP_PORT ?? '2526';
export const SINK_HTTP_PORT = process.env.DOCS_SINK_HTTP_PORT ?? '8027';
export const API_URL = `http://127.0.0.1:${API_PORT}/api/v1`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const DATABASE_URL =
  process.env.DOCS_DATABASE_URL ??
  'postgresql://pharmastock:pharmastock@localhost:5432/pharmastock_docs?schema=public';

/** Version imprimée sur la couverture des documents. */
export const DOC_VERSION = process.env.DOCS_VERSION ?? '1.0';

export const USERS = {
  ADMIN: { code: 'ADM01', username: 'admin', password: 'Admin2026', pin: '1234' },
  PREPARER: { code: 'PRE01', username: 'pre01', password: 'Prep2026', pin: '1111' },
};

export const chromiumPath = () => process.env.DOCS_CHROMIUM_PATH ?? process.env.E2E_CHROMIUM_PATH;
