import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl}`));
}
