import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { PURCHASE_RETURN_REASONS, PURCHASE_RETURN_STATUSES } from './enums';

const purchaseReturnItemSchema = new Schema(
  {
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    batchNumber: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    purchasePrice: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    reason: { type: String, enum: PURCHASE_RETURN_REASONS, required: true }
  },
  { _id: false }
);

const purchaseReturnSchema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    purchaseInvoiceNumber: { type: String, required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    items: { type: [purchaseReturnItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: PURCHASE_RETURN_STATUSES, default: 'Pending' },
    notes: { type: String }
  },
  { timestamps: true }
);

purchaseReturnSchema.index({ purchaseInvoiceNumber: 1 });
purchaseReturnSchema.index({ supplierId: 1 });
purchaseReturnSchema.index({ date: -1 });

toJSONPlugin(purchaseReturnSchema);

export const PurchaseReturn = model('PurchaseReturn', purchaseReturnSchema);
