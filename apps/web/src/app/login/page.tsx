import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/login-form';
import { ui } from '@/lib/ui';

export default function LoginPage() {
  const t = useTranslations('auth');

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className={`${ui.card} w-full max-w-sm space-y-6 p-6`}>
        <div className="space-y-1">
          <h1 className={ui.h1}>{t('title')}</h1>
          <p className={ui.muted}>{t('subtitle')}</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
