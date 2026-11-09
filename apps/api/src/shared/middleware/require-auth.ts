import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../env';
import { AppError } from './error-handler';

// The project signs access tokens with an asymmetric key (ES256), so the API
// verifies them against the public keys published at this endpoint. It never
// holds a signing secret, and it never asks Supabase to validate a token for
// us on the request path. `createRemoteJWKSet` caches the keys in memory and
// refetches on key rotation.
//
// Created lazily so that importing this module (in tests, or in a process
// that never serves a request) doesn't fire a network call.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

function bearerToken(req: Request): string {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Missing bearer token', 'UNAUTHENTICATED');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError(401, 'Missing bearer token', 'UNAUTHENTICATED');
  }
  return token;
}

/**
 * Verifies the caller's Supabase access token and attaches the proven user id
 * to the request.
 *
 * This is the only place the API decides who the caller is. Nothing
 * downstream may take identity from a header, body field, or query parameter
 * -- see ADR-0008 and docs/SECURITY.md.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req);

    const { payload } = await jwtVerify(token, getJwks(), {
      // Pinning the issuer means a validly-signed token from some *other*
      // Supabase project is still rejected here.
      issuer: `${env.SUPABASE_URL}/auth/v1`,
    });

    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new AppError(401, 'Token has no subject', 'UNAUTHENTICATED');
    }

    req.auth = { userId: payload.sub };
    next();
  } catch (error) {
    // Any verification failure -- bad signature, expired, wrong issuer,
    // malformed -- is reported identically, so the response never helps an
    // attacker distinguish between them.
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError(401, 'Invalid or expired token', 'UNAUTHENTICATED'));
  }
}
