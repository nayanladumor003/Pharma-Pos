import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../errors/AppError';
import { ErrorCode } from '../errors/errorCodes';
import { env } from '../config/env';

interface ErrorResponseBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

/**
 * Single place that decides what an error looks like on the wire. Never forwards a raw
 * Error message, Mongo error text, or stack trace to the client — only AppError.message
 * (which we control) or a fixed generic message for anything unrecognized.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const body: ErrorResponseBody = { success: false, error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: err.flatten().fieldErrors
      }
    };
    return res.status(400).json(body);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const body: ErrorResponseBody = {
      success: false,
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Request validation failed' }
    };
    return res.status(400).json(body);
  }

  if (err instanceof mongoose.Error.CastError) {
    const body: ErrorResponseBody = {
      success: false,
      error: { code: ErrorCode.VALIDATION_ERROR, message: `Invalid identifier: ${err.path}` }
    };
    return res.status(400).json(body);
  }

  if (isMongoDuplicateKeyError(err)) {
    const body: ErrorResponseBody = {
      success: false,
      error: { code: ErrorCode.DUPLICATE_RESOURCE, message: 'A record with these details already exists' }
    };
    return res.status(409).json(body);
  }

  if (err instanceof Error && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    const body: ErrorResponseBody = {
      success: false,
      error: { code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired session — please log in again' }
    };
    return res.status(401).json(body);
  }

  // Unexpected error: log full detail server-side, expose nothing internal to the client.
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  const body: ErrorResponseBody = {
    success: false,
    error: { code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong. Please try again.' }
  };
  if (!env.isProduction && err instanceof Error) {
    body.error.details = { message: err.message };
  }
  return res.status(500).json(body);
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
