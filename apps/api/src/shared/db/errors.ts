import { Prisma } from '@psych/db';

/**
 * True for a Postgres unique-constraint violation surfaced by Prisma. Used to
 * turn a lost race (two identical writes at once) into a clean 409 rather than
 * a 500, with the database constraint -- not an application pre-check -- as
 * the real guarantee.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * True when Postgres rejected a write with the named exclusion constraint
 * (SQLSTATE 23P01). Prisma has no error code of its own for exclusion
 * violations -- it surfaces them as an unknown request error whose message
 * carries the database error -- so the constraint name is matched in the
 * message. The name is our own, from the migration, so the match is exact.
 */
export function violatedExclusionConstraint(error: unknown, constraint: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientUnknownRequestError) &&
    !(error instanceof Prisma.PrismaClientKnownRequestError)
  ) {
    return false;
  }
  return error.message.includes('23P01') && error.message.includes(constraint);
}
