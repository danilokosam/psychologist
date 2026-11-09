import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';

// A protected route stands in for every authenticated endpoint: if the token
// is anything other than a valid, correctly-signed, correctly-issued one, the
// request must never reach a handler.
describe('requireAuth on a protected route', () => {
  it('rejects a request with no Authorization header', async () => {
    const response = await request(createApp()).get('/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a non-bearer Authorization header', async () => {
    const response = await request(createApp()).get('/me').set('Authorization', 'Basic abc123');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an empty bearer token', async () => {
    const response = await request(createApp()).get('/me').set('Authorization', 'Bearer ');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed token', async () => {
    const response = await request(createApp())
      .get('/me')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('never reveals why verification failed', async () => {
    const noHeader = await request(createApp()).get('/me');
    const malformed = await request(createApp())
      .get('/me')
      .set('Authorization', 'Bearer not-a-real-jwt');

    // Both say the same thing: an attacker learns nothing about which part of
    // verification rejected them.
    expect(noHeader.body.error.code).toBe(malformed.body.error.code);
  });
});
