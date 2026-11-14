import { describe, expect, it } from 'vitest';
import { canRecordOutcome, isValidRange, type Appointment } from '../../domain/appointment';
import { AppointmentConflictError, type AppointmentRepository } from '../ports/appointment-repository';
import { changeAppointment } from './change-appointment';
import { scheduleAppointment } from './schedule-appointment';

const ORG = 'org';
const NOW = new Date('2030-01-10T12:00:00Z');
const h = (hour: number) => new Date(Date.UTC(2030, 0, 15, hour));

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a-1',
    organizationId: ORG,
    patient: { id: 'p-1', fullName: 'Synthetic' },
    professional: { userId: 'u-1', fullName: 'Pro' },
    startsAt: h(9),
    endsAt: h(10),
    status: 'scheduled',
    modality: 'in_person',
    createdAt: NOW,
    updatedAt: NOW,
    cancelledAt: null,
    ...overrides,
  };
}

function repo(overrides: Partial<AppointmentRepository> = {}): AppointmentRepository & { writes: number } {
  const state = { writes: 0 };
  return Object.assign(state, {
    findById: async () => appointment(),
    listInWindow: async () => [],
    insert: async () => {
      state.writes++;
      return 'a-1';
    },
    updateIfActive: async () => {
      state.writes++;
      return true;
    },
    cancel: async () => true,
    patientStatus: async () => 'active' as const,
    isActiveClinician: async () => true,
    ...overrides,
  });
}

describe('domain rules', () => {
  it('accepts 1 minute to 12 hours, nothing else', () => {
    expect(isValidRange(h(9), h(9))).toBe(false);
    expect(isValidRange(h(10), h(9))).toBe(false);
    expect(isValidRange(h(0), h(12))).toBe(true);
    expect(isValidRange(h(0), new Date(h(12).getTime() + 1))).toBe(false);
  });

  it('records outcomes only once the appointment has started', () => {
    expect(canRecordOutcome('completed', h(9), h(8))).toBe(false);
    expect(canRecordOutcome('no_show', h(9), h(9))).toBe(true);
    expect(canRecordOutcome('confirmed', h(9), h(8))).toBe(true);
  });
});

describe('scheduleAppointment', () => {
  const input = {
    organizationId: ORG,
    createdBy: 'u-0',
    patientId: 'p-1',
    professionalId: 'u-1',
    startsAt: h(9),
    endsAt: h(10),
    modality: 'in_person' as const,
    status: 'scheduled' as const,
  };

  it('checks patient and professional before writing anything', async () => {
    const archived = repo({ patientStatus: async () => 'archived' });
    expect(await scheduleAppointment(input, { appointments: archived })).toEqual({ kind: 'patient_archived' });
    const staff = repo({ isActiveClinician: async () => false });
    expect(await scheduleAppointment(input, { appointments: staff })).toEqual({ kind: 'invalid_professional' });
    expect(archived.writes + staff.writes).toBe(0);
  });

  it('turns the database conflict into a result naming the side', async () => {
    const taken = repo({
      insert: async () => {
        throw new AppointmentConflictError('patient');
      },
    });
    expect(await scheduleAppointment(input, { appointments: taken })).toEqual({ kind: 'conflict', side: 'patient' });
  });
});

describe('changeAppointment', () => {
  const change = (changes: Parameters<typeof changeAppointment>[0]['changes'], appointments: AppointmentRepository) =>
    changeAppointment({ organizationId: ORG, appointmentId: 'a-1', changes, now: NOW }, { appointments });

  it('judges a partial reschedule against the stored start', async () => {
    const r = repo();
    expect(await change({ endsAt: h(8) }, r)).toEqual({ kind: 'invalid_range' });
    expect(r.writes).toBe(0);
  });

  it('refuses cancelled appointments without writing', async () => {
    const r = repo({ findById: async () => appointment({ status: 'cancelled', cancelledAt: NOW }) });
    expect(await change({ modality: 'online' }, r)).toEqual({ kind: 'cancelled' });
    expect(r.writes).toBe(0);
  });

  it('refuses an outcome for a future appointment', async () => {
    expect(await change({ status: 'completed' }, repo())).toEqual({ kind: 'not_yet_happened' });
  });

  it('does not re-check the professional when it is not changing', async () => {
    const r = repo({ isActiveClinician: async () => false });
    expect((await change({ professionalId: 'u-1', modality: 'online' }, r)).kind).toBe('updated');
    expect((await change({ professionalId: 'u-2' }, r)).kind).toBe('invalid_professional');
  });
});
