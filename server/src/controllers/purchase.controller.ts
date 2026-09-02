import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import * as purchaseService from '../services/purchaseService';
import { CreatePurchaseBody, ListPurchasesQuery } from '../validators/purchase.validators';

export const create = catchAsync(async (req: Request, res: Response) => {
  const { purchaseOrder, isReplay } = await purchaseService.createPurchaseOrder(req.body as CreatePurchaseBody, {
    employeeId: req.user!.employeeId,
    name: req.user!.name
  });
  sendSuccess(res, purchaseOrder, isReplay ? 200 : 201);
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const query = req.validated!.query as ListPurchasesQuery;
  const { items, pagination } = await purchaseService.listPurchases(query);
  sendPaginated(res, items, pagination);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const purchaseOrder = await purchaseService.getPurchaseById(id);
  sendSuccess(res, purchaseOrder);
});
