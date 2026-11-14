'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { patientResponseSchema } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { PatientForm, type PatientFormValues } from './patient-form';
import { ui } from '@/lib/ui';
import { Alert } from '../ui/feedback';

export function NewPatient({ organizationId }: { organizationId: string }) {
  const t = useTranslations('patients');
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  async function create(values: PatientFormValues) {
    setFailed(false);
    try {
      const raw = await apiFetch<unknown>('/patients', { method: 'POST', organizationId, body: values });
      router.push(`/patients/${patientResponseSchema.parse(raw).patient.id}`);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-3">
      {failed ? (
        <Alert tone="danger">{t('saveFailed')}</Alert>
      ) : null}
      <div className={ui.card}>
        <PatientForm submitLabel={t('create')} onSubmit={create} />
      </div>
    </div>
  );
}
