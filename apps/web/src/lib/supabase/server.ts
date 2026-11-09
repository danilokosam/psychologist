import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Supabase client for server components and route handlers.
 *
 * The session lives in cookies (rather than only in browser storage) so that
 * server-rendered pages know whether the visitor is signed in -- which is what
 * lets middleware redirect before any protected page renders, instead of the
 * page flashing unauthenticated content first.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components can't set cookies. Harmless here: the
            // middleware refreshes the session on every request, so a
            // read-only render never needs to write them.
          }
        },
      },
    },
  );
}
