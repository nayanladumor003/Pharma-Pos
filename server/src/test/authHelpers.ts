import { Express } from 'express';
import request from 'supertest';
import { Employee } from '../models/Employee.model';
import { User } from '../models/User.model';
import { hashPassword } from '../utils/password';
import { PERMISSIONS, Permission } from '../models/enums';

export const TEST_PASSWORD = 'Test-Password-123!';

export async function createTestUser(
  overrides: { role?: string; permissions?: Permission[]; status?: string } = {}
): Promise<{ email: string; employee: InstanceType<typeof Employee> }> {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@apexpharma.com`;
  const employee = await Employee.create({
    name: 'Test User',
    email,
    phone: '9800000000',
    role: overrides.role ?? 'Admin',
    status: overrides.status ?? 'Active',
    permissions: overrides.permissions ?? [...PERMISSIONS]
  });
  await User.create({ employeeId: employee._id, email, passwordHash: await hashPassword(TEST_PASSWORD), isActive: true });
  return { email, employee };
}

export async function loginAndGetToken(app: Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  return res.body.data.accessToken as string;
}

export async function authedUser(
  app: Express,
  overrides: { role?: string; permissions?: Permission[]; status?: string } = {}
): Promise<{ token: string; email: string }> {
  const { email } = await createTestUser(overrides);
  const token = await loginAndGetToken(app, email);
  return { token, email };
}
