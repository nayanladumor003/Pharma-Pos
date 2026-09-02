import mongoose, { FilterQuery } from 'mongoose';
import { Supplier, SupplierDoc } from '../models/Supplier.model';
import { SupplierLedgerEntry, SupplierLedgerEntryDoc } from '../models/SupplierLedgerEntry.model';
import { AppError } from '../errors/AppError';
import { buildPagination, Pagination } from '../utils/response';
import { auditLog } from '../utils/auditLog';
import { CreateSupplierBody, ListSuppliersQuery, UpdateSupplierBody } from '../validators/supplier.validators';

function isDigitsOnly(value: string): boolean {
  return /^\+?\d+$/.test(value.trim());
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listSuppliers(query: ListSuppliersQuery): Promise<{ items: SupplierDoc[]; pagination: Pagination }> {
  const filter: FilterQuery<SupplierDoc> = {};
  if (query.status) filter.status = query.status;
  let sort: Record<string, 1 | -1> = { [query.sortBy]: query.sortDir === 'desc' ? -1 : 1 };

  if (query.search) {
    const term = query.search.trim();
    if (isDigitsOnly(term)) {
      filter.phone = { $regex: '^' + escapeRegex(term) };
    } else if (/^[A-Za-z0-9]+$/.test(term) && /\d/.test(term) && /[A-Za-z]/.test(term) && term.length >= 4) {
      // A GSTIN prefix always mixes digits and letters (e.g. "29AABCA...");
      // a plain name never does — that's what distinguishes this from the
      // $text branch below, so an ordinary word like "Acme" still falls
      // through to name search instead of being misread as a GSTIN prefix.
      filter.gstin = { $regex: '^' + escapeRegex(term.toUpperCase()) };
    } else {
      filter.$text = { $search: term };
      sort = { score: { $meta: 'textScore' } } as unknown as Record<string, 1 | -1>;
    }
  }

  const skip = (query.page - 1) * query.limit;
  const projection = filter.$text ? { score: { $meta: 'textScore' } } : undefined;

  const [items, total] = await Promise.all([
    Supplier.find(filter, projection).sort(sort).skip(skip).limit(query.limit),
    Supplier.countDocuments(filter)
  ]);

  return { items, pagination: buildPagination(query.page, query.limit, total) };
}

export async function getSupplierById(id: string): Promise<SupplierDoc> {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw AppError.notFound('Supplier');
  return supplier;
}

export async function createSupplier(body: CreateSupplierBody): Promise<SupplierDoc> {
  return Supplier.create(body);
}

export async function updateSupplier(id: string, updates: UpdateSupplierBody): Promise<SupplierDoc> {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw AppError.notFound('Supplier');
  Object.assign(supplier, updates);
  await supplier.save();
  return supplier;
}

export async function getSupplierLedger(
  supplierId: string,
  page: number,
  limit: number
): Promise<{ items: SupplierLedgerEntryDoc[]; pagination: Pagination }> {
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw AppError.notFound('Supplier');

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    SupplierLedgerEntry.find({ supplierId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SupplierLedgerEntry.countDocuments({ supplierId })
  ]);
  return { items, pagination: buildPagination(page, limit, total) };
}

export interface PayActor {
  employeeId: string;
  name: string;
}

/** Same reasoning as customerService.settleCustomerBalance: a plain atomic
 *  $inc inside the transaction is sufficient — there is no business
 *  condition that rejects the write based on current balance. */
export async function paySupplierBalance(
  supplierId: string,
  input: { amount: number; method: string; reference?: string; notes?: string },
  actor: PayActor
): Promise<{ supplier: SupplierDoc; ledgerEntry: SupplierLedgerEntryDoc }> {
  const session = await mongoose.startSession();
  try {
    let supplierResult!: SupplierDoc;
    let ledgerResult!: SupplierLedgerEntryDoc;

    await session.withTransaction(async () => {
      const supplier = await Supplier.findById(supplierId).session(session);
      if (!supplier) throw AppError.notFound('Supplier');

      const appliedAmount = Math.min(input.amount, supplier.outstandingAmount);

      const updated = await Supplier.findByIdAndUpdate(
        supplierId,
        { $inc: { outstandingAmount: -appliedAmount } },
        { new: true, session }
      );

      const [ledgerEntry] = await SupplierLedgerEntry.create(
        [
          {
            supplierId,
            type: 'Payment',
            amount: -appliedAmount,
            balanceAfter: updated!.outstandingAmount,
            referenceId: `PAY-${Date.now()}-${supplierId.slice(-6)}`,
            notes: `${input.method}${input.reference ? ` (${input.reference})` : ''}${input.notes ? ` — ${input.notes}` : ''}`
          }
        ],
        { session }
      );

      supplierResult = updated!;
      ledgerResult = ledgerEntry;
    });

    auditLog('supplier_payment', {
      supplierId,
      employeeId: actor.employeeId,
      appliedAmount: ledgerResult.amount,
      balanceAfter: supplierResult.outstandingAmount
    });

    return { supplier: supplierResult, ledgerEntry: ledgerResult };
  } finally {
    await session.endSession();
  }
}
