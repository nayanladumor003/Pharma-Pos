import { Schema, model, Types } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { BATCH_STATUSES, DOSAGE_FORMS, MEDICINE_CATEGORIES, MEDICINE_STATUSES } from './enums';

/** Atlas Search nGram-autocomplete index name — see scripts/createSearchIndexes.ts and services/medicineService.ts. */
export const MEDICINE_SEARCH_INDEX = 'medicines_autocomplete';

export interface BatchDoc {
  _id: Types.ObjectId;
  batchNumber: string;
  supplierId: Types.ObjectId;
  supplierName: string;
  quantity: number;
  purchasePrice: number;
  mrp: number;
  sellingPrice: number;
  mfgDate: Date;
  expiryDate: Date;
  status: (typeof BATCH_STATUSES)[number];
  rackLocation?: string;
}

export interface MedicineDoc {
  _id: Types.ObjectId;
  name: string;
  genericName: string;
  brand: string;
  category: (typeof MEDICINE_CATEGORIES)[number];
  manufacturer?: string;
  dosageForm: (typeof DOSAGE_FORMS)[number];
  strength: string;
  packSize: string;
  sku?: string;
  barcode?: string;
  purchasePrice: number;
  mrp: number;
  sellingPrice: number;
  gstRate: number;
  hsnCode?: string;
  reorderLevel: number;
  totalStock: number;
  prescriptionRequired: boolean;
  storageInstructions?: string;
  batches: Types.DocumentArray<BatchDoc>;
  status: (typeof MEDICINE_STATUSES)[number];
  description?: string;
  sideEffects?: string;
  rackLocation?: string;
  isScheduleH?: boolean;
}

// batchNumber/supplierName/supplierId are point-in-time snapshots from the
// receiving purchase order — deliberately not re-derived from the supplier
// record on every read (see plan §13, "sale/purchase items are immutable
// snapshots"). medicineId/medicineName are intentionally NOT duplicated here;
// this subdocument only ever exists nested under its parent Medicine.
const batchSchema = new Schema<BatchDoc>(
  {
    batchNumber: { type: String, required: true, trim: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    purchasePrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function (this: BatchDoc, value: number) {
          return value <= this.mrp;
        },
        message: 'sellingPrice cannot exceed mrp'
      }
    },
    mfgDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    // 'Active' | 'Expired' | 'Out of Stock' is deterministic (quantity + expiryDate)
    // and is recomputed by the pre-save hook below — never trust a client-supplied
    // status. The finer near-expiry tiers (<30d/<60d/<90d) from BUSINESS_RULES.md
    // are query-time classification (see inventory service), not a stored field,
    // since their thresholds come from configurable InventorySettings.
    status: { type: String, enum: BATCH_STATUSES, default: 'Active' },
    rackLocation: { type: String, trim: true }
  },
  { _id: true }
);
toJSONPlugin(batchSchema);

const medicineSchema = new Schema<MedicineDoc>(
  {
    name: { type: String, required: true, trim: true },
    genericName: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    category: { type: String, enum: MEDICINE_CATEGORIES, required: true },
    manufacturer: { type: String, trim: true },
    dosageForm: { type: String, enum: DOSAGE_FORMS, required: true },
    strength: { type: String, required: true },
    packSize: { type: String, required: true },
    sku: { type: String, trim: true },
    barcode: { type: String, trim: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    gstRate: { type: Number, required: true, min: 0, max: 100 },
    hsnCode: { type: String, trim: true },
    reorderLevel: { type: Number, required: true, min: 0, default: 0 },
    // Derived cache, recalculated from `batches` in the pre-save hook — never
    // set directly. Enforces the ".ai/skills/inventory.md" invariant "NEVER
    // modify batch quantities without updating the parent medicine.totalStock"
    // at the model layer instead of relying on every call site to remember.
    totalStock: { type: Number, default: 0, min: 0 },
    prescriptionRequired: { type: Boolean, default: false },
    storageInstructions: { type: String, trim: true },
    batches: { type: [batchSchema], default: [] },
    status: { type: String, enum: MEDICINE_STATUSES, default: 'Active' },
    description: { type: String },
    sideEffects: { type: String },
    rackLocation: { type: String, trim: true },
    isScheduleH: { type: Boolean, default: false }
  },
  { timestamps: true }
);

medicineSchema.pre('save', function (next) {
  const now = Date.now();
  for (const batch of this.batches) {
    if (batch.expiryDate.getTime() <= now) {
      batch.status = 'Expired';
    } else if (batch.quantity <= 0) {
      batch.status = 'Out of Stock';
    } else {
      batch.status = 'Active';
    }
  }
  this.totalStock = this.batches.reduce((sum, b) => sum + (b.status === 'Expired' ? 0 : b.quantity), 0);
  next();
});

// Free-text POS search uses the Atlas Search index (MEDICINE_SEARCH_INDEX,
// created by scripts/createSearchIndexes.ts) instead of a standard MongoDB
// text index — see services/medicineService.ts for why.
medicineSchema.index({ barcode: 1 }, { unique: true, sparse: true });
medicineSchema.index({ sku: 1 }, { unique: true, sparse: true });
medicineSchema.index({ category: 1 });
medicineSchema.index({ manufacturer: 1 });
medicineSchema.index({ 'batches.expiryDate': 1 });
medicineSchema.index({ 'batches.status': 1 });
medicineSchema.index({ 'batches.quantity': 1 });

toJSONPlugin(medicineSchema);

export const Medicine = model<MedicineDoc>('Medicine', medicineSchema);
