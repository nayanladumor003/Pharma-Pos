import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { PAYMENT_STATUSES, PURCHASE_ORDER_STATUSES } from './enums';

// Point-in-time snapshot of what was actually received (same reasoning as
// saleItemSchema). sellingPrice is REQUIRED here on purpose: the old
// `sellingPrice = Math.round(mrp * 0.92)` auto-margin rule found during the
// audit is dropped (resolved decision #2) — purchasing staff must set it
// explicitly per batch, validated below against mrp.
const purchaseItemSchema = new Schema(
  {
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    batchNumber: { type: String, required: true },
    mfgDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 1 },
    freeQuantity: { type: Number, default: 0, min: 0 },
    purchasePrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function (this: { mrp: number }, value: number) {
          return value <= this.mrp;
        },
        message: 'sellingPrice cannot exceed mrp'
      }
    },
    taxRate: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    total: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const purchaseOrderSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    orderDate: { type: Date, required: true },
    deliveryDate: { type: Date },
    expectedDeliveryDate: { type: Date },
    receivedDate: { type: Date },
    items: { type: [purchaseItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, required: true },
    taxTotal: { type: Number, required: true },
    discountTotal: { type: Number, required: true, default: 0 },
    grandTotal: { type: Number, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'Pending' },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: PURCHASE_ORDER_STATUSES, default: 'Ordered' },
    notes: { type: String },
    // Same idempotency pattern as Sale (see Sale.model.ts) — unique sparse
    // index is the concurrency-safe guarantee; the payload hash distinguishes
    // an exact retry from the key being reused for a different request.
    idempotencyKey: { type: String },
    idempotencyPayloadHash: { type: String }
  },
  { timestamps: true }
);

// Prevents accidentally logging the same supplier invoice twice.
purchaseOrderSchema.index({ supplierId: 1, invoiceNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ orderDate: -1 });
purchaseOrderSchema.index({ status: 1 });
purchaseOrderSchema.index({ paymentStatus: 1 });
purchaseOrderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

toJSONPlugin(purchaseOrderSchema);

export const PurchaseOrder = model('PurchaseOrder', purchaseOrderSchema);
export type PurchaseOrderDoc = InstanceType<typeof PurchaseOrder>;
