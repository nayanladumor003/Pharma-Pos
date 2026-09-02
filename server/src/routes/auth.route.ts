import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { authRateLimiter, refreshRateLimiter } from '../middleware/rateLimit';
import { loginSchema } from '../validators/auth.validators';

export const authRouter = Router();

authRouter.post('/login', authRateLimiter, validate(loginSchema), authController.login);
authRouter.post('/refresh', refreshRateLimiter, authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', requireAuth, authController.me);
