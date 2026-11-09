import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Provides the configuration the app validates at import time, so unit
    // tests don't need a real database or Supabase project.
    setupFiles: ['./vitest.setup.ts'],
  },
});
