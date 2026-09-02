import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { cartItemSchema } from './shared/cartItem.schema';
import { PAYMENT_METHODS, SALE_STATUSES, SPLIT_PAYMENT_METHODS } from './enums';

const splitPaymentDetailSchema = new Schema(
  {
    method: { type: String, enum: SPLIT_PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 0 },
    reference: { type: String }
  },
  { _id: false }
);

const saleSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    date: { type: Date, required: true, default: Date.now },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true },
    customerPhone: { type: String },
    doctorName: { type: String },
    items: { type: [cartItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    itemCount: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    discountTotal: { type: Number, required: true },
    taxTotal: { type: Number, required: true },
    roundOff: { type: Number, required: true, default: 0 },
    grandTotal: { type: Number, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    splitDetails: { type: [splitPaymentDetailSchema], default: undefined },
    amountPaid: { type: Number, required: true },
    changeDue: { type: Number, required: true, default: 0 },
    status: { type: String, enum: SALE_STATUSES, default: 'Completed' },
    cashierId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    cashierName: { type: String, required: true },
    storeName: { type: String, required: true },
    notes: { type: String },
    // Client-generated key so a double-click on "Complete Sale" can't create two
    // invoices (plan Phase 24). Sparse+unique: most historical/seeded rows won't
    // have one, new sales always will. The unique index is the actual
    // concurrency-safe guarantee (two simultaneous requests with the same key
    // racing to insert — the DB itself rejects the second one atomically);
    // idempotencyPayloadHash lets the service tell "exact retry" (same
    // request, return the original sale) apart from "key reused for a
    // different request" (reject, don't silently return stale data).
    idempotencyKey: { type: String },
    idempotencyPayloadHash: { type: String }
  },
  { timestamps: true }
);

saleSchema.index({ customerId: 1 });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ createdAt: -1, paymentMethod: 1 });
saleSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

toJSONPlugin(saleSchema);

export const Sale = model('Sale', saleSchema);
export type SaleDoc = InstanceType<typeof Sale>;
