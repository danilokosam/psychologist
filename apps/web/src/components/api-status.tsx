'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { healthCheckResponseSchema } from '@psych/types';

// The simplest possible proof that the browser can reach the Express API
// directly over HTTP, and that both sides agree on the response shape via
// the shared @psych/types package -- not just typed, but validated at
// runtime with the same Zod schema the API used to build the response.
export function ApiStatus() {
  const t = useTranslations('home');
  const [state, setState] = useState<
    { kind: 'checking' } | { kind: 'ok'; timestamp: string } | { kind: 'error' }
  >({ kind: 'checking' });

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${apiUrl}/health`)
      .then((res) => res.json())
      .then((body) => {
        const result = healthCheckResponseSchema.safeParse(body);
        if (!result.success) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'ok', timestamp: result.data.timestamp });
      })
      .catch(() => setState({ kind: 'error' }));
  }, []);

  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      {t('apiStatusLabel')}:{' '}
      {state.kind === 'checking' && t('apiStatusChecking')}
      {state.kind === 'ok' && t('apiStatusOk', { timestamp: state.timestamp })}
      {state.kind === 'error' && t('apiStatusError')}
    </p>
  );
}
