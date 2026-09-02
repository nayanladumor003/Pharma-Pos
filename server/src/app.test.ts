import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app';

describe('app foundation', () => {
  const app = createApp();

  it('responds to GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('returns the standard NOT_FOUND envelope for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: expect.stringContaining('Route GET /api/does-not-exist') }
    });
  });
});
