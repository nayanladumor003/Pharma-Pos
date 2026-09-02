import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { REFUND_METHODS, SALES_RETURN_REASONS } from './enums';

const salesReturnItemSchema = new Schema(
  {
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    batchNumber: { type: String, required: true },
    returnQuantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    refundAmount: { type: Number, required: true, min: 0 },
    reason: { type: String, enum: SALES_RETURN_REASONS, required: true }
  },
  { _id: false }
);

const salesReturnSchema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true },
    // Proper document reference, replacing the old service's string-only
    // originalInvoiceNumber linkage — needed to actually validate returnQuantity
    // against the original sale's billed quantity (BUSINESS_RULES.md Rule 5.1).
    originalSaleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    originalInvoiceNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    items: { type: [salesReturnItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    totalRefundAmount: { type: Number, required: true, min: 0 },
    refundMethod: { type: String, enum: REFUND_METHODS, required: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    notes: { type: String }
  },
  { timestamps: true }
);

salesReturnSchema.index({ originalInvoiceNumber: 1 });
salesReturnSchema.index({ originalSaleId: 1 });
salesReturnSchema.index({ customerId: 1 });
salesReturnSchema.index({ date: -1 });

toJSONPlugin(salesReturnSchema);

export const SalesReturn = model('SalesReturn', salesReturnSchema);
