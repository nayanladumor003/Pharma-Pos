import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/purchase.controller';
import { createPurchaseSchema, listPurchasesQuerySchema, purchaseIdParamSchema } from '../validators/purchase.validators';

export const purchaseRouter = Router();

purchaseRouter.use(requireAuth);
purchaseRouter.use(requirePermission('manage_purchases'));

purchaseRouter.post('/', validate(createPurchaseSchema), controller.create);
purchaseRouter.get('/', validate(listPurchasesQuerySchema), controller.list);
purchaseRouter.get('/:id', validate(purchaseIdParamSchema), controller.getById);
