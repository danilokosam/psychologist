import { env } from './env';
import { createApp } from './app';
import { assertNoBypassRls } from './shared/db/assert-no-bypass-rls';

async function start() {
  // Checked before accepting a single request: if the configured database
  // role can bypass Row Level Security, every tenant-isolation guarantee in
  // docs/SECURITY.md is void, and the failure would otherwise be invisible.
  await assertNoBypassRls();

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
}

start().catch((error: unknown) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
