'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { supportedLocaleSchema, type SupportedLocale } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { setLocaleCookie } from '@/lib/locale';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const LABELS: Record<SupportedLocale, string> = { en: 'English', es: 'Español' };

/**
 * The Core-MVP language control (F-013): small, always reachable. Switching
 * updates the UI at once (cookie + server re-render) and, when signed in,
 * persists the choice to profiles.locale so it follows the user to other
 * devices. Language names are shown in their own language on purpose -- a
 * user stuck in a language they can't read must still recognise their own.
 */
export function LocaleSwitcher() {
  const t = useTranslations('locale');
  const current = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function onChange(value: string) {
    const parsed = supportedLocaleSchema.safeParse(value);
    if (!parsed.success) return;
    setLocaleCookie(parsed.data);

    const {
      data: { session },
    } = await createSupabaseBrowserClient().auth.getSession();
    if (session) {
      // Best effort: the UI has already switched via the cookie; if this
      // fails, the preference just isn't carried to other devices yet.
      await apiFetch('/me', { method: 'PATCH', body: { locale: parsed.data } }).catch(() => {});
    }

    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center text-sm text-muted">
      <span className="sr-only">{t('label')}</span>
      <select
        aria-label={t('label')}
        value={current}
        disabled={isPending}
        onChange={(event) => void onChange(event.target.value)}
        className="rounded-lg border border-border bg-surface-muted px-2 py-1.5 text-sm font-medium text-foreground transition-colors duration-150 hover:border-border-strong disabled:opacity-50"
      >
        {supportedLocaleSchema.options.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LABELS[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
