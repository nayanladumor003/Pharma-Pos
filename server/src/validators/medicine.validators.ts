import { z } from 'zod';
import { DOSAGE_FORMS, MEDICINE_CATEGORIES, MEDICINE_STATUSES } from '../models/enums';

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const batchInputBase = z.object({
  batchNumber: z.string().trim().min(1),
  supplierId: objectIdSchema,
  supplierName: z.string().trim().min(1),
  quantity: z.number().int().min(0),
  purchasePrice: z.number().min(0),
  mrp: z.number().min(0),
  sellingPrice: z.number().min(0),
  mfgDate: z.coerce.date(),
  expiryDate: z.coerce.date(),
  rackLocation: z.string().trim().optional()
});

function withPriceGuard<T extends { sellingPrice?: number; mrp?: number }>(schema: z.ZodType<T>) {
  return schema.refine((d) => d.sellingPrice === undefined || d.mrp === undefined || d.sellingPrice <= d.mrp, {
    message: 'sellingPrice cannot exceed mrp',
    path: ['sellingPrice']
  });
}

export const batchInputSchema = withPriceGuard(batchInputBase).refine((d) => d.expiryDate.getTime() > d.mfgDate.getTime(), {
  message: 'expiryDate must be after mfgDate',
  path: ['expiryDate']
});

const medicineBodyBase = z.object({
  name: z.string().trim().min(1),
  genericName: z.string().trim().min(1),
  brand: z.string().trim().min(1),
  category: z.enum(MEDICINE_CATEGORIES),
  manufacturer: z.string().trim().optional(),
  dosageForm: z.enum(DOSAGE_FORMS),
  strength: z.string().trim().min(1),
  packSize: z.string().trim().min(1),
  sku: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  purchasePrice: z.number().min(0),
  mrp: z.number().min(0),
  sellingPrice: z.number().min(0),
  gstRate: z.number().min(0).max(100),
  hsnCode: z.string().trim().optional(),
  reorderLevel: z.number().int().min(0).default(0),
  prescriptionRequired: z.boolean().default(false),
  storageInstructions: z.string().trim().optional(),
  status: z.enum(MEDICINE_STATUSES).default('Active'),
  description: z.string().optional(),
  sideEffects: z.string().optional(),
  rackLocation: z.string().trim().optional(),
  isScheduleH: z.boolean().default(false),
  batches: z.array(batchInputBase).default([])
});

export const createMedicineSchema = z.object({
  body: withPriceGuard(medicineBodyBase)
});

export const updateMedicineSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: withPriceGuard(medicineBodyBase.omit({ batches: true }).partial())
});

export const addBatchSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: batchInputSchema
});

// Quantity is deliberately NOT editable here — every quantity change must go
// through inventoryService.adjustStock so it produces an audited StockMovement
// (see .ai/skills/inventory.md §4/§5). This endpoint is for correcting
// metadata (rack location, prices, batch number typos), not stock levels.
export const updateBatchSchema = z.object({
  params: z.object({ id: objectIdSchema, batchId: objectIdSchema }),
  body: withPriceGuard(batchInputBase.omit({ quantity: true }).partial())
});

export const medicineIdParamSchema = z.object({ params: z.object({ id: objectIdSchema }) });
export const barcodeParamSchema = z.object({ params: z.object({ barcode: z.string().trim().min(1) }) });
export const skuParamSchema = z.object({ params: z.object({ sku: z.string().trim().min(1) }) });

export const listMedicinesQuerySchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    category: z.enum(MEDICINE_CATEGORIES).optional(),
    manufacturer: z.string().trim().optional(),
    status: z.enum(MEDICINE_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['name', 'createdAt', 'totalStock', 'mrp']).default('name'),
    sortDir: z.enum(['asc', 'desc']).default('asc')
  })
});

export type CreateMedicineBody = z.infer<typeof createMedicineSchema>['body'];
export type UpdateMedicineBody = z.infer<typeof updateMedicineSchema>['body'];
export type BatchInput = z.infer<typeof batchInputSchema>;
export type ListMedicinesQuery = z.infer<typeof listMedicinesQuerySchema>['query'];
