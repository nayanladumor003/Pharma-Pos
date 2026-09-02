import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';
import { EXPENSE_CATEGORIES } from './enums';

const expenseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    paymentMethod: { type: String, enum: ['Cash', 'Bank Transfer', 'UPI', 'Card'], required: true },
    // Canonical single field — the old type's redundant addedBy/recordedBy pair is collapsed.
    recordedBy: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    paidTo: { type: String },
    receiptNumber: { type: String },
    notes: { type: String }
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });

toJSONPlugin(expenseSchema);

export const Expense = model('Expense', expenseSchema);
