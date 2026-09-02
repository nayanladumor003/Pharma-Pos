import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import * as salesService from '../services/salesService';
import { CreateSaleBody, ListSalesQuery, QuoteSaleBody } from '../validators/sales.validators';

export const quote = catchAsync(async (req: Request, res: Response) => {
  const result = await salesService.quoteSale(req.body as QuoteSaleBody);
  sendSuccess(res, result);
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const { sale, isReplay } = await salesService.createSale(req.body as CreateSaleBody, {
    employeeId: req.user!.employeeId,
    name: req.user!.name
  });
  sendSuccess(res, sale, isReplay ? 200 : 201);
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const query = req.validated!.query as ListSalesQuery;
  const { items, pagination } = await salesService.listSales(query);
  sendPaginated(res, items, pagination);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const sale = await salesService.getSaleById(id);
  sendSuccess(res, sale);
});
