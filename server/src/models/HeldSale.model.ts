import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { cartItemSchema } from './shared/cartItem.schema';

/**
 * Server-persisted parked cart (replaces the pharmapos_held_sales_v1 localStorage
 * key — plan §11 treats a held cart as real in-progress business state, not a
 * UI preference). Scoped per cashier/register via cashierId so one pharmacist's
 * held sales aren't visible/resumable by another at a different counter.
 */
const heldSaleSchema = new Schema(
  {
    name: { type: String, required: true },
    heldAt: { type: Date, required: true, default: Date.now },
    cashierId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerSnapshot: {
      type: new Schema(
        { id: String, name: String, phone: String },
        { _id: false }
      ),
      default: undefined
    },
    items: { type: [cartItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, required: true },
    discountPercent: { type: Number, default: 0 },
    taxTotal: { type: Number, required: true },
    grandTotal: { type: Number, required: true }
  },
  { timestamps: true }
);

heldSaleSchema.index({ cashierId: 1 });

toJSONPlugin(heldSaleSchema);

export const HeldSale = model('HeldSale', heldSaleSchema);
