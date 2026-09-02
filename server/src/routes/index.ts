import { Router } from 'express';
import { healthRouter } from './health.route';
import { authRouter } from './auth.route';
import { medicineRouter } from './medicine.route';
import { inventoryRouter } from './inventory.route';
import { salesRouter } from './sales.route';
import { customerRouter } from './customer.route';
import { supplierRouter } from './supplier.route';
import { purchaseRouter } from './purchase.route';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/medicines', medicineRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/sales', salesRouter);
apiRouter.use('/customers', customerRouter);
apiRouter.use('/suppliers', supplierRouter);
apiRouter.use('/purchases', purchaseRouter);

// Resource routers (prescriptions, returns, expenses, employees, settings,
// reports) are mounted here incrementally in later phases.
