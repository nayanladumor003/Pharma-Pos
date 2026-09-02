import { z } from 'zod';
import { objectIdSchema } from './medicine.validators';
import { PURCHASE_ORDER_STATUSES } from '../models/enums';

// taxAmount / total (per item) and subtotal / taxTotal / discountTotal /
// grandTotal / paymentStatus (order-level) are server-computed — never
// accepted from the client. sellingPrice is required per resolved decision
// #2 (no hardcoded MRP-margin auto-pricing) and validated against mrp below.
const purchaseItemInputSchema = z
  .object({
    medicineId: objectIdSchema,
    medicineName: z.string().trim().min(1),
    batchNumber: z.string().trim().min(1),
    mfgDate: z.coerce.date(),
    expiryDate: z.coerce.date(),
    quantity: z.number().int().min(1),
    freeQuantity: z.number().int().min(0).default(0),
    purchasePrice: z.number().min(0),
    mrp: z.number().min(0),
    sellingPrice: z.number().min(0),
    taxRate: z.number().min(0).max(100),
    discountPercent: z.number().min(0).max(100).default(0)
  })
  .refine((d) => d.sellingPrice <= d.mrp, { message: 'sellingPrice cannot exceed mrp', path: ['sellingPrice'] })
  .refine((d) => d.expiryDate.getTime() > d.mfgDate.getTime(), { message: 'expiryDate must be after mfgDate', path: ['expiryDate'] });

const purchaseBodyBase = z.object({
  supplierId: objectIdSchema,
  invoiceNumber: z.string().trim().min(1),
  orderDate: z.coerce.date().default(() => new Date()),
  deliveryDate: z.coerce.date().optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
  items: z.array(purchaseItemInputSchema).min(1, 'Purchase order must contain at least one item'),
  // Actual amount paid to the supplier at entry time — server derives
  // paymentStatus from comparing this to the computed grandTotal, rather
  // than trusting a client-declared status disconnected from the number.
  paidAmount: z.number().min(0).default(0),
  status: z.enum(PURCHASE_ORDER_STATUSES).default('Ordered'),
  notes: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(8, 'idempotencyKey is required')
});

export const createPurchaseSchema = z.object({ body: purchaseBodyBase });

export const purchaseIdParamSchema = z.object({ params: z.object({ id: objectIdSchema }) });

export const listPurchasesQuerySchema = z.object({
  query: z.object({
    supplierId: objectIdSchema.optional(),
    status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
    paymentStatus: z.enum(['Paid', 'Pending', 'Partial']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

export type CreatePurchaseBody = z.infer<typeof createPurchaseSchema>['body'];
export type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>['query'];
