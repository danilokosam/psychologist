import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests only. The database-backed suite lives in test/integration
    // and runs via `pnpm test:integration` (vitest.integration.config.ts).
    include: ['src/**/*.test.ts'],
    // Provides the configuration the app validates at import time, so unit
    // tests don't need a real database or Supabase project.
    setupFiles: ['./vitest.setup.ts'],
  },
});
