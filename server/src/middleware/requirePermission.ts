import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { Permission } from '../models/enums';
import { auditLog } from '../utils/auditLog';

/**
 * Server-side authorization gate. Must run after requireAuth. Reuses the exact
 * Permission values already seeded on Employee records (models/enums.ts) —
 * no separate/invented permission system. Hiding a button in React is UX only;
 * this middleware is what actually enforces access.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized('Authentication required'));
      return;
    }
    if (!req.user.permissions.includes(permission)) {
      auditLog('permission_denied', { userId: req.user.userId, permission, path: req.path });
      next(AppError.forbidden('You do not have permission to perform this action'));
      return;
    }
    next();
  };
}
