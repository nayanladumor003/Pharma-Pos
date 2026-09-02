import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { Medicine } from '../models/Medicine.model';
import { Supplier } from '../models/Supplier.model';
import { atomicAddBatchStock, atomicDeductBatchStock, atomicSetBatchStock, selectFefoBatches } from './stockMutation';

const DAY = 24 * 3600 * 1000;
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY);
}

describe('selectFefoBatches (pure)', () => {
  it('picks the batch with the earliest expiry among several eligible ones', () => {
    const result = selectFefoBatches(
      [
        { id: 'B-late', quantity: 10, expiryDate: daysFromNow(200) },
        { id: 'B-earliest', quantity: 10, expiryDate: daysFromNow(10) },
        { id: 'B-mid', quantity: 10, expiryDate: daysFromNow(90) }
      ],
      5
    );
    expect(result.allocations).toEqual([{ batchId: 'B-earliest', quantity: 5 }]);
    expect(result.shortfall).toBe(0);
  });

  it('excludes expired batches even if they would otherwise sort first', () => {
    const result = selectFefoBatches(
      [
        { id: 'B-expired', quantity: 10, expiryDate: daysFromNow(-1) },
        { id: 'B-valid', quantity: 10, expiryDate: daysFromNow(30) }
      ],
      5
    );
    expect(result.allocations).toEqual([{ batchId: 'B-valid', quantity: 5 }]);
  });

  it('excludes zero-stock batches', () => {
    const result = selectFefoBatches(
      [
        { id: 'B-empty', quantity: 0, expiryDate: daysFromNow(5) },
        { id: 'B-stocked', quantity: 10, expiryDate: daysFromNow(30) }
      ],
      3
    );
    expect(result.allocations).toEqual([{ batchId: 'B-stocked', quantity: 3 }]);
  });

  it('partially consumes a single batch, leaving the rest untouched', () => {
    const result = selectFefoBatches([{ id: 'B1', quantity: 20, expiryDate: daysFromNow(30) }], 7);
    expect(result.allocations).toEqual([{ batchId: 'B1', quantity: 7 }]);
    expect(result.fulfilled).toBe(7);
    expect(result.shortfall).toBe(0);
  });

  it('spans multiple batches in expiry order when one batch cannot cover the full quantity', () => {
    const result = selectFefoBatches(
      [
        { id: 'B-earliest', quantity: 4, expiryDate: daysFromNow(5) },
        { id: 'B-next', quantity: 10, expiryDate: daysFromNow(40) },
        { id: 'B-last', quantity: 10, expiryDate: daysFromNow(100) }
      ],
      9
    );
    expect(result.allocations).toEqual([
      { batchId: 'B-earliest', quantity: 4 },
      { batchId: 'B-next', quantity: 5 }
    ]);
    expect(result.fulfilled).toBe(9);
    expect(result.shortfall).toBe(0);
  });

  it('reports a shortfall when combined eligible stock is less than requested', () => {
    const result = selectFefoBatches(
      [
        { id: 'B1', quantity: 3, expiryDate: daysFromNow(10) },
        { id: 'B2', quantity: 2, expiryDate: daysFromNow(20) }
      ],
      10
    );
    expect(result.fulfilled).toBe(5);
    expect(result.shortfall).toBe(5);
    expect(result.allocations.reduce((s, a) => s + a.quantity, 0)).toBe(5);
  });
});

describe('atomic stock mutation primitives', () => {
  beforeAll(connectTestDB, 60000);
  afterEach(clearTestDB);
  afterAll(disconnectTestDB, 30000);

  async function seedMedicine(batchOverrides: Partial<{ quantity: number; expiryDate: Date; status: string }> = {}) {
    const supplier = await Supplier.create({ name: 'Acme', phone: '9800000001' });
    const med = await Medicine.create({
      name: 'Augmentin 625 Duo',
      genericName: 'Amoxicillin + Clavulanic Acid',
      brand: 'GSK',
      category: 'Antibiotics',
      dosageForm: 'Tablet',
      strength: '625 mg',
      packSize: '10 Tablets / Strip',
      barcode: `BC-${Date.now()}-${Math.random()}`,
      purchasePrice: 80,
      mrp: 120,
      sellingPrice: 110,
      gstRate: 12,
      reorderLevel: 10,
      batches: [
        {
          batchNumber: 'B1',
          supplierId: supplier._id,
          supplierName: supplier.name,
          quantity: batchOverrides.quantity ?? 10,
          purchasePrice: 80,
          mrp: 120,
          sellingPrice: 110,
          mfgDate: new Date('2024-01-01'),
          expiryDate: batchOverrides.expiryDate ?? daysFromNow(90)
        }
      ]
    });
    return { medicine: med, batchId: med.batches[0]._id.toString() };
  }

  it('deducts stock atomically and keeps totalStock in sync', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 10 });
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const result = await atomicDeductBatchStock(session, medicine._id.toString(), batchId, 3);
      expect(result.newBatchQuantity).toBe(7);
    });
    await session.endSession();

    const reloaded = await Medicine.findById(medicine._id);
    expect(reloaded!.batches[0].quantity).toBe(7);
    expect(reloaded!.totalStock).toBe(7);
  });

  it('rejects a deduction that exceeds available quantity with INSUFFICIENT_STOCK, mutating nothing', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 5 });
    const session = await mongoose.startSession();
    await expect(
      session.withTransaction(async () => {
        await atomicDeductBatchStock(session, medicine._id.toString(), batchId, 6);
      })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await session.endSession();

    const reloaded = await Medicine.findById(medicine._id);
    expect(reloaded!.batches[0].quantity).toBe(5);
  });

  it('blocks deduction from an expired batch when enforceNotExpired is set (sale path)', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 5, expiryDate: daysFromNow(-2) });
    const session = await mongoose.startSession();
    await expect(
      session.withTransaction(async () => {
        await atomicDeductBatchStock(session, medicine._id.toString(), batchId, 1, { enforceNotExpired: true });
      })
    ).rejects.toMatchObject({ code: 'EXPIRED_BATCH' });
    await session.endSession();
  });

  it('allows deduction from an expired batch by default (administrative write-off path)', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 5, expiryDate: daysFromNow(-2) });
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const result = await atomicDeductBatchStock(session, medicine._id.toString(), batchId, 5);
      expect(result.newBatchQuantity).toBe(0);
    });
    await session.endSession();
  });

  it('sets status to Out of Stock when a deduction brings quantity to exactly zero', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 4 });
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await atomicDeductBatchStock(session, medicine._id.toString(), batchId, 4);
    });
    await session.endSession();

    const reloaded = await Medicine.findById(medicine._id);
    expect(reloaded!.batches[0].status).toBe('Out of Stock');
  });

  it('adds stock atomically and flips status back to Active from Out of Stock', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 0 });
    await Medicine.updateOne(
      { _id: medicine._id },
      { $set: { 'batches.$[b].status': 'Out of Stock' } },
      { arrayFilters: [{ 'b._id': batchId }] }
    );
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const result = await atomicAddBatchStock(session, medicine._id.toString(), batchId, 15);
      expect(result.newBatchQuantity).toBe(15);
    });
    await session.endSession();

    const reloaded = await Medicine.findById(medicine._id);
    expect(reloaded!.batches[0].status).toBe('Active');
    expect(reloaded!.totalStock).toBe(15);
  });

  it('sets an absolute audit quantity and adjusts totalStock by the correct delta', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 10 });
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const result = await atomicSetBatchStock(session, medicine._id.toString(), batchId, 6);
      expect(result.previousQuantity).toBe(10);
      expect(result.newQuantity).toBe(6);
    });
    await session.endSession();

    const reloaded = await Medicine.findById(medicine._id);
    expect(reloaded!.batches[0].quantity).toBe(6);
    expect(reloaded!.totalStock).toBe(6);
  });

  it('CONCURRENCY: selling the last unit twice at once — exactly one succeeds, one fails, stock never goes negative', async () => {
    const { medicine, batchId } = await seedMedicine({ quantity: 1 });
    const medicineId = medicine._id.toString();

    async function attemptSale(): Promise<'ok' | 'insufficient'> {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await atomicDeductBatchStock(session, medicineId, batchId, 1, { enforceNotExpired: true });
        });
        return 'ok';
      } catch (err) {
        if (err instanceof Object && 'code' in err && err.code === 'INSUFFICIENT_STOCK') return 'insufficient';
        throw err;
      } finally {
        await session.endSession();
      }
    }

    const [resultA, resultB] = await Promise.all([attemptSale(), attemptSale()]);
    const outcomes = [resultA, resultB];

    expect(outcomes.filter((o) => o === 'ok').length).toBe(1);
    expect(outcomes.filter((o) => o === 'insufficient').length).toBe(1);

    const reloaded = await Medicine.findById(medicine._id);
    expect(reloaded!.batches[0].quantity).toBe(0);
    expect(reloaded!.totalStock).toBe(0);
  });
});
