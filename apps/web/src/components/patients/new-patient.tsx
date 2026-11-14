'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { patientResponseSchema } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { PatientForm, type PatientFormValues } from './patient-form';

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
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('saveFailed')}
        </p>
      ) : null}
      <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <PatientForm submitLabel={t('create')} onSubmit={create} />
      </div>
    </div>
  );
}
