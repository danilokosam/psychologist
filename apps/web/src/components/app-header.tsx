'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ui } from '@/lib/ui';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

const SECTIONS = [
  { href: '/dashboard', key: 'dashboard' },
  { href: '/patients', key: 'patients' },
  { href: '/appointments', key: 'calendar' },
] as const;

/**
 * The app's one persistent navigation. Section links and sign-out appear
 * only inside the signed-in area (the proxy guarantees a session there);
 * public pages get just the brand, language and theme controls.
 */
export function AppHeader() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const signedInArea = SECTIONS.some((s) => pathname.startsWith(s.href));

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace('/login');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:flex-nowrap sm:px-6">
        <Link href={signedInArea ? '/dashboard' : '/'} className="flex items-center gap-2 font-semibold text-foreground">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">
            Ψ
          </span>
          <span className="hidden sm:inline">{t('brand')}</span>
        </Link>

        {signedInArea ? (
          <nav aria-label={t('label')} className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto">
            {SECTIONS.map((section) => {
              const active = pathname.startsWith(section.href);
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 ${
                    active ? 'bg-primary-soft text-primary-soft-foreground' : 'text-muted hover:bg-surface-muted hover:text-foreground'
                  }`}
                >
                  {t(section.key)}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          {signedInArea ? (
            <button type="button" onClick={() => void signOut()} className={`${ui.button.ghost} whitespace-nowrap`}>
              {t('signOut')}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
