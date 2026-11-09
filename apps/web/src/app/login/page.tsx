import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  const t = useTranslations('auth');

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-black">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            {t('title')}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('subtitle')}</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
