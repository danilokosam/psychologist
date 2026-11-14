'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  createInvitationResponseSchema,
  listInvitationsResponseSchema,
  type InvitableRole,
  type Invitation,
} from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ui } from '@/lib/ui';
import { Alert } from './ui/feedback';

/**
 * Owner-only team management: invite by email, see pending invitations,
 * revoke them (ADR-0013).
 *
 * Rendering this only for owners is a UX nicety, not the control: the API's
 * requireRole(PERMISSIONS['organization.manage']) and the invitations RLS
 * policies both reject everyone else regardless of what the UI shows.
 */
export function InvitationsPanel({ organizationId }: { organizationId: string }) {
  const t = useTranslations('invitations');
  const tRoles = useTranslations('roles');
  const format = useFormatter();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  // When the list was fetched; "expired" is judged against this rather than
  // the clock at render time, which keeps rendering pure.
  const [loadedAt, setLoadedAt] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('psychologist');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchInvitations = useCallback(async () => {
    const raw = await apiFetch<unknown>('/organizations/current/invitations', { organizationId });
    return listInvitationsResponseSchema.parse(raw).invitations;
  }, [organizationId]);

  const load = useCallback(async () => {
    setInvitations(await fetchInvitations());
    setLoadedAt(Date.now());
  }, [fetchInvitations]);

  useEffect(() => {
    let cancelled = false;
    fetchInvitations().then(
      (list) => {
        if (cancelled) return;
        setInvitations(list);
        setLoadedAt(Date.now());
      },
      () => {
        if (!cancelled) setError(t('loadFailed'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchInvitations, t]);

  async function onInvite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setLink(null);
    setCopied(false);
    try {
      const raw = await apiFetch<unknown>('/organizations/current/invitations', {
        method: 'POST',
        organizationId,
        body: { email, role },
      });
      const { token } = createInvitationResponseSchema.parse(raw);
      // The token travels in the URL *fragment*, which browsers never send to
      // a server -- so it can't end up in access logs or a Referer header.
      setLink(`${window.location.origin}/invitations/accept#token=${token}`);
      setEmail('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? t('duplicate') : t('createFailed'));
    } finally {
      setPending(false);
    }
  }

  async function onRevoke(invitationId: string) {
    setError(null);
    try {
      await apiFetch<void>(`/organizations/current/invitations/${invitationId}`, {
        method: 'DELETE',
        organizationId,
      });
      await load();
    } catch {
      setError(t('revokeFailed'));
    }
  }

  async function onCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <section className={`${ui.card} space-y-4`}>
      <div className="space-y-1">
        <h2 className={ui.h2}>{t('title')}</h2>
        <p className={ui.muted}>{t('description')}</p>
      </div>

      <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1.5">
          <label htmlFor="invite-email" className={ui.label}>
            {t('email')}
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={ui.input}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className={ui.label}>
            {t('role')}
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as InvitableRole)}
            className={ui.input}
          >
            <option value="psychologist">{tRoles('psychologist')}</option>
            <option value="admin_staff">{tRoles('admin_staff')}</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className={ui.button.primary}
        >
          {pending ? t('sending') : t('invite')}
        </button>
      </form>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}

      {link ? (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-foreground">
          <p>{t('linkReady')}</p>
          <code className="block break-all rounded-md bg-surface px-2 py-1 font-mono text-xs">{link}</code>
          <button type="button" onClick={onCopy} className={ui.button.secondary}>
            {copied ? t('copied') : t('copy')}
          </button>
        </div>
      ) : null}

      {invitations.length === 0 ? (
        <p className={ui.muted}>{t('none')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {invitations.map((invitation) => {
            const expired = new Date(invitation.expiresAt).getTime() <= loadedAt;
            return (
              <li key={invitation.id} className="flex items-center justify-between gap-4 py-2">
                <div>
                  <p className="font-medium">{invitation.email}</p>
                  <p className="text-muted">
                    {tRoles(invitation.role)} ·{' '}
                    {expired
                      ? t('expired')
                      : t('expires', {
                          date: format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' }),
                        })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(invitation.id)}
                  className={ui.button.danger}
                >
                  {t('revoke')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
