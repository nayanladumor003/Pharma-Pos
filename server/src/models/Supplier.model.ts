import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    drugLicense: { type: String, trim: true },
    drugLicenseNumber: { type: String, trim: true },
    creditDays: { type: Number, default: 0, min: 0 },
    // Fast-read cache only — supplierLedgerEntries is the source of truth (see plan §13).
    outstandingAmount: { type: Number, default: 0, min: 0 },
    totalPurchases: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }
  },
  { timestamps: true }
);

supplierSchema.index({ name: 'text', contactPerson: 'text' });
supplierSchema.index({ phone: 1 });
supplierSchema.index({ gstin: 1 });

toJSONPlugin(supplierSchema);

export const Supplier = model('Supplier', supplierSchema);
export type SupplierDoc = InstanceType<typeof Supplier>;
