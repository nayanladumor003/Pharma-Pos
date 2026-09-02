import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { GENDERS, PRESCRIPTION_STATUSES, TIMINGS } from './enums';

// medicineId is optional: a prescription frequently names a drug the pharmacy
// hasn't catalogued yet (handwritten Rx, generic substitution). The old
// frontend's prescriptionService.normalizePrescription() papered over this by
// synthesizing fake `med-mapped-N` ids — here it's modeled honestly instead.
// This is also the single canonical item shape (drops the redundant legacy
// `items` vs `medicines` dual representation the frontend used to reconcile
// at runtime — see audit discrepancy #4).
const prescriptionItemSchema = new Schema(
  {
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine' },
    medicineName: { type: String, required: true },
    dosage: { type: String, required: true },
    frequency: { type: String },
    duration: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    instructions: { type: String },
    timing: { type: String, enum: TIMINGS }
  },
  { _id: false }
);

const prescriptionSchema = new Schema(
  {
    prescriptionNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    patientName: { type: String, required: true },
    patientAge: { type: Number, min: 0, max: 130 },
    patientGender: { type: String, enum: GENDERS },
    patientPhone: { type: String },
    doctorName: { type: String, required: true },
    hospitalClinic: { type: String },
    doctorRegistrationNumber: { type: String },
    prescribedDate: { type: Date, required: true, default: Date.now },
    expiryDate: { type: Date },
    diagnosis: { type: String },
    items: { type: [prescriptionItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    refillsAllowed: { type: Number, min: 0 },
    refillsRemaining: { type: Number, min: 0 },
    notes: { type: String },
    attachmentUrl: { type: String },
    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'Pending' }
  },
  { timestamps: true }
);

prescriptionSchema.index({ customerId: 1 });
prescriptionSchema.index({ status: 1 });
prescriptionSchema.index({ prescribedDate: -1 });

toJSONPlugin(prescriptionSchema);

export const Prescription = model('Prescription', prescriptionSchema);
