import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ApiStatus } from '@/components/api-status';
import { ui } from '@/lib/ui';

export default function Home() {
  const t = useTranslations('home');

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <span aria-hidden="true" className="grid size-14 place-items-center rounded-2xl bg-primary text-2xl text-primary-foreground shadow-sm">
        Ψ
      </span>
      <div className="max-w-xl space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-lg text-muted">{t('subtitle')}</p>
      </div>
      <Link href="/login" className={`${ui.button.primary} px-6 py-2.5 text-base`}>
        {t('signIn')}
      </Link>
      <ApiStatus />
    </main>
  );
}
