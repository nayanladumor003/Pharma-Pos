import { Response } from 'express';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  return res.status(statusCode).json({ success: true, data });
}

export function sendPaginated<T>(res: Response, data: T[], pagination: Pagination, statusCode = 200): Response {
  return res.status(statusCode).json({ success: true, data, pagination });
}

export function buildPagination(page: number, limit: number, total: number): Pagination {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Clamps and defaults page/limit query params. Keeps payloads bounded (max 100/page). */
export function parsePageParams(query: Record<string, unknown>): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '25'), 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}
