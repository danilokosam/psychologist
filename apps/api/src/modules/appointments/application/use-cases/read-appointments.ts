import type { Appointment } from '../../domain/appointment';
import type { AppointmentRepository, AppointmentWindow } from '../ports/appointment-repository';

export function getAppointment(
  input: { organizationId: string; appointmentId: string },
  deps: { appointments: AppointmentRepository },
): Promise<Appointment | null> {
  return deps.appointments.findById(input.organizationId, input.appointmentId);
}

/** The calendar: everything overlapping a bounded window (see listAppointmentsQuerySchema). */
export function listAppointments(
  input: AppointmentWindow,
  deps: { appointments: AppointmentRepository },
): Promise<Appointment[]> {
  return deps.appointments.listInWindow(input);
}
