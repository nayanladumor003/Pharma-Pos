import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { createApp } from '../app';
import { Employee } from '../models/Employee.model';
import { User } from '../models/User.model';
import { RefreshToken } from '../models/RefreshToken.model';
import { hashPassword } from '../utils/password';
import { env } from '../config/env';
import { JWT_AUDIENCE, JWT_ISSUER } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { errorHandler } from '../middleware/errorHandler';

const PASSWORD = 'Correct-Horse-Battery-Staple-1';

async function createLoginableEmployee(
  overrides: { employeeStatus?: string; userActive?: boolean; role?: string; permissions?: string[] } = {}
) {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@apexpharma.com`;
  const employee = await Employee.create({
    name: 'Test Pharmacist',
    email,
    phone: '9800000099',
    role: overrides.role ?? 'Cashier',
    status: overrides.employeeStatus ?? 'Active',
    permissions: overrides.permissions ?? ['view_pos', 'create_sale']
  });
  await User.create({
    employeeId: employee._id,
    email,
    passwordHash: await hashPassword(PASSWORD),
    isActive: overrides.userActive ?? true
  });
  return { email, employee };
}

function extractCookieValue(setCookieHeader: string[] | undefined, name: string): string | undefined {
  const line = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0].split('=')[1];
}

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials and never exposes passwordHash', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();

    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('refreshToken='))).toBe(true);
    expect(setCookie.some((c) => c.includes('HttpOnly'))).toBe(true);
  });

  it('rejects a wrong password and an unknown email with the identical generic message (no user enumeration)', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();

    const wrongPassword = await request(app).post('/api/auth/login').send({ email, password: 'nope-wrong-pass' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody-here@apexpharma.com', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('UNAUTHORIZED');
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.message).toBe('Invalid email or password');
  });

  it('rejects login for an inactive employee with the same generic message', async () => {
    const { email } = await createLoginableEmployee({ employeeStatus: 'Inactive' });
    const app = createApp();

    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('rejects login when the User record itself is deactivated', async () => {
    const { email } = await createLoginableEmployee({ userActive: false });
    const app = createApp();

    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('validates the request body server-side', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/auth/me (requireAuth)', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a garbage/invalid token', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a validly-signed but expired access token', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();
    const loginRes = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    const userId = loginRes.body.data.user.userId;

    const expiredToken = jwt.sign({ sub: userId, type: 'access' }, env.JWT_SECRET, {
      expiresIn: '-10s',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('returns the safe current-user payload with a valid access token', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();
    const loginRes = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    const accessToken = loginRes.body.data.accessToken;

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });
});

describe('POST /api/auth/refresh', () => {
  it('rejects when there is no refresh cookie', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('rejects a garbage refresh cookie', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/refresh').set('Cookie', 'refreshToken=garbage');
    expect(res.status).toBe(401);
  });

  it('issues a new access token from a valid refresh cookie', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password: PASSWORD });

    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
  });

  it('rotates the refresh token: the previous cookie value stops working after one refresh', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
    const oldCookie = extractCookieValue(loginRes.headers['set-cookie'] as unknown as string[], 'refreshToken');

    await agent.post('/api/auth/refresh'); // agent now carries the NEW rotated cookie

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${oldCookie}`);
    expect(replay.status).toBe(401);
  });

  it('detects refresh-token reuse and revokes every session for that user', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
    const oldCookie = extractCookieValue(loginRes.headers['set-cookie'] as unknown as string[], 'refreshToken');

    const rotateRes = await agent.post('/api/auth/refresh'); // rotates; oldCookie is now revoked
    expect(rotateRes.status).toBe(200);

    // Replay the already-rotated-away token — reuse detection should fire.
    await request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${oldCookie}`);

    // Even the legitimately-rotated (latest, otherwise-valid) token must now be dead too.
    const afterReuse = await agent.post('/api/auth/refresh');
    expect(afterReuse.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the current session so a subsequent refresh fails', async () => {
    const { email } = await createLoginableEmployee();
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password: PASSWORD });

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await agent.post('/api/auth/refresh');
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('is idempotent when there is no session to revoke', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.data.loggedOut).toBe(true);
  });
});

describe('requirePermission', () => {
  function buildProtectedTestApp() {
    const app = express();
    app.use(express.json());
    app.get('/protected/settings', requireAuth, requirePermission('manage_settings'), (_req, res) => {
      res.json({ success: true, data: { ok: true } });
    });
    app.use(errorHandler);
    return app;
  }

  it('allows a user who holds the required permission', async () => {
    const { email } = await createLoginableEmployee({ role: 'Admin', permissions: ['manage_settings'] });
    const mainApp = createApp();
    const loginRes = await request(mainApp).post('/api/auth/login').send({ email, password: PASSWORD });

    const res = await request(buildProtectedTestApp())
      .get('/protected/settings')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('forbids a user who lacks the required permission (RBAC is server-side, not a UI hint)', async () => {
    const { email } = await createLoginableEmployee({ role: 'Cashier', permissions: ['view_pos', 'create_sale'] });
    const mainApp = createApp();
    const loginRes = await request(mainApp).post('/api/auth/login').send({ email, password: PASSWORD });

    const res = await request(buildProtectedTestApp())
      .get('/protected/settings')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Employee deactivation', () => {
  it('immediately blocks an already-issued access token once the employee is deactivated', async () => {
    const { email, employee } = await createLoginableEmployee();
    const app = createApp();
    const loginRes = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    const accessToken = loginRes.body.data.accessToken;

    // Confirm it works before deactivation.
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(before.status).toBe(200);

    await Employee.findByIdAndUpdate(employee._id, { status: 'Inactive' });

    // Same still-unexpired token — must now fail because requireAuth re-checks the DB every request.
    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(after.status).toBe(401);
  });

  it('also blocks refresh once the employee is deactivated, and revokes the token', async () => {
    const { email, employee } = await createLoginableEmployee();
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password: PASSWORD });

    await Employee.findByIdAndUpdate(employee._id, { status: 'Inactive' });

    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(401);

    const outstanding = await RefreshToken.find({ revokedAt: null });
    expect(outstanding.length).toBe(0);
  });
});
