'use client';

import { use } from 'react';
import { SessionDetail } from '@/components/clinical/session-detail';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { ui } from '@/lib/ui';

export default function SessionPage({ params }: PageProps<'/clinical-sessions/[sessionId]'>) {
  const { sessionId } = use(params);

  return (
    <main className={`${ui.page} max-w-3xl`}>
      <WithActiveOrganization>
        {(active) => (
          <SessionDetail
            key={`${active.organizationId}:${sessionId}`}
            organizationId={active.organizationId}
            sessionId={sessionId}
            role={active.role}
            userId={active.userId}
          />
        )}
      </WithActiveOrganization>
    </main>
  );
}
