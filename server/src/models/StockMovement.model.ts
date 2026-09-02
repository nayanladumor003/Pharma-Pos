import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { STOCK_MOVEMENT_TYPES } from './enums';

/**
 * Immutable audit ledger — append-only, never updated/deleted (".ai/skills/inventory.md"
 * invariant: "NEVER delete historical StockMovement records"). No `updatedAt` on
 * purpose: an "immutable" log having a mutation timestamp would be a contradiction.
 */
const stockMovementSchema = new Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    batchNumber: { type: String, required: true },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    quantityChange: { type: Number, required: true },
    previousStock: { type: Number, required: true, min: 0 },
    newStock: { type: Number, required: true, min: 0 },
    user: { type: String, required: true },
    referenceId: { type: String, required: true },
    notes: { type: String }
  },
  { timestamps: false }
);

stockMovementSchema.index({ medicineId: 1, date: -1 });
stockMovementSchema.index({ referenceId: 1 });
stockMovementSchema.index({ type: 1 });

toJSONPlugin(stockMovementSchema);

export const StockMovement = model('StockMovement', stockMovementSchema);
export type StockMovementDoc = InstanceType<typeof StockMovement>;
