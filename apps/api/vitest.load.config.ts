import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Tests de charge légers (§ « Tenue en charge ») : 50 000 produits, ~1 million de mouvements,
 * 10 postes simultanés. Base dédiée `pharmastock_load` (recréée à chaque exécution).
 *   pnpm --filter @pharmastock/api test:load
 */
// La base de test des workers (test/env.ts) est la base de charge, jamais celle des tests normaux.
process.env.TEST_DATABASE_URL =
  process.env.LOAD_DATABASE_URL ??
  'postgresql://pharmastock:pharmastock@localhost:5432/pharmastock_load?schema=public';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
          useDefineForClassFields: false,
        },
        target: 'es2023',
        keepClassNames: true,
      },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['test/load/**/*.load.ts'],
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/load/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 900_000,
    pool: 'forks',
  },
});
