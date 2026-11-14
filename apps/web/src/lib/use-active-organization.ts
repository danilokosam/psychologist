'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { accountResponseSchema, supportedLocaleSchema, type MembershipRole } from '@psych/types';
import { setLocaleCookie } from './locale';
import { apiFetch } from './api-client';
import { getStoredActiveOrganization, setStoredActiveOrganization } from './active-organization';

/** `userId` is the signed-in user -- e.g. to tell "my" clinical note from a colleague's. */
export type ActiveOrganization = { organizationId: string; name: string; role: MembershipRole; userId: string };

export type ActiveOrganizationState =
  | { kind: 'loading' }
  | { kind: 'ready'; active: ActiveOrganization }
  | { kind: 'none' }
  | { kind: 'error' };

/**
 * The organization the dashboard's switcher last selected, re-verified with
 * the API. The role returned comes from `/organizations/current`, i.e. from
 * the membership the server just checked -- it only decides what the UI
 * *offers* (e.g. the owner-only archive button); the API and RLS decide what
 * is *allowed*.
 *
 * Unlike the dashboard, this never bootstraps an account: a user who reaches
 * a deep link before ever visiting the dashboard gets `none` and a link
 * there.
 */
export function useActiveOrganization(): ActiveOrganizationState {
  const [state, setState] = useState<ActiveOrganizationState>({ kind: 'loading' });
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<ActiveOrganizationState> {
      const account = accountResponseSchema.parse(await apiFetch<unknown>('/me'));

      // F-013, same as the dashboard: the saved preference outranks this
      // browser's cookie, also when the user lands here first (deep link,
      // or the login redirect back to /patients).
      const saved = supportedLocaleSchema.safeParse(account.profile.locale);
      if (saved.success && saved.data !== locale) {
        setLocaleCookie(saved.data);
        router.refresh();
      }
      const usable = account.memberships.filter((m) => m.status === 'active');
      const stored = getStoredActiveOrganization();
      const chosen = usable.find((m) => m.organizationId === stored) ?? usable[0];
      if (!chosen) return { kind: 'none' };

      const current = await apiFetch<{ organization: { name: string }; role: MembershipRole }>(
        '/organizations/current',
        { organizationId: chosen.organizationId },
      );
      setStoredActiveOrganization(chosen.organizationId);
      return {
        kind: 'ready',
        active: {
          organizationId: chosen.organizationId,
          name: current.organization.name,
          role: current.role,
          userId: account.profile.id,
        },
      };
    }

    load().then(
      (next) => {
        if (!cancelled) setState(next);
      },
      () => {
        if (!cancelled) setState({ kind: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale, router]);

  return state;
}
