import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/inventory.controller';
import {
  adjustStockSchema,
  expiryRadarQuerySchema,
  listMovementsQuerySchema,
  paginationQuerySchema
} from '../validators/inventory.validators';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

inventoryRouter.get('/movements', requirePermission('view_inventory'), validate(listMovementsQuerySchema), controller.movements);
inventoryRouter.get('/adjustments', requirePermission('view_inventory'), validate(paginationQuerySchema), controller.adjustments);
inventoryRouter.post('/adjustments', requirePermission('adjust_inventory'), validate(adjustStockSchema), controller.adjust);
inventoryRouter.get('/expiry-radar', requirePermission('view_inventory'), validate(expiryRadarQuerySchema), controller.expiryRadar);
inventoryRouter.get('/low-stock', requirePermission('view_inventory'), validate(paginationQuerySchema), controller.lowStock);
