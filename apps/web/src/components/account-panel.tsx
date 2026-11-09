'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { accountResponseSchema, type AccountResponse } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; account: AccountResponse; organizationName: string | null }
  | { kind: 'error'; message: string };

/**
 * Bootstraps the signed-in user's account and shows what the API returned.
 *
 * The POST is idempotent by design (see the bootstrapAccount use case), so
 * calling it on every visit is deliberate -- it avoids the frontend having to
 * track whether this is a first sign-in.
 */
export function AccountPanel() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const raw = await apiFetch<unknown>('/auth/bootstrap', {
          method: 'POST',
          body: { organizationName: t('defaultPracticeName') },
        });
        const account = accountResponseSchema.parse(raw);

        // Read the active organization back through the org-scoped endpoint,
        // which is what exercises tenant context + RLS end to end.
        const active = account.memberships[0];
        let organizationName: string | null = null;
        if (active) {
          const current = await apiFetch<{ organization: { name: string } }>(
            '/organizations/current',
            { organizationId: active.organizationId },
          );
          organizationName = current.organization.name;
        }

        if (!cancelled) setState({ kind: 'ready', account, organizationName });
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
  }, [t]);

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace('/login');
  }

  return (
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
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">{t('practice')}</dt>
            <dd className="font-medium">{state.organizationName ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">{t('role')}</dt>
            <dd className="font-medium">{state.account.memberships[0]?.role ?? '—'}</dd>
          </div>
        </dl>
      ) : null}

      <button
        type="button"
        onClick={signOut}
        className="text-sm text-zinc-600 underline dark:text-zinc-400"
      >
        {t('signOut')}
      </button>
    </div>
  );
}
