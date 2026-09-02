import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';

/**
 * Singleton document (fixed _id) — the app is confirmed single-store (no
 * multi-tenant concept exists in the current frontend), so one document with
 * three embedded sub-objects mirrors the current 3-way localStorage split
 * (pharmapos_store_settings_v1 / _pos_ / _inv_) without over-engineering a
 * multi-tenant/keyed shape nothing in the product needs yet.
 */
export const SETTINGS_SINGLETON_ID = 'default';

const storeSettingsSchema = new Schema(
  {
    name: { type: String, required: true },
    tagline: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },
    phone: { type: String },
    email: { type: String },
    gstin: { type: String },
    drugLicenseNumber20B: { type: String },
    drugLicenseNumber21B: { type: String },
    fssaiNumber: { type: String }
  },
  { _id: false }
);

const posSettingsSchema = new Schema(
  {
    defaultTaxRate: { type: Number, default: 12, min: 0, max: 100 },
    invoicePrefix: { type: String, default: 'INV-' },
    thermalReceiptWidth: { type: String, enum: ['58mm', '80mm', 'A4'], default: '80mm' },
    autoPrintReceipt: { type: Boolean, default: true },
    enableSoundEffects: { type: Boolean, default: true },
    enableFEFOSuggestion: { type: Boolean, default: true },
    // Server-enforced, not just a UI hint (plan §17) — sale creation must honor this.
    allowNegativeStock: { type: Boolean, default: false },
    requireDoctorNameForRx: { type: Boolean, default: true },
    roundOffTotal: { type: Boolean, default: true }
  },
  { _id: false }
);

const inventorySettingsSchema = new Schema(
  {
    lowStockThreshold: { type: Number, default: 20, min: 0 },
    criticalStockThreshold: { type: Number, default: 5, min: 0 },
    expiryWarningDays: { type: Number, default: 90, min: 0 },
    criticalExpiryDays: { type: Number, default: 30, min: 0 },
    enforceFEFO: { type: Boolean, default: true },
    autoReorderAlerts: { type: Boolean, default: true }
  },
  { _id: false }
);

const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_SINGLETON_ID },
    store: { type: storeSettingsSchema, required: true },
    pos: { type: posSettingsSchema, required: true },
    inventory: { type: inventorySettingsSchema, required: true }
  },
  { timestamps: true }
);

toJSONPlugin(settingsSchema);

export const Settings = model('Settings', settingsSchema);
