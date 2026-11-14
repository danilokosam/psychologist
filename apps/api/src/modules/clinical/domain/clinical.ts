// Hand-written domain types; the Prisma adapters map rows onto them (ADR-0009).

export type Person = { userId: string; fullName: string | null };

export type ClinicalSession = {
  id: string;
  organizationId: string;
  patient: { id: string; fullName: string };
  professional: Person;
  appointmentId: string | null;
  startedAt: Date;
  durationMinutes: number;
  createdAt: Date;
  updatedAt: Date;
};

/** A note with its current (highest) version. */
export type ClinicalNote = {
  id: string;
  organizationId: string;
  sessionId: string;
  author: Person;
  version: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NoteVersion = { version: number; content: string; createdAt: Date; createdBy: Person };

/**
 * A session attests that an encounter took place, so it cannot be dated in
 * the future. A few minutes of tolerance absorb clock skew between the
 * browser and the server.
 */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function isInFuture(startedAt: Date, now: Date): boolean {
  return startedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS;
}
