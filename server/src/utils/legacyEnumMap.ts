/**
 * Translates deprecated enum values from the frontend-only/localStorage era to
 * their canonical Mongo-side equivalent (see models/enums.ts). Applied once by
 * the seed-data migration script when importing existing mock/demo records —
 * historical records are relabeled to the canonical value, never reinterpreted
 * in meaning (a 'Utilities / Electricity' expense stays an electricity expense,
 * it just gets the shorter canonical label 'Utilities').
 */

const PAYMENT_METHOD_MAP: Record<string, string> = {
  'UPI/QR': 'UPI'
};

const EXPENSE_CATEGORY_MAP: Record<string, string> = {
  'Utilities / Electricity': 'Utilities',
  'Salaries & Wages': 'Salaries',
  'Cold Chain / Refrigeration': 'Cold Chain Electricity',
  'Packaging & Pharmacy Bags': 'Packaging & Stationery',
  'Cleaning & Sanitation': 'Maintenance',
  'Software & Telecom': 'Software & Subscriptions',
  'Maintenance & Repairs': 'Maintenance',
  Miscellaneous: 'Other'
};

export function normalizePaymentMethod(value: string): string {
  return PAYMENT_METHOD_MAP[value] ?? value;
}

export function normalizeExpenseCategory(value: string): string {
  return EXPENSE_CATEGORY_MAP[value] ?? value;
}
