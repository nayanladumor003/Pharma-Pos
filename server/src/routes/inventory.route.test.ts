import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { authedUser } from '../test/authHelpers';
import { createApp } from '../app';
import { Medicine } from '../models/Medicine.model';
import { Supplier } from '../models/Supplier.model';

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

async function seedMedicineWithBatch(quantity: number, expiryDaysFromNow = 90) {
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
        quantity,
        purchasePrice: 80,
        mrp: 120,
        sellingPrice: 110,
        mfgDate: new Date('2024-01-01'),
        expiryDate: new Date(Date.now() + expiryDaysFromNow * 24 * 3600 * 1000)
      }
    ]
  });
  return { medicineId: med._id.toString(), batchId: med.batches[0]._id.toString() };
}

describe('POST /api/inventory/adjustments', () => {
  it('Add Stock increases batch quantity and totalStock, and records a movement', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const { medicineId, batchId } = await seedMedicineWithBatch(10);

    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ medicineId, batchId, adjustmentType: 'Add Stock', quantity: 5, reason: 'Found extra stock' });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('Adjustment');
    expect(res.body.data.quantityChange).toBe(5);
    expect(res.body.data.previousStock).toBe(10);
    expect(res.body.data.newStock).toBe(15);

    const reloaded = await Medicine.findById(medicineId);
    expect(reloaded!.totalStock).toBe(15);
  });

  it('Subtract Stock rejects a quantity greater than what is available', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const { medicineId, batchId } = await seedMedicineWithBatch(3);

    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ medicineId, batchId, adjustmentType: 'Subtract Stock', quantity: 10, reason: 'Shrinkage' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('Set Stock (Audit) overrides to an absolute count and logs the correct delta', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const { medicineId, batchId } = await seedMedicineWithBatch(10);

    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ medicineId, batchId, adjustmentType: 'Set Stock (Audit)', quantity: 7, reason: 'Physical count' });

    expect(res.status).toBe(201);
    expect(res.body.data.quantityChange).toBe(-3);
    expect(res.body.data.newStock).toBe(7);
  });

  it('Mark Expired removes stock and logs an Expired-type movement, even on an already-expired batch', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const { medicineId, batchId } = await seedMedicineWithBatch(5, -10); // already expired

    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ medicineId, batchId, adjustmentType: 'Mark Expired', quantity: 5, reason: 'Routine expiry sweep' });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('Expired');
    expect(res.body.data.newStock).toBe(0);
  });

  it('rejects adjustments from a Cashier (lacks adjust_inventory)', async () => {
    const app = createApp();
    const { token } = await authedUser(app, { role: 'Cashier', permissions: ['view_pos', 'create_sale', 'view_inventory'] });
    const { medicineId, batchId } = await seedMedicineWithBatch(10);

    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ medicineId, batchId, adjustmentType: 'Add Stock', quantity: 1, reason: 'test' });

    expect(res.status).toBe(403);
  });

  it('CONCURRENCY over HTTP: two simultaneous "sell the last unit" adjustments — exactly one succeeds', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const { medicineId, batchId } = await seedMedicineWithBatch(1);

    const body = { medicineId, batchId, adjustmentType: 'Subtract Stock', quantity: 1, reason: 'Concurrent sale simulation' };
    const [resA, resB] = await Promise.all([
      request(app).post('/api/inventory/adjustments').set('Authorization', `Bearer ${token}`).send(body),
      request(app).post('/api/inventory/adjustments').set('Authorization', `Bearer ${token}`).send(body)
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const reloaded = await Medicine.findById(medicineId);
    expect(reloaded!.batches[0].quantity).toBe(0);
  });
});

describe('GET /api/inventory/movements', () => {
  it('lists movements and supports filtering by medicineId and type, paginated', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const { medicineId, batchId } = await seedMedicineWithBatch(10);

    await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ medicineId, batchId, adjustmentType: 'Add Stock', quantity: 5, reason: 'r1' });
    await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ medicineId, batchId, adjustmentType: 'Subtract Stock', quantity: 2, reason: 'r2' });

    const res = await request(app)
      .get(`/api/inventory/movements?medicineId=${medicineId}&type=Adjustment&page=1&limit=10`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.total).toBe(2);
  });
});

describe('GET /api/inventory/expiry-radar', () => {
  it('classifies batches into the correct tier and excludes already-expired stock from the "all" view', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    await seedMedicineWithBatch(10, 3); // Critical (<=7d)
    await seedMedicineWithBatch(10, 20); // Near (8-30d)
    await seedMedicineWithBatch(10, 60); // Watchlist (31-90d)
    await seedMedicineWithBatch(10, -5); // Expired — must not appear in the radar

    const all = await request(app).get('/api/inventory/expiry-radar?tier=all').set('Authorization', `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBe(3);
    expect(all.body.data.every((d: { daysRemaining: number }) => d.daysRemaining > 0 && d.daysRemaining <= 90)).toBe(true);

    const critical = await request(app).get('/api/inventory/expiry-radar?tier=critical').set('Authorization', `Bearer ${token}`);
    expect(critical.body.data.length).toBe(1);
    expect(critical.body.data[0].daysRemaining).toBeLessThanOrEqual(7);
  });
});

describe('GET /api/inventory/low-stock', () => {
  it('returns medicines at or below their reorder level', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    await seedMedicineWithBatch(5); // reorderLevel is 10 in the helper — this is low stock

    const res = await request(app).get('/api/inventory/low-stock').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].totalStock).toBeLessThanOrEqual(res.body.data[0].reorderLevel);
  });
});
