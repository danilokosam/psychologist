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

  // Unexpected errors are logged with full detail server-side, but the
  // client only ever receives a generic message -- never leak internals
  // (stack traces, DB error text) to the response body.
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}
