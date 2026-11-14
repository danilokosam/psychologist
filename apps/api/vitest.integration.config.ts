import { defineConfig } from 'vitest/config';

// Integration suite: real Postgres (docker-compose.test.yml), real RLS, real
// token verification against a local JWKS endpoint. Kept separate from the
// unit suite so `pnpm test` stays fast and needs no Docker.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['./test/integration/global-setup.ts'],
    setupFiles: ['./test/integration/setup-env.ts'],
    // One shared database: files must not truncate each other's fixtures.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
