import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { SUPPLIER_LEDGER_ENTRY_TYPES } from './enums';

/**
 * Append-only, immutable — never updated or deleted. Every event that changes
 * Supplier.outstandingAmount writes one entry here in the same transaction, so
 * the cached balance is always reconstructable/auditable (plan §13, resolved
 * decision #1: "do not implement supplier balance as an untraceable counter").
 */
const supplierLedgerEntrySchema = new Schema(
  {
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    type: { type: String, enum: SUPPLIER_LEDGER_ENTRY_TYPES, required: true },
    // Signed: positive increases outstandingAmount (e.g. PurchaseCredit), negative
    // decreases it (e.g. Payment, PurchaseReturnDebit reversing a credit).
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    referenceId: { type: String, required: true },
    notes: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

supplierLedgerEntrySchema.index({ supplierId: 1, createdAt: -1 });

toJSONPlugin(supplierLedgerEntrySchema);

export const SupplierLedgerEntry = model('SupplierLedgerEntry', supplierLedgerEntrySchema);
export type SupplierLedgerEntryDoc = InstanceType<typeof SupplierLedgerEntry>;
