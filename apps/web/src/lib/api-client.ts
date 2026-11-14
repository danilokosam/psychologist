import { createSupabaseBrowserClient } from './supabase/client';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Sent as X-Organization-Id; required by org-scoped endpoints. */
  organizationId?: string;
};

/**
 * Calls the Express API from the browser with the caller's Supabase access
 * token attached.
 *
 * This is the only way the frontend reaches data: it never touches Prisma or
 * Postgres directly (docs/ARCHITECTURE.md). The token is read fresh from the
 * Supabase client on each call so a refreshed session is picked up
 * automatically.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Not signed in');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.organizationId) {
    headers['X-Organization-Id'] = options.organizationId;
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? 'Request failed',
    );
  }

  // 204 No Content (e.g. revoking an invitation) has no body to parse.
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
