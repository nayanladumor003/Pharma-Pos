import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/sales.controller';
import { createSaleSchema, listSalesQuerySchema, quoteSaleSchema, saleIdParamSchema } from '../validators/sales.validators';

export const salesRouter = Router();

salesRouter.use(requireAuth);

salesRouter.post('/quote', requirePermission('view_pos'), validate(quoteSaleSchema), controller.quote);
salesRouter.post('/', requirePermission('create_sale'), validate(createSaleSchema), controller.create);
salesRouter.get('/', requirePermission('create_sale'), validate(listSalesQuerySchema), controller.list);
salesRouter.get('/:id', requirePermission('create_sale'), validate(saleIdParamSchema), controller.getById);
