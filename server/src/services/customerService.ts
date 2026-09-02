import mongoose, { FilterQuery } from 'mongoose';
import { Customer, CustomerDoc } from '../models/Customer.model';
import { CustomerLedgerEntry, CustomerLedgerEntryDoc } from '../models/CustomerLedgerEntry.model';
import { AppError } from '../errors/AppError';
import { buildPagination, Pagination } from '../utils/response';
import { auditLog } from '../utils/auditLog';
import { CreateCustomerBody, ListCustomersQuery, UpdateCustomerBody } from '../validators/customer.validators';

/**
 * Search strategy: unlike medicine names (single compound tokens like
 * "amoxicillin" that need real mid-word matching — see Phase F's Atlas
 * Search writeup), person names naturally decompose into separate first/last
 * name words, so MongoDB's standard $text index (already declared in
 * Customer.model.ts) correctly matches "kumar" against "Ramesh Kumar" without
 * needing nGram infix search. Phone numbers are matched by an anchored
 * (prefix) regex, which — unlike an unanchored regex — CAN use the `phone`
 * index rather than scanning the collection.
 */
function isDigitsOnly(value: string): boolean {
  return /^\+?\d+$/.test(value.trim());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listCustomers(query: ListCustomersQuery): Promise<{ items: CustomerDoc[]; pagination: Pagination }> {
  const filter: FilterQuery<CustomerDoc> = {};
  let sort: Record<string, 1 | -1> = { [query.sortBy]: query.sortDir === 'desc' ? -1 : 1 };

  if (query.search) {
    const term = query.search.trim();
    if (isDigitsOnly(term)) {
      filter.phone = { $regex: '^' + escapeRegex(term) };
    } else {
      filter.$text = { $search: term };
      sort = { score: { $meta: 'textScore' } } as unknown as Record<string, 1 | -1>;
    }
  }

  const skip = (query.page - 1) * query.limit;
  const projection = filter.$text ? { score: { $meta: 'textScore' } } : undefined;

  const [items, total] = await Promise.all([
    Customer.find(filter, projection).sort(sort).skip(skip).limit(query.limit),
    Customer.countDocuments(filter)
  ]);

  return { items, pagination: buildPagination(query.page, query.limit, total) };
}

export async function getCustomerById(id: string): Promise<CustomerDoc> {
  const customer = await Customer.findById(id);
  if (!customer) throw AppError.notFound('Customer');
  return customer;
}

export async function createCustomer(body: CreateCustomerBody): Promise<CustomerDoc> {
  return Customer.create(body);
}

export async function updateCustomer(id: string, updates: UpdateCustomerBody): Promise<CustomerDoc> {
  const customer = await Customer.findById(id);
  if (!customer) throw AppError.notFound('Customer');
  Object.assign(customer, updates);
  await customer.save();
  return customer;
}

export async function getCustomerLedger(
  customerId: string,
  page: number,
  limit: number
): Promise<{ items: CustomerLedgerEntryDoc[]; pagination: Pagination }> {
  const customer = await Customer.findById(customerId);
  if (!customer) throw AppError.notFound('Customer');

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    CustomerLedgerEntry.find({ customerId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    CustomerLedgerEntry.countDocuments({ customerId })
  ]);

  return { items, pagination: buildPagination(page, limit, total) };
}

export interface SettleActor {
  employeeId: string;
  name: string;
}

/**
 * Khata payment/collection. A plain atomic $inc (not an extra optimistic
 * guard on top) is sufficient for correctness here — unlike stock deduction,
 * there is no business condition that can make this write invalid based on
 * the current balance (payment always applies, clamped at 0), so there's
 * nothing to atomically "guard" beyond needing a consistent read-then-write,
 * which the surrounding MongoDB transaction already guarantees: concurrent
 * writers to the same customer document conflict at the engine level, and
 * `session.withTransaction` automatically retries the whole callback against
 * a fresh snapshot when that happens.
 *
 * Existing frontend behavior (customerService.settleBalance) floors the
 * balance at 0 and does not reject/track an overpayment as a credit balance
 * — preserved exactly. The ledger's `amount` records the amount actually
 * APPLIED (min(amountReceived, currentBalance)), not the raw amount
 * received, so `balanceAfter` always equals `balanceBefore + amount` exactly
 * — an invariant a bare counter can't guarantee but a ledger must.
 */
export async function settleCustomerBalance(
  customerId: string,
  input: { amount: number; method: string; reference?: string; notes?: string },
  actor: SettleActor
): Promise<{ customer: CustomerDoc; ledgerEntry: CustomerLedgerEntryDoc }> {
  const session = await mongoose.startSession();
  try {
    let customerResult!: CustomerDoc;
    let ledgerResult!: CustomerLedgerEntryDoc;

    await session.withTransaction(async () => {
      const customer = await Customer.findById(customerId).session(session);
      if (!customer) throw AppError.notFound('Customer');

      const appliedAmount = Math.min(input.amount, customer.outstandingBalance);

      const updated = await Customer.findByIdAndUpdate(
        customerId,
        { $inc: { outstandingBalance: -appliedAmount } },
        { new: true, session }
      );

      const [ledgerEntry] = await CustomerLedgerEntry.create(
        [
          {
            customerId,
            type: 'Payment',
            amount: -appliedAmount,
            balanceAfter: updated!.outstandingBalance,
            referenceId: `SETTLE-${Date.now()}-${customerId.slice(-6)}`,
            notes:
              appliedAmount < input.amount
                ? `${input.method}${input.reference ? ` (${input.reference})` : ''} — received ₹${input.amount}, applied ₹${appliedAmount} (balance was already lower); ${input.notes ?? ''}`.trim()
                : `${input.method}${input.reference ? ` (${input.reference})` : ''}${input.notes ? ` — ${input.notes}` : ''}`
          }
        ],
        { session }
      );

      customerResult = updated!;
      ledgerResult = ledgerEntry;
    });

    auditLog('khata_settlement', {
      customerId,
      employeeId: actor.employeeId,
      appliedAmount: ledgerResult.amount,
      balanceAfter: customerResult.outstandingBalance
    });

    return { customer: customerResult, ledgerEntry: ledgerResult };
  } finally {
    await session.endSession();
  }
}
