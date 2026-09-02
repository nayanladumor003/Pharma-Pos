import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

export interface Validated<Body = unknown, Query = unknown, Params = unknown> {
  body: Body;
  query: Query;
  params: Params;
}

/**
 * Centralized request validation (plan §11 — "never trust frontend validation").
 * Schema validates { body, query, params } together; ZodErrors are caught by
 * the central errorHandler and mapped to the standard VALIDATION_ERROR envelope.
 *
 * The coerced/defaulted result (e.g. `page` as a number, not the raw query
 * string) is exposed as `req.validated`, not written back onto `req.query` —
 * Express's query object has surprising reassignment semantics across
 * versions, so controllers read `req.validated.query/.body/.params` instead.
 */
export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.parse({ body: req.body, query: req.query, params: req.params }) as Validated;
    req.validated = result;
    if (result.body !== undefined) req.body = result.body;
    next();
  };
}
