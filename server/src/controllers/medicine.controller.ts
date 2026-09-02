import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import * as medicineService from '../services/medicineService';
import { BatchInput, CreateMedicineBody, ListMedicinesQuery, UpdateMedicineBody } from '../validators/medicine.validators';

export const list = catchAsync(async (req: Request, res: Response) => {
  const query = req.validated!.query as ListMedicinesQuery;
  const { items, pagination } = await medicineService.listMedicines(query);
  sendPaginated(res, items, pagination);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const med = await medicineService.getMedicineById(id);
  sendSuccess(res, med);
});

export const getByBarcode = catchAsync(async (req: Request, res: Response) => {
  const { barcode } = req.validated!.params as { barcode: string };
  const med = await medicineService.getMedicineByBarcode(barcode);
  sendSuccess(res, med);
});

export const getBySku = catchAsync(async (req: Request, res: Response) => {
  const { sku } = req.validated!.params as { sku: string };
  const med = await medicineService.getMedicineBySku(sku);
  sendSuccess(res, med);
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const med = await medicineService.createMedicine(req.body as CreateMedicineBody);
  sendSuccess(res, med, 201);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const med = await medicineService.updateMedicine(id, req.body as UpdateMedicineBody);
  sendSuccess(res, med);
});

export const archive = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const med = await medicineService.archiveMedicine(id);
  sendSuccess(res, med);
});

export const addBatch = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.validated!.params as { id: string };
  const med = await medicineService.addBatch(id, req.body as BatchInput);
  sendSuccess(res, med, 201);
});

export const updateBatch = catchAsync(async (req: Request, res: Response) => {
  const { id, batchId } = req.validated!.params as { id: string; batchId: string };
  const med = await medicineService.updateBatchMeta(id, batchId, req.body as Partial<BatchInput>);
  sendSuccess(res, med);
});
