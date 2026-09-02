import { ClientSession } from 'mongoose';
import { Medicine } from '../models/Medicine.model';
import { BatchStatus } from '../models/enums';
import { AppError } from '../errors/AppError';

/** Pure — no DB access. Mirrors BUSINESS_RULES.md Rule 1.3's blocking states only
 *  (Expired / Out of Stock / Active). The finer <30d/<60d/<90d display tiers are
 *  query-time classification, not a stored enum (see Medicine.model.ts comment). */
export function deriveBatchStatus(expiryDate: Date, quantity: number, now: Date = new Date()): BatchStatus {
  if (expiryDate.getTime() <= now.getTime()) return 'Expired';
  if (quantity <= 0) return 'Out of Stock';
  return 'Active';
}

export interface FefoBatchInput {
  id: string;
  quantity: number;
  expiryDate: Date;
}

export interface FefoAllocation {
  batchId: string;
  quantity: number;
}

export interface FefoResult {
  allocations: FefoAllocation[];
  fulfilled: number;
  shortfall: number;
}

/**
 * Pure FEFO allocation — no DB access, fully unit-testable. Mirrors
 * .ai/skills/inventory.md exactly: eligible batches are quantity > 0 and not
 * expired, sorted by soonest expiry first, consumed in that order. Unlike the
 * old frontend (which picked a single batch and clamped quantity to it), this
 * spans multiple batches when one lot can't cover the requested quantity —
 * the backend is authoritative and must actually fulfil the requested amount
 * rather than silently under-filling a cart line.
 *
 * Expiry eligibility is judged directly against `expiryDate`, not a stored
 * `status` field — status is a write-time cache that can go stale between
 * writes, but expiryDate is always authoritative.
 */
export function selectFefoBatches(batches: FefoBatchInput[], quantityNeeded: number, now: Date = new Date()): FefoResult {
  if (quantityNeeded <= 0) return { allocations: [], fulfilled: 0, shortfall: 0 };

  const eligible = batches
    .filter((b) => b.quantity > 0 && b.expiryDate.getTime() > now.getTime())
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());

  const allocations: FefoAllocation[] = [];
  let remaining = quantityNeeded;

  for (const batch of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.id, quantity: take });
    remaining -= take;
  }

  return { allocations, fulfilled: quantityNeeded - remaining, shortfall: Math.max(0, remaining) };
}

interface DeductResult {
  newBatchQuantity: number;
  previousBatchQuantity: number;
  medicineName: string;
  batchNumber: string;
}

/**
 * Atomic, concurrency-safe stock decrement. The quantity/expiry guard is
 * evaluated by MongoDB as part of the SAME find-and-modify operation — there
 * is no read-then-write window for two concurrent requests to both "see"
 * enough stock and both succeed. Under a stock race, exactly one of two
 * concurrent callers gets a matched document; the other gets `null` and an
 * INSUFFICIENT_STOCK error.
 *
 * `enforceNotExpired` is off by default because this primitive is shared by
 * administrative inventory corrections (Subtract Stock, Mark Damaged, Mark
 * Expired) which must be able to act on an already-expired batch — that's
 * the whole point of "Mark Expired". The future sale-creation flow (Phase F)
 * passes `enforceNotExpired: true` so an expired batch can never be sold.
 */
export async function atomicDeductBatchStock(
  session: ClientSession,
  medicineId: string,
  batchId: string,
  quantity: number,
  options: { enforceNotExpired?: boolean } = {}
): Promise<DeductResult> {
  const now = new Date();
  const elemMatch: Record<string, unknown> = { _id: batchId, quantity: { $gte: quantity } };
  if (options.enforceNotExpired) elemMatch.expiryDate = { $gt: now };

  const updated = await Medicine.findOneAndUpdate(
    { _id: medicineId, batches: { $elemMatch: elemMatch } },
    { $inc: { 'batches.$.quantity': -quantity, totalStock: -quantity } },
    { new: true, session }
  );

  if (!updated) {
    // Guard didn't match — read (within the same session) purely to build a
    // specific, helpful error message. This read plays no role in the
    // atomicity/correctness guarantee above, which already happened.
    const med = await Medicine.findById(medicineId).session(session);
    const batch = med?.batches.id(batchId);
    if (!med || !batch) throw AppError.notFound('Medicine or batch');
    if (options.enforceNotExpired && batch.expiryDate.getTime() <= now.getTime()) {
      throw AppError.expiredBatch(`Batch ${batch.batchNumber} has expired and cannot be dispensed`);
    }
    throw AppError.insufficientStock(
      `Only ${batch.quantity} unit(s) available for batch ${batch.batchNumber} (requested ${quantity})`
    );
  }

  const batch = updated.batches.id(batchId)!;
  if (batch.quantity === 0 && batch.status !== 'Out of Stock') {
    await Medicine.updateOne(
      { _id: medicineId },
      { $set: { 'batches.$[b].status': 'Out of Stock' } },
      { arrayFilters: [{ 'b._id': batchId }], session }
    );
  }

  return {
    newBatchQuantity: batch.quantity,
    previousBatchQuantity: batch.quantity + quantity,
    medicineName: updated.name,
    batchNumber: batch.batchNumber
  };
}

interface AddResult {
  newBatchQuantity: number;
  previousBatchQuantity: number;
  medicineName: string;
  batchNumber: string;
}

/** No guard needed — increasing stock can never oversell. */
export async function atomicAddBatchStock(
  session: ClientSession,
  medicineId: string,
  batchId: string,
  quantity: number
): Promise<AddResult> {
  const updated = await Medicine.findOneAndUpdate(
    { _id: medicineId, 'batches._id': batchId },
    { $inc: { 'batches.$.quantity': quantity, totalStock: quantity } },
    { new: true, session }
  );
  if (!updated) throw AppError.notFound('Medicine or batch');

  const batch = updated.batches.id(batchId)!;
  const correctStatus = deriveBatchStatus(batch.expiryDate, batch.quantity);
  if (batch.status !== correctStatus) {
    await Medicine.updateOne(
      { _id: medicineId },
      { $set: { 'batches.$[b].status': correctStatus } },
      { arrayFilters: [{ 'b._id': batchId }], session }
    );
  }

  return {
    newBatchQuantity: batch.quantity,
    previousBatchQuantity: batch.quantity - quantity,
    medicineName: updated.name,
    batchNumber: batch.batchNumber
  };
}

interface SetResult {
  previousQuantity: number;
  newQuantity: number;
  medicineName: string;
  batchNumber: string;
}

/** Physical stock audit override — an absolute count, not a delta, so "last write wins" is correct here by design. */
export async function atomicSetBatchStock(
  session: ClientSession,
  medicineId: string,
  batchId: string,
  newQuantity: number
): Promise<SetResult> {
  const med = await Medicine.findById(medicineId).session(session);
  if (!med) throw AppError.notFound('Medicine');
  const batch = med.batches.id(batchId);
  if (!batch) throw AppError.notFound('Batch');

  const previousQuantity = batch.quantity;
  const delta = newQuantity - previousQuantity;
  const newStatus = deriveBatchStatus(batch.expiryDate, newQuantity);

  await Medicine.updateOne(
    { _id: medicineId },
    { $set: { 'batches.$[b].quantity': newQuantity, 'batches.$[b].status': newStatus }, $inc: { totalStock: delta } },
    { arrayFilters: [{ 'b._id': batchId }], session }
  );

  return { previousQuantity, newQuantity, medicineName: med.name, batchNumber: batch.batchNumber };
}
