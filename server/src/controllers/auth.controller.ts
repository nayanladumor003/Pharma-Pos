import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/response';
import { AppError } from '../errors/AppError';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../utils/refreshCookie';
import * as authService from '../services/authService';

function sessionMeta(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  const { accessToken, refreshToken, refreshExpiresAt, user } = await authService.login(email, password, sessionMeta(req));
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  sendSuccess(res, { accessToken, user });
});

export const refresh = catchAsync(async (req: Request, res: Response) => {
  const rawRefreshToken = (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE_NAME];
  if (!rawRefreshToken) throw AppError.unauthorized('Session expired — please log in again');

  const { accessToken, refreshToken, refreshExpiresAt, user } = await authService.refresh(rawRefreshToken, sessionMeta(req));
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  sendSuccess(res, { accessToken, user });
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  const rawRefreshToken = (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE_NAME];
  await authService.logout(rawRefreshToken);
  clearRefreshCookie(res);
  sendSuccess(res, { loggedOut: true });
});

export const me = catchAsync(async (req: Request, res: Response) => {
  // requireAuth already populated req.user from a fresh DB read.
  sendSuccess(res, { user: req.user });
});
