import mongoose, { FilterQuery, Types } from 'mongoose';
import { Medicine } from '../models/Medicine.model';
import { StockMovement, StockMovementDoc } from '../models/StockMovement.model';
import { StockAdjustment } from '../models/StockAdjustment.model';
import { buildPagination, Pagination } from '../utils/response';
import { serializeLeanMedicine } from '../utils/serializeLean';
import { atomicAddBatchStock, atomicDeductBatchStock, atomicSetBatchStock } from './stockMutation';
import { expiryTierBounds } from './expiryClassification';
import { AdjustStockBody, ListMovementsQuery } from '../validators/inventory.validators';

interface Actor {
  employeeId: string;
  name: string;
}

export async function adjustStock(input: AdjustStockBody, actor: Actor): Promise<StockMovementDoc> {
  const session = await mongoose.startSession();
  try {
    let movement!: StockMovementDoc;

    await session.withTransaction(async () => {
      let previousBatchQuantity: number;
      let newBatchQuantity: number;
      let medicineName: string;
      let batchNumber: string;
      let movementType: 'Adjustment' | 'Damaged' | 'Expired';

      switch (input.adjustmentType) {
        case 'Add Stock': {
          const r = await atomicAddBatchStock(session, input.medicineId, input.batchId, input.quantity);
          ({ previousBatchQuantity, newBatchQuantity, medicineName, batchNumber } = r);
          movementType = 'Adjustment';
          break;
        }
        case 'Subtract Stock': {
          // No enforceNotExpired here — a physical shrinkage/loss correction must
          // be able to target any batch regardless of expiry state.
          const r = await atomicDeductBatchStock(session, input.medicineId, input.batchId, input.quantity);
          ({ previousBatchQuantity, newBatchQuantity, medicineName, batchNumber } = r);
          movementType = 'Adjustment';
          break;
        }
        case 'Mark Damaged': {
          const r = await atomicDeductBatchStock(session, input.medicineId, input.batchId, input.quantity);
          ({ previousBatchQuantity, newBatchQuantity, medicineName, batchNumber } = r);
          movementType = 'Damaged';
          break;
        }
        case 'Mark Expired': {
          const r = await atomicDeductBatchStock(session, input.medicineId, input.batchId, input.quantity);
          ({ previousBatchQuantity, newBatchQuantity, medicineName, batchNumber } = r);
          movementType = 'Expired';
          break;
        }
        case 'Set Stock (Audit)': {
          const r = await atomicSetBatchStock(session, input.medicineId, input.batchId, input.quantity);
          previousBatchQuantity = r.previousQuantity;
          newBatchQuantity = r.newQuantity;
          medicineName = r.medicineName;
          batchNumber = r.batchNumber;
          movementType = 'Adjustment';
          break;
        }
      }

      const [adjustmentRecord] = await StockAdjustment.create(
        [
          {
            medicineId: input.medicineId,
            medicineName,
            batchId: input.batchId,
            batchNumber,
            adjustmentType: input.adjustmentType,
            quantity: input.quantity,
            reason: input.reason,
            notes: input.notes,
            adjustedBy: actor.employeeId
          }
        ],
        { session }
      );

      const [createdMovement] = await StockMovement.create(
        [
          {
            medicineId: input.medicineId,
            medicineName,
            batchNumber,
            type: movementType,
            quantityChange: newBatchQuantity - previousBatchQuantity,
            previousStock: previousBatchQuantity,
            newStock: newBatchQuantity,
            user: actor.name,
            referenceId: adjustmentRecord.id,
            notes: `${input.reason}${input.notes ? ` — ${input.notes}` : ''}`
          }
        ],
        { session }
      );

      movement = createdMovement;
    });

    return movement;
  } finally {
    await session.endSession();
  }
}

export async function listMovements(query: ListMovementsQuery): Promise<{ items: StockMovementDoc[]; pagination: Pagination }> {
  const filter: FilterQuery<StockMovementDoc> = {};
  if (query.medicineId) filter.medicineId = query.medicineId;
  if (query.type) filter.type = query.type;
  if (query.referenceId) filter.referenceId = query.referenceId;

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    StockMovement.find(filter).sort({ date: -1 }).skip(skip).limit(query.limit),
    StockMovement.countDocuments(filter)
  ]);

  return { items, pagination: buildPagination(query.page, query.limit, total) };
}

export async function listAdjustments(page: number, limit: number) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    StockAdjustment.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    StockAdjustment.countDocuments()
  ]);
  return { items, pagination: buildPagination(page, limit, total) };
}

interface ExpiryRadarItem {
  medicineId: string;
  medicineName: string;
  genericName: string;
  category: string;
  batchId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date;
  purchasePrice: number;
  mrp: number;
  lossExposure: number;
  daysRemaining: number;
}

/**
 * Cross-medicine near-expiry surveillance (<90d), replacing the client-side
 * `medicines.flatMap(...).filter(...)` computation in InventoryPage.tsx/
 * DashboardPage.tsx with a bounded, indexed, server-computed aggregation.
 * lossExposure uses purchase cost (not MRP) — what the pharmacy actually loses
 * if the stock expires unsold, not foregone revenue.
 */
export async function getExpiryRadar(
  tier: 'critical' | 'near' | 'watchlist' | 'all',
  page: number,
  limit: number
): Promise<{ items: ExpiryRadarItem[]; pagination: Pagination; tier: string }> {
  const now = new Date();
  const { lower, upper } = expiryTierBounds(tier, now);
  const skip = (page - 1) * limit;

  const [result] = await Medicine.aggregate([
    { $match: { status: 'Active' } },
    { $unwind: '$batches' },
    { $match: { 'batches.quantity': { $gt: 0 }, 'batches.expiryDate': { $gt: lower, $lte: upper } } },
    { $sort: { 'batches.expiryDate': 1 } },
    {
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              medicineId: '$_id',
              medicineName: '$name',
              genericName: '$genericName',
              category: '$category',
              batchId: '$batches._id',
              batchNumber: '$batches.batchNumber',
              quantity: '$batches.quantity',
              expiryDate: '$batches.expiryDate',
              purchasePrice: '$batches.purchasePrice',
              mrp: '$batches.mrp',
              lossExposure: { $multiply: ['$batches.quantity', '$batches.purchasePrice'] }
            }
          }
        ],
        totalCount: [{ $count: 'count' }]
      }
    }
  ]);

  const items: ExpiryRadarItem[] = (result?.data ?? []).map(
    (d: {
      medicineId: Types.ObjectId;
      medicineName: string;
      genericName: string;
      category: string;
      batchId: Types.ObjectId;
      batchNumber: string;
      quantity: number;
      expiryDate: Date;
      purchasePrice: number;
      mrp: number;
      lossExposure: number;
    }) => ({
      ...d,
      medicineId: d.medicineId.toString(),
      batchId: d.batchId.toString(),
      daysRemaining: Math.ceil((d.expiryDate.getTime() - now.getTime()) / (24 * 3600 * 1000))
    })
  );

  const total = result?.totalCount?.[0]?.count ?? 0;
  return { items, pagination: buildPagination(page, limit, total), tier };
}

/** Medicines at or below their configured reorder threshold. */
export async function getLowStock(page: number, limit: number) {
  const filter = { status: 'Active', $expr: { $lte: ['$totalStock', '$reorderLevel'] } };
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Medicine.find(filter).sort({ totalStock: 1 }).skip(skip).limit(limit).lean(),
    Medicine.countDocuments(filter)
  ]);

  return {
    items: items.map((d) => serializeLeanMedicine(d as unknown as Record<string, unknown>)),
    pagination: buildPagination(page, limit, total)
  };
}
