/**
 * Canonical enum values shared across models. Mirrors src/types/index.ts on the
 * frontend, with two deliberate deviations resolved during the migration audit
 * (see server/src/utils/legacyEnumMap.ts for the historical-data translation):
 *   - PaymentMethod: 'UPI/QR' is dropped, canonical value is 'UPI'.
 *   - ExpenseCategory: near-duplicate long-form values are dropped in favor of
 *     the shorter canonical form (e.g. 'Utilities' not 'Utilities / Electricity').
 */

export const DOSAGE_FORMS = [
  'Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Inhaler', 'Powder', 'Gel', 'Suspension'
] as const;
export type DosageForm = (typeof DOSAGE_FORMS)[number];

export const MEDICINE_CATEGORIES = [
  'Antibiotics', 'Analgesics', 'Antidiabetic', 'Antihypertensive', 'Antihistamines',
  'Gastrointestinal', 'Cardiovascular', 'Respiratory', 'Dermatological',
  'Vitamins & Supplements', 'Ophthalmic', 'First Aid & Surgical'
] as const;
export type MedicineCategory = (typeof MEDICINE_CATEGORIES)[number];

export const BATCH_STATUSES = ['Active', 'Expired', 'Out of Stock'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const MEDICINE_STATUSES = ['Active', 'Archived'] as const;

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit', 'Split'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Split-line methods exclude 'Split' itself (a split can't contain a nested split). */
export const SPLIT_PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'] as const;

export const SALE_STATUSES = ['Completed', 'Refunded', 'Partially Refunded', 'Cancelled'] as const;

export const GENDERS = ['Male', 'Female', 'Other'] as const;

export const PURCHASE_ORDER_STATUSES = ['Received', 'Ordered', 'Cancelled'] as const;
export const PAYMENT_STATUSES = ['Paid', 'Pending', 'Partial'] as const;

export const PRESCRIPTION_STATUSES = ['Active', 'Dispensed', 'Partially Dispensed', 'Expired', 'Pending'] as const;
export const TIMINGS = ['Before Food', 'After Food', 'With Food', 'Empty Stomach', 'Bedtime'] as const;

export const SALES_RETURN_REASONS = [
  'Damaged Packaging', 'Wrong Dosage', 'Doctor Changed Rx', 'Adverse Reaction', 'Patient Recovered', 'Other'
] as const;
export const PURCHASE_RETURN_REASONS = [
  'Near Expiry Received', 'Damaged in Transit', 'Excess Stock', 'Rate Discrepancy'
] as const;
export const REFUND_METHODS = ['Cash', 'Credit Note', 'Original Payment'] as const;
export const PURCHASE_RETURN_STATUSES = ['Pending', 'Approved', 'Adjusted'] as const;

/** Canonical — the pre-existing 'Utilities / Electricity' etc. long forms are legacy-mapped onto these. */
export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries', 'Utilities', 'Cold Chain Electricity', 'Bio-Waste Disposal',
  'Packaging & Stationery', 'Software & Subscriptions', 'Maintenance', 'Other'
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EMPLOYEE_ROLES = [
  'Admin', 'Chief Pharmacist', 'Staff Pharmacist', 'Cashier', 'Inventory Specialist', 'Pharmacist', 'Inventory Manager'
] as const;
export const EMPLOYEE_STATUSES = ['Active', 'On Leave', 'Inactive'] as const;

/** Matches the granular Permission values actually seeded in src/data/employees.ts. */
export const PERMISSIONS = [
  'view_pos', 'create_sale', 'refund_sale', 'view_inventory', 'adjust_inventory',
  'manage_medicines', 'manage_purchases', 'view_reports', 'manage_employees', 'manage_settings'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const STOCK_MOVEMENT_TYPES = ['Purchase', 'Sale', 'Return', 'Adjustment', 'Expired', 'Damaged'] as const;

export const CUSTOMER_LEDGER_ENTRY_TYPES = ['CreditSale', 'Payment', 'ReturnCredit', 'Adjustment'] as const;
export const SUPPLIER_LEDGER_ENTRY_TYPES = ['PurchaseCredit', 'Payment', 'PurchaseReturnDebit', 'Adjustment'] as const;
