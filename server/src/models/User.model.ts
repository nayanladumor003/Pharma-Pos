import { Schema, model } from 'mongoose';

/**
 * Auth credentials, deliberately separate from Employee (see Employee.model.ts).
 * passwordHash is `select: false` (excluded from normal queries — must opt in
 * with `.select('+passwordHash')`) AND stripped again in toJSON as defense in
 * depth, so it can never accidentally leak in an API response.
 * tokenVersion is bumped on logout/password-change to invalidate all previously
 * issued refresh tokens without having to store/hash every one of them.
 */
const userSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    tokenVersion: { type: Number, default: 0 }
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    if (ret._id !== undefined) {
      ret.id = (ret._id as { toString(): string }).toString();
      delete ret._id;
    }
    delete ret.passwordHash;
    return ret;
  }
});

export const User = model('User', userSchema);
