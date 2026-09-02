import { z } from 'zod';
import { objectIdSchema } from './medicine.validators';

// outstandingAmount / totalPurchases are server-derived — never accepted from the client.
const supplierBodyBase = z.object({
  name: z.string().trim().min(1),
  contactPerson: z.string().trim().optional(),
  phone: z.string().trim().min(6),
  email: z.string().trim().email().optional(),
  address: z.string().trim().optional(),
  gstin: z.string().trim().optional(),
  drugLicense: z.string().trim().optional(),
  drugLicenseNumber: z.string().trim().optional(),
  creditDays: z.number().int().min(0).default(0),
  status: z.enum(['Active', 'Inactive']).default('Active')
});

export const createSupplierSchema = z.object({ body: supplierBodyBase });
export const updateSupplierSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: supplierBodyBase.partial()
});

export const supplierIdParamSchema = z.object({ params: z.object({ id: objectIdSchema }) });

export const listSuppliersQuerySchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['name', 'outstandingAmount', 'createdAt']).default('name'),
    sortDir: z.enum(['asc', 'desc']).default('asc')
  })
});

export const supplierLedgerQuerySchema = z.object({
  params: z.object({ id: objectIdSchema }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

export const paySupplierSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: z.object({
    amount: z.number().positive('Payment amount must be greater than 0'),
    method: z.enum(['Cash', 'UPI', 'Card', 'Bank Transfer']).default('Bank Transfer'),
    reference: z.string().trim().optional(),
    notes: z.string().trim().optional()
  })
});

export type CreateSupplierBody = z.infer<typeof createSupplierSchema>['body'];
export type UpdateSupplierBody = z.infer<typeof updateSupplierSchema>['body'];
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>['query'];
export type PaySupplierBody = z.infer<typeof paySupplierSchema>['body'];
