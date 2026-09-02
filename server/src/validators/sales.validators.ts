import { z } from 'zod';
import { objectIdSchema } from './medicine.validators';
import { PAYMENT_METHODS, SPLIT_PAYMENT_METHODS } from '../models/enums';

// batchId is deliberately NOT part of this schema — the frontend may show a
// preferred/expected batch, but the server always resolves FEFO itself from
// live DB state and ignores any client batch hint for allocation purposes.
const saleLineInputSchema = z.object({
  medicineId: objectIdSchema,
  quantity: z.number().int().min(1),
  discountPercent: z.number().min(0).max(100).default(0)
});

const splitDetailInputSchema = z.object({
  method: z.enum(SPLIT_PAYMENT_METHODS),
  amount: z.number().min(0),
  reference: z.string().trim().optional()
});

const saleBodyBase = z.object({
  items: z.array(saleLineInputSchema).min(1, 'Cart must contain at least one item'),
  customerId: objectIdSchema.optional(),
  doctorName: z.string().trim().optional(),
  cartDiscountPercent: z.number().min(0).max(100).default(0),
  paymentMethod: z.enum(PAYMENT_METHODS),
  splitDetails: z.array(splitDetailInputSchema).optional(),
  amountPaid: z.number().min(0).default(0),
  notes: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(8, 'idempotencyKey is required')
});

export const createSaleSchema = z.object({
  body: saleBodyBase
    .refine((d) => d.paymentMethod !== 'Split' || (d.splitDetails && d.splitDetails.length > 0), {
      message: 'splitDetails is required when paymentMethod is Split',
      path: ['splitDetails']
    })
    .refine((d) => d.paymentMethod !== 'Credit' || !!d.customerId, {
      message: 'A registered customer is required for a Credit sale',
      path: ['customerId']
    })
});

export const quoteSaleSchema = z.object({
  body: saleBodyBase.omit({ idempotencyKey: true, paymentMethod: true, amountPaid: true, splitDetails: true })
});

export const listSalesQuerySchema = z.object({
  query: z.object({
    customerId: objectIdSchema.optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

export const saleIdParamSchema = z.object({ params: z.object({ id: objectIdSchema }) });

export type CreateSaleBody = z.infer<typeof createSaleSchema>['body'];
export type QuoteSaleBody = z.infer<typeof quoteSaleSchema>['body'];
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>['query'];
