import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import * as inventoryService from '../services/inventoryService';
import { AdjustStockBody, ExpiryRadarQuery, ListMovementsQuery } from '../validators/inventory.validators';

export const adjust = catchAsync(async (req: Request, res: Response) => {
  const movement = await inventoryService.adjustStock(req.body as AdjustStockBody, {
    employeeId: req.user!.employeeId,
    name: req.user!.name
  });
  sendSuccess(res, movement, 201);
});

export const movements = catchAsync(async (req: Request, res: Response) => {
  const query = req.validated!.query as ListMovementsQuery;
  const { items, pagination } = await inventoryService.listMovements(query);
  sendPaginated(res, items, pagination);
});

export const adjustments = catchAsync(async (req: Request, res: Response) => {
  const { page, limit } = req.validated!.query as { page: number; limit: number };
  const { items, pagination } = await inventoryService.listAdjustments(page, limit);
  sendPaginated(res, items, pagination);
});

export const expiryRadar = catchAsync(async (req: Request, res: Response) => {
  const { tier, page, limit } = req.validated!.query as ExpiryRadarQuery;
  const { items, pagination } = await inventoryService.getExpiryRadar(tier, page, limit);
  sendPaginated(res, items, pagination);
});

export const lowStock = catchAsync(async (req: Request, res: Response) => {
  const { page, limit } = req.validated!.query as { page: number; limit: number };
  const { items, pagination } = await inventoryService.getLowStock(page, limit);
  sendPaginated(res, items, pagination);
});
