import { Prisma } from '@psych/db';
import type { NextFunction, Request, Response } from 'express';

// A typed error that routes/use-cases can throw to control the HTTP status
// code returned to the client, instead of every route hand-rolling its own
// try/catch and response shape.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
  }
}

// Consistent error response shape for every endpoint, matching docs/API.md.
// Must be registered last, after all routes.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // Unexpected errors are logged server-side, but the client only ever
  // receives a generic message -- never leak internals (stack traces, DB
  // error text) to the response body.
  //
  // Prisma *validation* errors echo the query arguments in their message --
  // which, on the clinical routes, could include note content (Art. 9 health
  // data). Those are logged by class name only, never by message.
  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error(`${err.name}: message withheld (may contain request data)`);
  } else {
    console.error(err);
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}
