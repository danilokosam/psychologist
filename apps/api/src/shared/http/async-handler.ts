import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 doesn't catch rejected promises from async handlers -- an
 * unhandled rejection would hang the request instead of reaching the error
 * middleware. This forwards it, so handlers can just throw.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
