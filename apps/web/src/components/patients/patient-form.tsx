'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  createPatientRequestSchema,
  type EditablePatientStatus,
  type Patient,
} from '@psych/types';

type Values = {
  fullName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  status: EditablePatientStatus;
};

const FIELDS = [
  'fullName',
  'dateOfBirth',
  'email',
  'phone',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;
type Field = (typeof FIELDS)[number];

const INPUT_TYPE: Record<Field, string> = {
  fullName: 'text',
  dateOfBirth: 'date',
  email: 'email',
  phone: 'tel',
  emergencyContactName: 'text',
  emergencyContactPhone: 'tel',
};

function initialValues(patient?: Patient): Values {
  return {
    fullName: patient?.fullName ?? '',
    dateOfBirth: patient?.dateOfBirth ?? '',
    email: patient?.email ?? '',
    phone: patient?.phone ?? '',
    emergencyContactName: patient?.emergencyContactName ?? '',
    emergencyContactPhone: patient?.emergencyContactPhone ?? '',
    status: patient && patient.status !== 'archived' ? patient.status : 'active',
  };
}

/**
 * Create/edit form. Validated with the same Zod schema the API uses
 * (packages/types), so the rules are written once; the API re-validates
 * regardless. Empty optional fields are sent as '' and become null.
 *
 * Deliberately no free-text "notes" field: anything typed here is visible to
 * administrative staff, and clinical content belongs in clinical notes
 * (Milestone 4), which they can never read (ADR-0014).
 */
export function PatientForm({
  patient,
  submitLabel,
  onSubmit,
  disabled = false,
}: {
  patient?: Patient;
  submitLabel: string;
  onSubmit: (values: Values) => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations('patients');
  const [values, setValues] = useState<Values>(() => initialValues(patient));
  const [invalid, setInvalid] = useState<Set<Field>>(new Set());
  const [pending, setPending] = useState(false);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
    // A field's error goes away as soon as it is edited, not on next submit.
    setInvalid((previous) => {
      if (!previous.has(key as Field)) return previous;
      const next = new Set(previous);
      next.delete(key as Field);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createPatientRequestSchema.safeParse(values);
    if (!parsed.success) {
      setInvalid(new Set(parsed.error.issues.map((issue) => issue.path[0] as Field)));
      return;
    }
    setInvalid(new Set());
    setPending(true);
    try {
      await onSubmit(values);
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    'w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <fieldset disabled={disabled || pending} className="space-y-3">
        {FIELDS.map((field) => (
          <div key={field} className="space-y-1">
            <label htmlFor={`patient-${field}`} className="block text-sm text-zinc-700 dark:text-zinc-300">
              {t(`fields.${field}`)}
              {field === 'fullName' ? ' *' : null}
            </label>
            <input
              id={`patient-${field}`}
              type={INPUT_TYPE[field]}
              // These are the patient's details, not the user's: browser
              // autofill would offer the psychologist's own name and phone.
              autoComplete="off"
              value={values[field]}
              onChange={(event) => set(field, event.target.value)}
              aria-invalid={invalid.has(field)}
              aria-describedby={invalid.has(field) ? `patient-${field}-error` : undefined}
              required={field === 'fullName'}
              className={inputClass}
            />
            {invalid.has(field) ? (
              <p id={`patient-${field}-error`} className="text-xs text-red-600 dark:text-red-400">
                {t(`invalid.${field}`)}
              </p>
            ) : null}
          </div>
        ))}
        <div className="space-y-1">
          <label htmlFor="patient-status" className="block text-sm text-zinc-700 dark:text-zinc-300">
            {t('fields.status')}
          </label>
          <select
            id="patient-status"
            // An archived patient's status is shown as such; it is changed
            // only by the owner's restore action, never by this form.
            value={patient?.status === 'archived' ? 'archived' : values.status}
            onChange={(event) => set('status', event.target.value as EditablePatientStatus)}
            className={inputClass}
          >
            {patient?.status === 'archived' ? <option value="archived">{t('status.archived')}</option> : null}
            <option value="active">{t('status.active')}</option>
            <option value="inactive">{t('status.inactive')}</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? t('saving') : submitLabel}
        </button>
      </fieldset>
    </form>
  );
}

export type PatientFormValues = Values;
