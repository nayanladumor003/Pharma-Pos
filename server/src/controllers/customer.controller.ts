import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import * as customerService from '../services/customerService';
import { CreateCustomerBody, ListCustomersQuery, SettleBalanceBody, UpdateCustomerBody } from '../validators/customer.validators';

export const list = catchAsync(async (req: Request, res: Response) => {
  const query = req.validated!.query as ListCustomersQuery;
  const { items, pagination } = await customerService.listCustomers(query);
  sendPaginated(res, items, pagination);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const customer = await customerService.getCustomerById(id);
  sendSuccess(res, customer);
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const customer = await customerService.createCustomer(req.body as CreateCustomerBody);
  sendSuccess(res, customer, 201);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const customer = await customerService.updateCustomer(id, req.body as UpdateCustomerBody);
  sendSuccess(res, customer);
});

export const ledger = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const { page, limit } = req.validated!.query as { page: number; limit: number };
  const { items, pagination } = await customerService.getCustomerLedger(id, page, limit);
  sendPaginated(res, items, pagination);
});

export const settle = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const body = req.body as SettleBalanceBody;
  const result = await customerService.settleCustomerBalance(id, body, {
    employeeId: req.user!.employeeId,
    name: req.user!.name
  });
  sendSuccess(res, result, 201);
});
