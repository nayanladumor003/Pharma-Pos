import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import * as supplierService from '../services/supplierService';
import { CreateSupplierBody, ListSuppliersQuery, PaySupplierBody, UpdateSupplierBody } from '../validators/supplier.validators';

export const list = catchAsync(async (req: Request, res: Response) => {
  const query = req.validated!.query as ListSuppliersQuery;
  const { items, pagination } = await supplierService.listSuppliers(query);
  sendPaginated(res, items, pagination);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const supplier = await supplierService.getSupplierById(id);
  sendSuccess(res, supplier);
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const supplier = await supplierService.createSupplier(req.body as CreateSupplierBody);
  sendSuccess(res, supplier, 201);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const supplier = await supplierService.updateSupplier(id, req.body as UpdateSupplierBody);
  sendSuccess(res, supplier);
});

export const ledger = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const { page, limit } = req.validated!.query as { page: number; limit: number };
  const { items, pagination } = await supplierService.getSupplierLedger(id, page, limit);
  sendPaginated(res, items, pagination);
});

export const pay = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const body = req.body as PaySupplierBody;
  const result = await supplierService.paySupplierBalance(id, body, {
    employeeId: req.user!.employeeId,
    name: req.user!.name
  });
  sendSuccess(res, result, 201);
});
