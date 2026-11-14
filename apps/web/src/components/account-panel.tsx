'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  accountResponseSchema,
  supportedLocaleSchema,
  type AccountResponse,
  type MembershipRole,
} from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { setLocaleCookie } from '@/lib/locale';
import { getStoredActiveOrganization, setStoredActiveOrganization } from '@/lib/active-organization';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { InvitationsPanel } from './invitations-panel';

type Active = { organizationId: string; name: string; role: MembershipRole };

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; account: AccountResponse; active: Active | null }
  | { kind: 'error'; message: string };

/**
 * Bootstraps the signed-in user's account, picks the active organization, and
 * shows it -- with a switcher when the user belongs to more than one (F-003).
 *
 * The POST is idempotent by design (see the bootstrapAccount use case), so
 * calling it on every visit is deliberate -- it avoids the frontend having to
 * track whether this is a first sign-in.
 */
export function AccountPanel() {
  const t = useTranslations('dashboard');
  const tRoles = useTranslations('roles');
  const router = useRouter();
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: 'loading' });

  // The role shown (and whether the owner-only panel renders) comes from the
  // org-scoped endpoint, i.e. from the membership the API just verified --
  // not from the list cached in this component.
  const activate = useCallback(async (organizationId: string): Promise<Active> => {
    const current = await apiFetch<{ organization: { name: string }; role: MembershipRole }>(
      '/organizations/current',
      { organizationId },
    );
    setStoredActiveOrganization(organizationId);
    return { organizationId, name: current.organization.name, role: current.role };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const raw = await apiFetch<unknown>('/auth/bootstrap', {
          method: 'POST',
          body: { organizationName: t('defaultPracticeName') },
        });
        const account = accountResponseSchema.parse(raw);

        // F-013: the saved preference outranks this browser's cookie, which
        // is what makes a language chosen on one device apply on the next.
        const saved = supportedLocaleSchema.safeParse(account.profile.locale);
        if (saved.success && saved.data !== locale) {
          setLocaleCookie(saved.data);
          router.refresh();
        }

        const usable = account.memberships.filter((m) => m.status === 'active');
        const stored = getStoredActiveOrganization();
        // A remembered organization the user no longer belongs to is simply
        // ignored -- the server would answer 404 for it anyway.
        const chosen = usable.find((m) => m.organizationId === stored) ?? usable[0];
        const active = chosen ? await activate(chosen.organizationId) : null;

        if (!cancelled) setState({ kind: 'ready', account, active });
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown' });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [t, activate, locale, router]);

  async function onSwitch(organizationId: string) {
    if (state.kind !== 'ready') return;
    try {
      const active = await activate(organizationId);
      setState({ ...state, active });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown' });
    }
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace('/login');
  }

  const usable = state.kind === 'ready' ? state.account.memberships.filter((m) => m.status === 'active') : [];

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {state.kind === 'loading' ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('loading')}</p>
        ) : null}

        {state.kind === 'error' ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t('loadFailed', { message: state.message })}
          </p>
        ) : null}

        {state.kind === 'ready' ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-600 dark:text-zinc-400">{t('signedInAs')}</dt>
              <dd className="font-medium">{state.account.profile.fullName ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-600 dark:text-zinc-400">
                {usable.length > 1 ? <label htmlFor="active-organization">{t('practice')}</label> : t('practice')}
              </dt>
              <dd className="font-medium">
                {usable.length > 1 ? (
                  <select
                    id="active-organization"
                    value={state.active?.organizationId ?? ''}
                    onChange={(event) => void onSwitch(event.target.value)}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {usable.map((m) => (
                      // The role is shown too because names are not unique:
                      // every practice starts with the same default name, so
                      // "My practice" / "My practice" was indistinguishable
                      // (found in the Milestone 1 browser pass).
                      <option key={m.organizationId} value={m.organizationId}>
                        {t('organizationOption', { name: m.organization.name, role: tRoles(m.role) })}
                      </option>
                    ))}
                  </select>
                ) : (
                  (state.active?.name ?? '—')
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-600 dark:text-zinc-400">{t('role')}</dt>
              <dd className="font-medium">{state.active ? tRoles(state.active.role) : '—'}</dd>
            </div>
          </dl>
        ) : null}

        <button type="button" onClick={signOut} className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {t('signOut')}
        </button>
      </div>

      {state.kind === 'ready' && state.active?.role === 'owner' ? (
        // Keyed by organization so switching resets the panel's state.
        <InvitationsPanel key={state.active.organizationId} organizationId={state.active.organizationId} />
      ) : null}
    </div>
  );
}
