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
