export const API_PORT = process.env.E2E_API_PORT ?? '3300';
export const WEB_PORT = process.env.E2E_WEB_PORT ?? '5273';
export const MAIL_HTTP_PORT = process.env.E2E_MAIL_HTTP_PORT ?? '8026';
export const SMTP_PORT = process.env.SMTP_PORT ?? '2525';
export const API_URL = `http://127.0.0.1:${API_PORT}/api/v1`;
export const MAIL_URL = `http://127.0.0.1:${MAIL_HTTP_PORT}`;
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://pharmastock:pharmastock@localhost:5432/pharmastock_e2e?schema=public';

export const USERS = {
  admin: { code: 'ADM01', username: 'admin', password: 'Admin2026', pin: '1234' },
  pre01: { code: 'PRE01', username: 'pre01', password: 'Prep2026', pin: '1111' },
  pre02: { code: 'PRE02', username: 'pre02', password: 'Prep2026', pin: '2222' },
} as const;
