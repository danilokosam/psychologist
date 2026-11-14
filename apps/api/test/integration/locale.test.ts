import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/shared/db/prisma';
import { adminDb, asIdentity, bootstrapUser, makeUser, resetDatabase, runtimeDb, signToken } from './helpers';

const app = createApp();

beforeEach(resetDatabase);
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
});

const patchMe = (token: string, body: object) =>
  request(app).patch('/me').set('Authorization', `Bearer ${token}`).send(body);

describe('F-013 language preference', () => {
  it('persists across a new session (a freshly issued token, as on another device)', async () => {
    const user = await bootstrapUser(app, 'polyglot');

    const updated = await patchMe(user.token, { locale: 'es' });
    expect(updated.status).toBe(200);
    expect(updated.body.profile.locale).toBe('es');

    const laterToken = await signToken({ sub: user.id, email: user.email });
    const me = await request(app).get('/me').set('Authorization', `Bearer ${laterToken}`);
    expect(me.body.profile.locale).toBe('es');
  });

  it.each([
    ['an unsupported locale', { locale: 'fr' }],
    ['a missing locale', {}],
    ['an extra field (e.g. trying to name another user)', { locale: 'es', id: '00000000-0000-4000-8000-000000000000' }],
  ])('rejects %s with 400', async (_label, body) => {
    const user = await bootstrapUser(app, 'strict');

    const response = await patchMe(user.token, body);

    expect(response.status).toBe(400);
    const profile = await adminDb.profile.findUniqueOrThrow({ where: { id: user.id } });
    expect(profile.locale).toBe('en');
  });

  it('answers 404 for a caller who has not bootstrapped an account', async () => {
    const ghost = await makeUser('ghost');
    expect((await patchMe(ghost.token, { locale: 'es' })).status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await request(app).patch('/me').send({ locale: 'es' })).status).toBe(401);
  });

  it('RLS only: a user cannot change another user\'s locale', async () => {
    const victim = await bootstrapUser(app, 'victim');
    const attacker = await bootstrapUser(app, 'attacker');

    const { count } = await asIdentity({ userId: attacker.id }, (tx) =>
      tx.profile.updateMany({ where: { id: victim.id }, data: { locale: 'es' } }),
    );

    expect(count).toBe(0);
    const profile = await adminDb.profile.findUniqueOrThrow({ where: { id: victim.id } });
    expect(profile.locale).toBe('en');
  });

  it('the database itself refuses an unsupported locale, whoever writes it', async () => {
    const user = await bootstrapUser(app, 'check');

    await expect(
      adminDb.profile.update({ where: { id: user.id }, data: { locale: 'fr' } }),
    ).rejects.toThrow(/profiles_locale_supported/);
  });
});
