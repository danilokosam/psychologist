'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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
      setError(result.error.message);
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
        <div className="space-y-1">
          <label htmlFor="full-name" className="block text-sm font-medium">
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
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      ) : null}
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium">
          {t('email')}
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium">
          {t('password')}
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{notice}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
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
        className="w-full text-sm text-zinc-600 underline dark:text-zinc-400"
      >
        {mode === 'signIn' ? t('switchToSignUp') : t('switchToSignIn')}
      </button>
    </form>
  );
}
