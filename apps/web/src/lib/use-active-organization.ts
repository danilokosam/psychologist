'use client';

import { useEffect, useState } from 'react';
import { accountResponseSchema, type MembershipRole } from '@psych/types';
import { apiFetch } from './api-client';
import { getStoredActiveOrganization, setStoredActiveOrganization } from './active-organization';

export type ActiveOrganization = { organizationId: string; name: string; role: MembershipRole };

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

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<ActiveOrganizationState> {
      const account = accountResponseSchema.parse(await apiFetch<unknown>('/me'));
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
        active: { organizationId: chosen.organizationId, name: current.organization.name, role: current.role },
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
  }, []);

  return state;
}
