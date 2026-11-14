import type { Session } from '@supabase/supabase-js';

/**
 * The name the user typed at sign-up, stored by Supabase in user_metadata
 * (see LoginForm). Only used to fill profiles.full_name the first time the
 * account is bootstrapped -- the profile, not the auth metadata, is the
 * application's source of truth afterwards. Returns undefined rather than
 * sending something the API's schema would reject (empty, or over 200 chars).
 */
export function fullNameFromSession(session: Session | null): string | undefined {
  const raw: unknown = session?.user.user_metadata?.full_name;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}
