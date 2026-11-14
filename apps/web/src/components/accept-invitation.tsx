'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { acceptInvitationResponseSchema } from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { setStoredActiveOrganization } from '@/lib/active-organization';
import { fullNameFromSession } from '@/lib/full-name';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ui } from '@/lib/ui';

type State = 'working' | 'accepted' | 'invalid' | 'alreadyMember' | 'missing' | 'error';

// Survives the detour through /login (the fragment itself does not: the
// login redirect only carries the path). sessionStorage, not localStorage,
// so a token never outlives the tab it was opened in.
const TOKEN_KEY = 'pendingInvitationToken';

/**
 * Accepts an invitation link (ADR-0013). The token arrives in the URL
 * fragment, is moved to sessionStorage and stripped from the address bar
 * immediately, so it doesn't linger in history or get copied along with the
 * URL.
 */
export function AcceptInvitation() {
  const t = useTranslations('acceptInvitation');
  const router = useRouter();
  const [state, setState] = useState<State>('working');
  // React's development Strict Mode runs effects twice; a second POST would
  // race the first and report a misleading "invalid".
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function run() {
      const fromFragment = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (fromFragment) {
        window.sessionStorage.setItem(TOKEN_KEY, fromFragment);
        window.history.replaceState(null, '', window.location.pathname);
      }
      const token = window.sessionStorage.getItem(TOKEN_KEY);
      if (!token) {
        setState('missing');
        return;
      }

      const {
        data: { session },
      } = await createSupabaseBrowserClient().auth.getSession();
      if (!session) {
        router.replace('/login?next=/invitations/accept');
        return;
      }

      try {
        const raw = await apiFetch<unknown>('/invitations/accept', {
          method: 'POST',
          // Accepting may create the profile (an invitee going straight to
          // the link), so the sign-up name is passed here too.
          body: { token, fullName: fullNameFromSession(session) },
        });
        const { organizationId } = acceptInvitationResponseSchema.parse(raw);
        window.sessionStorage.removeItem(TOKEN_KEY);
        setStoredActiveOrganization(organizationId);
        setState('accepted');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
          window.sessionStorage.removeItem(TOKEN_KEY);
          setState(error.status === 404 ? 'invalid' : 'alreadyMember');
          return;
        }
        setState('error');
      }
    }

    void run();
  }, [router]);

  // Opening a second invitation link while this page is already open (same
  // path, different #fragment) is not a navigation -- the browser only fires
  // `hashchange`, so the effect above would never see the new token. Found
  // in the Milestone 1 browser pass. Reload so it runs from scratch.
  useEffect(() => {
    function onHashChange() {
      if (new URLSearchParams(window.location.hash.slice(1)).has('token')) {
        window.location.reload();
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="space-y-4">
      <p className={state === 'invalid' || state === 'error' ? 'text-sm text-danger' : 'text-sm text-foreground'}>
        {t(state)}
      </p>
      {state === 'accepted' || state === 'alreadyMember' ? (
        <Link
          href="/dashboard"
          className={ui.button.primary}
        >
          {t('goToDashboard')}
        </Link>
      ) : null}
    </div>
  );
}
