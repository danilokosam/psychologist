import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for browser (client component) use.
 *
 * Uses the PUBLISHABLE key, which is designed to be shipped to browsers. The
 * secret/service_role key must never appear in this app at all -- anything
 * prefixed NEXT_PUBLIC_ is compiled into the client bundle.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
