import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/medicine.controller';
import {
  addBatchSchema,
  barcodeParamSchema,
  createMedicineSchema,
  listMedicinesQuerySchema,
  medicineIdParamSchema,
  skuParamSchema,
  updateBatchSchema,
  updateMedicineSchema
} from '../validators/medicine.validators';

export const medicineRouter = Router();

medicineRouter.use(requireAuth);

// Every seeded role that needs medicine reads (Admin, Chief Pharmacist, Cashier,
// Inventory Specialist) already holds view_inventory — no new permission invented.
medicineRouter.get('/', requirePermission('view_inventory'), validate(listMedicinesQuerySchema), controller.list);
medicineRouter.get(
  '/barcode/:barcode',
  requirePermission('view_inventory'),
  validate(barcodeParamSchema),
  controller.getByBarcode
);
medicineRouter.get('/sku/:sku', requirePermission('view_inventory'), validate(skuParamSchema), controller.getBySku);
medicineRouter.get('/:id', requirePermission('view_inventory'), validate(medicineIdParamSchema), controller.getById);

medicineRouter.post('/', requirePermission('manage_medicines'), validate(createMedicineSchema), controller.create);
medicineRouter.patch('/:id', requirePermission('manage_medicines'), validate(updateMedicineSchema), controller.update);
// Soft-delete only — archives the medicine rather than removing it, preserving
// referential integrity for historical Sale/Purchase/Prescription records that
// reference this medicineId.
medicineRouter.delete('/:id', requirePermission('manage_medicines'), validate(medicineIdParamSchema), controller.archive);

medicineRouter.post(
  '/:id/batches',
  requirePermission('manage_medicines'),
  validate(addBatchSchema),
  controller.addBatch
);
medicineRouter.patch(
  '/:id/batches/:batchId',
  requirePermission('manage_medicines'),
  validate(updateBatchSchema),
  controller.updateBatch
);
