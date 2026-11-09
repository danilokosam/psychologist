import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ApiStatus } from '@/components/api-status';

export default function Home() {
  const t = useTranslations('home');

  return (
    <div className="flex flex-col flex-1 items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        {t('title')}
      </h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">{t('subtitle')}</p>
      <ApiStatus />
      <Link
        href="/login"
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        {t('signIn')}
      </Link>
    </div>
  );
}
