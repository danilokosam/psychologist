'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ui } from '@/lib/ui';
import { Alert } from './ui/feedback';

type Mode = 'signIn' | 'signUp';

/**
 * Minimal email/password authentication against Supabase Auth.
 *
 * Deliberately unpolished: Milestone 0 needs sign-up and sign-in to genuinely
 * work end to end, not a finished auth experience. Password recovery (F-002)
 * and a designed layout come with the real feature work.
 */
export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const supabase = createSupabaseBrowserClient();
    const result =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            // Kept in Supabase's user_metadata until the first sign-in, when
            // /auth/bootstrap copies it into profiles.full_name (see
            // fullNameFromSession). With email confirmation on there is no
            // session yet at this point, so it can't be sent to the API now.
            options: { data: { full_name: fullName.trim() } },
          });

    if (result.error) {
      // The project's password policy (min 10 chars, upper + lower + digit +
      // symbol -- see docs/SECURITY.md) is enforced by Supabase Auth; show
      // the rule in the user's language instead of Supabase's English text.
      setError(result.error.code === 'weak_password' ? t('weakPassword') : result.error.message);
      setPending(false);
      return;
    }

    // Sign-up returns no session when the project requires email
    // confirmation; there is nothing to redirect to in that case.
    if (!result.data.session) {
      setNotice(t('checkYourEmail'));
      setPending(false);
      return;
    }

    router.replace(searchParams.get('next') ?? '/dashboard');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === 'signUp' ? (
        <div className="space-y-1.5">
          <label htmlFor="full-name" className={ui.label}>
            {t('fullName')}
          </label>
          <input
            id="full-name"
            type="text"
            required
            maxLength={200}
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={ui.input}
          />
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="email" className={ui.label}>
          {t('email')}
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={ui.input}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className={ui.label}>
          {t('password')}
        </label>
        <input
          id="password"
          type="password"
          required
          // Only enforced client-side when choosing a password; at sign-in
          // the server is the judge (older accounts may predate the policy).
          minLength={mode === 'signUp' ? 10 : undefined}
          aria-describedby={mode === 'signUp' ? 'password-rule' : undefined}
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={ui.input}
        />
        {mode === 'signUp' ? (
          <p id="password-rule" className="text-xs text-muted">
            {t('passwordRule')}
          </p>
        ) : null}
      </div>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <button
        type="submit"
        disabled={pending}
        className={`${ui.button.primary} w-full`}
      >
        {pending ? t('pending') : mode === 'signIn' ? t('signIn') : t('signUp')}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          setError(null);
          setNotice(null);
        }}
        className={`${ui.link} w-full text-sm`}
      >
        {mode === 'signIn' ? t('switchToSignUp') : t('switchToSignIn')}
      </button>
    </form>
  );
}
