import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';

const ADJUSTMENT_TYPES = ['Add Stock', 'Subtract Stock', 'Set Stock (Audit)', 'Mark Damaged', 'Mark Expired'] as const;

/**
 * The structured "why/who/what was requested" record for a manual inventory
 * correction — distinct from StockMovement, which is the generic ledger entry
 * every stock change (purchase, sale, return, adjustment) produces. One
 * adjustment produces exactly one linked StockMovement (via referenceId),
 * matching the original frontend's inventoryService.adjustStock behavior.
 */
const stockAdjustmentSchema = new Schema(
  {
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    batchId: { type: String, required: true },
    batchNumber: { type: String, required: true },
    adjustmentType: { type: String, enum: ADJUSTMENT_TYPES, required: true },
    quantity: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    notes: { type: String },
    adjustedBy: { type: Schema.Types.ObjectId, ref: 'Employee', required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockAdjustmentSchema.index({ medicineId: 1, createdAt: -1 });

toJSONPlugin(stockAdjustmentSchema);

export const StockAdjustment = model('StockAdjustment', stockAdjustmentSchema);
