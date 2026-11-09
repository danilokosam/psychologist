// `src/env.ts` validates configuration at import time and exits the process
// if anything is missing -- deliberately strict for production. Tests supply
// syntactically valid placeholders so that import succeeds; nothing here
// points at a real database or Supabase project, and the tests in this suite
// never open a connection.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.SUPABASE_URL ??= 'https://test-project.supabase.co';
process.env.NODE_ENV ??= 'test';
