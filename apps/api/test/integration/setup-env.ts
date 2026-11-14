import { inject } from 'vitest';

// Runs in each test worker before any test file imports the app, so that
// src/env.ts (validated at import time) and the Prisma client (which reads
// DATABASE_URL when constructed) both see the throwaway database and the
// local JWKS endpoint -- never real credentials.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = inject('runtimeDatabaseUrl');
process.env.SUPABASE_URL = inject('supabaseUrl');
