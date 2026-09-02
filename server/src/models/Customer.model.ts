import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { GENDERS } from './enums';

const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    patientAge: { type: Number, min: 0, max: 130 },
    patientGender: { type: String, enum: GENDERS },
    loyaltyPoints: { type: Number, default: 0, min: 0 },
    creditLimit: { type: Number, default: 0, min: 0 },
    // Fast-read cache only — customerLedgerEntries is the source of truth (see plan §13).
    outstandingBalance: { type: Number, default: 0, min: 0 },
    totalPurchases: { type: Number, default: 0, min: 0 },
    lastVisit: { type: Date },
    notes: { type: String },
    allergies: { type: [String], default: [] },
    chronicConditions: { type: [String], default: [] },
    doctorName: { type: String, trim: true }
  },
  { timestamps: true }
);

customerSchema.index({ name: 'text' });
customerSchema.index({ phone: 1 });

toJSONPlugin(customerSchema);

export const Customer = model('Customer', customerSchema);
export type CustomerDoc = InstanceType<typeof Customer>;
