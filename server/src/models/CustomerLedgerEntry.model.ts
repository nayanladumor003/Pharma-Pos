import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { CUSTOMER_LEDGER_ENTRY_TYPES } from './enums';

/**
 * Append-only, immutable — never updated or deleted. Every event that changes
 * Customer.outstandingBalance (credit sale, settlement, return-to-credit-note)
 * writes one entry here in the same transaction (see plan §13/§15). This is
 * what makes the Khata balance traceable instead of a bare `balance += amount`.
 */
const customerLedgerEntrySchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    type: { type: String, enum: CUSTOMER_LEDGER_ENTRY_TYPES, required: true },
    // Signed: positive increases outstandingBalance (CreditSale), negative
    // decreases it (Payment, or an Adjustment writing off a balance).
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    referenceId: { type: String, required: true },
    notes: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

customerLedgerEntrySchema.index({ customerId: 1, createdAt: -1 });

toJSONPlugin(customerLedgerEntrySchema);

export const CustomerLedgerEntry = model('CustomerLedgerEntry', customerLedgerEntrySchema);
export type CustomerLedgerEntryDoc = InstanceType<typeof CustomerLedgerEntry>;
