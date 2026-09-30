import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env') && !process.env.VITEST) process.loadEnvFile('.env');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, { error: 'JWT_ACCESS_SECRET : 32 caractères minimum' }),
  /** Clé AES-256-GCM (64 caractères hexadécimaux) pour les secrets en base (mot de passe SMTP, TOTP). */
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, { error: 'APP_ENCRYPTION_KEY : 64 caractères hexadécimaux' }),
  /** URL publique du site (liens dans les e-mails). */
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** Origines autorisées (CORS), séparées par des virgules. Vide = même origine uniquement. */
  CORS_ORIGINS: z.string().default(''),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  STORAGE_DIR: z.string().default('./storage'),
  BACKUP_DIR: z.string().default('./storage/backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  /** Heure locale (HH:MM) de la sauvegarde quotidienne. */
  BACKUP_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'BACKUP_TIME : HH:MM' })
    .default('01:30'),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  PG_RESTORE_PATH: z.string().default('pg_restore'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Désactive les tâches planifiées (tests, instances secondaires). */
  DISABLE_SCHEDULER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema> & {
  cookieSecure: boolean;
  isProduction: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration invalide (variables d'environnement) :\n${details}`);
  }
  const env = parsed.data;
  cached = {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  };
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}
