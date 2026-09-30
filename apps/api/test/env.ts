/** Variables d'environnement des tests (base PostgreSQL dédiée). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://pharmastock:pharmastock@localhost:5432/pharmastock_test?schema=public';

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123456789';
  process.env.APP_ENCRYPTION_KEY = '1'.repeat(64);
  process.env.APP_PUBLIC_URL = 'http://localhost:5173';
  process.env.DISABLE_SCHEDULER = 'true';
  process.env.LOG_LEVEL = 'silent';
  process.env.STORAGE_DIR = './storage-test';
  process.env.BACKUP_DIR = './storage-test/backups';
}
