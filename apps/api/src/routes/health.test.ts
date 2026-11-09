import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('GET /health', () => {
  it('returns status ok with a timestamp', async () => {
    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.timestamp).toBe('string');
  });
});
