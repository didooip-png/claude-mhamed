import { defineConfig } from '@playwright/test';

const API_PORT = process.env.E2E_API_PORT ?? '3300';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5273';
const MAIL_HTTP = process.env.E2E_MAIL_HTTP_PORT ?? '8026';

/**
 * Tests de bout en bout (§ Tests) : la vraie API (base `pharmastock_e2e` recréée à chaque
 * exécution), le vrai site (Vite) et une boîte de capture d'e-mails à la place de Mailpit.
 * Les scénarios s'exécutent l'un après l'autre : ils partagent la base.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Africa/Tunis',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'node support/start-api.mjs',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @pharmastock/web exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_PROXY: `http://127.0.0.1:${API_PORT}` },
    },
    {
      command: 'node support/mail-sink.mjs',
      url: `http://127.0.0.1:${MAIL_HTTP}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
});
