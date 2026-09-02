import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// quiet: true suppresses dotenv's console output (including its promotional "tip" banners).
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be a long random string'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be a long random string'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Failed to load environment configuration. Check server/.env against server/.env.example.');
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
};
