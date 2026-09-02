import { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async controller so a rejected promise is forwarded to the error middleware. */
export function catchAsync(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
