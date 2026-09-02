import { z } from 'zod';
import { objectIdSchema } from './medicine.validators';
import { GENDERS } from '../models/enums';

// loyaltyPoints / outstandingBalance / totalPurchases / lastVisit are
// server-derived and intentionally absent here — never accepted from the
// client on create/update (plan §16: "never trust client-supplied ...
// derived financial values").
const customerBodyBase = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(6),
  email: z.string().trim().email().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  patientAge: z.number().int().min(0).max(130).optional(),
  patientGender: z.enum(GENDERS).optional(),
  creditLimit: z.number().min(0).default(0),
  notes: z.string().optional(),
  allergies: z.array(z.string().trim()).optional(),
  chronicConditions: z.array(z.string().trim()).optional(),
  doctorName: z.string().trim().optional()
});

export const createCustomerSchema = z.object({ body: customerBodyBase });
export const updateCustomerSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: customerBodyBase.partial()
});

export const customerIdParamSchema = z.object({ params: z.object({ id: objectIdSchema }) });

export const listCustomersQuerySchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['name', 'lastVisit', 'outstandingBalance', 'createdAt']).default('name'),
    sortDir: z.enum(['asc', 'desc']).default('asc')
  })
});

export const ledgerQuerySchema = z.object({
  params: z.object({ id: objectIdSchema }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

export const settleBalanceSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: z.object({
    amount: z.number().positive('Payment amount must be greater than 0'),
    method: z.enum(['Cash', 'UPI', 'Card']).default('Cash'),
    reference: z.string().trim().optional(),
    notes: z.string().trim().optional()
  })
});

export type CreateCustomerBody = z.infer<typeof createCustomerSchema>['body'];
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>['body'];
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>['query'];
export type SettleBalanceBody = z.infer<typeof settleBalanceSchema>['body'];
