import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/supplier.controller';
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  paySupplierSchema,
  supplierIdParamSchema,
  supplierLedgerQuerySchema,
  updateSupplierSchema
} from '../validators/supplier.validators';

// manage_purchases is an exact fit for the whole Suppliers domain — held by
// exactly Admin, Chief Pharmacist, and Inventory Specialist (the roles that
// actually deal with distributor relationships), and correctly excludes
// Cashier. No permission gap here (contrast with customer.route.ts).
export const supplierRouter = Router();

supplierRouter.use(requireAuth);
supplierRouter.use(requirePermission('manage_purchases'));

supplierRouter.get('/', validate(listSuppliersQuerySchema), controller.list);
supplierRouter.get('/:id', validate(supplierIdParamSchema), controller.getById);
supplierRouter.get('/:id/ledger', validate(supplierLedgerQuerySchema), controller.ledger);
supplierRouter.post('/', validate(createSupplierSchema), controller.create);
supplierRouter.patch('/:id', validate(updateSupplierSchema), controller.update);
supplierRouter.post('/:id/pay', validate(paySupplierSchema), controller.pay);
