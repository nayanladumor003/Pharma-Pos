import { Schema } from 'mongoose';

/**
 * Shared shape for a priced/taxed line item snapshot — used by both Sale.items
 * (a finalized invoice) and HeldSale.items (a parked-but-not-yet-sold cart).
 * batchId addresses a subdocument inside Medicine.batches; Mongoose can't
 * `ref`-populate into a nested array element of another document, so it's a
 * plain string resolved via medicineId + batchId together at the service layer.
 */
export const cartItemSchema = new Schema(
  {
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    genericName: { type: String },
    brand: { type: String },
    dosageForm: { type: String },
    strength: { type: String },
    packSize: { type: String },
    batchId: { type: String, required: true },
    batchNumber: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    availableBatchStock: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    purchasePrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    prescriptionRequired: { type: Boolean, default: false }
  },
  { _id: false }
);
