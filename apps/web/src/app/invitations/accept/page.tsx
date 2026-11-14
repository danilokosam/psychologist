import { useTranslations } from 'next-intl';
import { AcceptInvitation } from '@/components/accept-invitation';

// Deliberately not in the proxy's protected prefixes: an unauthenticated
// visitor must first land here so the token can be saved from the URL
// fragment (which a server-side redirect would never see) before being sent
// to sign in. The component handles that redirect itself.
export default function AcceptInvitationPage() {
  const t = useTranslations('acceptInvitation');

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <AcceptInvitation />
      </div>
    </main>
  );
}
