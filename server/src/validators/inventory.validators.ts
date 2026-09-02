import { z } from 'zod';
import { STOCK_MOVEMENT_TYPES } from '../models/enums';
import { objectIdSchema } from './medicine.validators';

const ADJUSTMENT_TYPES = ['Add Stock', 'Subtract Stock', 'Set Stock (Audit)', 'Mark Damaged', 'Mark Expired'] as const;

export const adjustStockSchema = z.object({
  body: z
    .object({
      medicineId: objectIdSchema,
      batchId: objectIdSchema,
      adjustmentType: z.enum(ADJUSTMENT_TYPES),
      // Absolute target count for 'Set Stock (Audit)'; a positive delta for every other type.
      quantity: z.number().int().min(0),
      reason: z.string().trim().min(1),
      notes: z.string().trim().optional()
    })
    .refine((d) => d.adjustmentType === 'Set Stock (Audit)' || d.quantity > 0, {
      message: 'quantity must be greater than 0 for this adjustment type',
      path: ['quantity']
    })
});

export const listMovementsQuerySchema = z.object({
  query: z.object({
    medicineId: objectIdSchema.optional(),
    type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
    referenceId: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

export const expiryRadarQuerySchema = z.object({
  query: z.object({
    tier: z.enum(['critical', 'near', 'watchlist', 'all']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
});

export const paginationQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

export type AdjustStockBody = z.infer<typeof adjustStockSchema>['body'];
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>['query'];
export type ExpiryRadarQuery = z.infer<typeof expiryRadarQuerySchema>['query'];
