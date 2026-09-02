import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/customer.controller';
import {
  createCustomerSchema,
  customerIdParamSchema,
  ledgerQuerySchema,
  listCustomersQuerySchema,
  settleBalanceSchema,
  updateCustomerSchema
} from '../validators/customer.validators';

/**
 * Permission gap found during audit: the seeded Permission union
 * (models/enums.ts, matching src/data/employees.ts) has no customer-specific
 * entry — no 'view_customers'/'manage_customers'. Rather than invent a new
 * permission, this reuses the closest fit already held by every role that
 * actually touches customers in the live app:
 *   - reads (list/get/ledger)   -> view_pos   (POS customer lookup/select;
 *     every seeded role that interacts with customers already holds this —
 *     notably it correctly EXCLUDES Inventory Specialist, who has no
 *     legitimate reason to browse the Khata ledger)
 *   - create/update/settle      -> create_sale (inline "new customer" during
 *     checkout, and Khata settlement is a cash-handling operation on par
 *     with completing a sale — same trust boundary as POS billing today)
 * Flagged explicitly in the Phase G report as a decision, not silently made.
 */
export const customerRouter = Router();

customerRouter.use(requireAuth);

customerRouter.get('/', requirePermission('view_pos'), validate(listCustomersQuerySchema), controller.list);
customerRouter.get('/:id', requirePermission('view_pos'), validate(customerIdParamSchema), controller.getById);
customerRouter.get('/:id/ledger', requirePermission('view_pos'), validate(ledgerQuerySchema), controller.ledger);

customerRouter.post('/', requirePermission('create_sale'), validate(createCustomerSchema), controller.create);
customerRouter.patch('/:id', requirePermission('create_sale'), validate(updateCustomerSchema), controller.update);
customerRouter.post('/:id/settle', requirePermission('create_sale'), validate(settleBalanceSchema), controller.settle);
