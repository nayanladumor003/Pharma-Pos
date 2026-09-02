import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { EMPLOYEE_ROLES, EMPLOYEE_STATUSES, PERMISSIONS } from './enums';

/**
 * Staff profile only — no credentials here on purpose. Auth secrets live in the
 * separate `users` collection (see User.model.ts) so a record that gets
 * returned wholesale to roster list views (`GET /api/employees`) never carries
 * a password hash alongside it.
 */
const employeeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    role: { type: String, enum: EMPLOYEE_ROLES, required: true },
    status: { type: String, enum: EMPLOYEE_STATUSES, default: 'Active' },
    lastActive: { type: Date },
    joinedDate: { type: Date, required: true, default: Date.now },
    permissions: { type: [String], enum: PERMISSIONS, default: [] },
    avatarUrl: { type: String },
    licenseNumber: { type: String },
    shiftTiming: { type: String },
    cashDrawerLimit: { type: Number, min: 0 }
  },
  { timestamps: true }
);

toJSONPlugin(employeeSchema);

export const Employee = model('Employee', employeeSchema);
