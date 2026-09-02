import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { authedUser } from '../test/authHelpers';
import { createApp } from '../app';
import { Supplier } from '../models/Supplier.model';

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

async function makeSupplier() {
  return Supplier.create({ name: 'Acme Distributors', phone: '9800000001' });
}

function baseMedicinePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Augmentin 625 Duo',
    genericName: 'Amoxicillin + Clavulanic Acid',
    brand: 'GSK',
    category: 'Antibiotics',
    dosageForm: 'Tablet',
    strength: '625 mg',
    packSize: '10 Tablets / Strip',
    barcode: `BC-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    purchasePrice: 80,
    mrp: 120,
    sellingPrice: 110,
    gstRate: 12,
    reorderLevel: 10,
    ...overrides
  };
}

describe('Medicine CRUD + validation', () => {
  it('creates a medicine (manage_medicines) and derives totalStock/batch status server-side', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await makeSupplier();

    const res = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(
        baseMedicinePayload({
          batches: [
            {
              batchNumber: 'B1',
              supplierId: supplier.id,
              supplierName: supplier.name,
              quantity: 20,
              purchasePrice: 80,
              mrp: 120,
              sellingPrice: 110,
              mfgDate: '2024-01-01',
              expiryDate: new Date(Date.now() + 100 * 24 * 3600 * 1000).toISOString(),
              // Deliberately wrong — the server must not trust this.
              status: 'Expired'
            }
          ]
        })
      );

    expect(res.status).toBe(201);
    expect(res.body.data.totalStock).toBe(20);
    expect(res.body.data.batches[0].status).toBe('Active');
    expect(res.body.data.id).toBeDefined();
  });

  it('rejects creation with a missing required field', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const payload = baseMedicinePayload();
    delete (payload as Record<string, unknown>).genericName;

    const res = await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects creation when sellingPrice exceeds mrp', async () => {
    const app = createApp();
    const { token } = await authedUser(app);

    const res = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(baseMedicinePayload({ mrp: 100, sellingPrice: 150 }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate barcode', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const barcode = `DUP-${Date.now()}`;

    await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload({ barcode }));
    const res = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(baseMedicinePayload({ barcode, name: 'Different Name' }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_RESOURCE');
  });

  it('rejects a duplicate SKU', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const sku = `SKU-${Date.now()}`;

    await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload({ sku }));
    const res = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(baseMedicinePayload({ sku, barcode: `OTHER-${Date.now()}` }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_RESOURCE');
  });

  it('reads, updates, and archives a medicine (archive is a soft delete)', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const created = await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload());
    const id = created.body.data.id;

    const getRes = await request(app).get(`/api/medicines/${id}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);

    const updateRes = await request(app)
      .patch(`/api/medicines/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reorderLevel: 50 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.reorderLevel).toBe(50);

    const archiveRes = await request(app).delete(`/api/medicines/${id}`).set('Authorization', `Bearer ${token}`);
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.status).toBe('Archived');

    // Archived medicines are excluded from the default list.
    const listRes = await request(app).get('/api/medicines').set('Authorization', `Bearer ${token}`);
    expect(listRes.body.data.find((m: { id: string }) => m.id === id)).toBeUndefined();
  });
});

describe('Batch operations', () => {
  it('rejects adding a batch with sellingPrice > mrp', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await makeSupplier();
    const created = await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload());
    const id = created.body.data.id;

    const res = await request(app)
      .post(`/api/medicines/${id}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchNumber: 'BAD',
        supplierId: supplier.id,
        supplierName: supplier.name,
        quantity: 10,
        purchasePrice: 10,
        mrp: 50,
        sellingPrice: 999,
        mfgDate: '2024-01-01',
        expiryDate: '2026-01-01'
      });

    expect(res.status).toBe(400);
  });

  it('rejects a batch whose expiryDate is not after mfgDate', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await makeSupplier();
    const created = await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload());
    const id = created.body.data.id;

    const res = await request(app)
      .post(`/api/medicines/${id}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchNumber: 'BAD-DATES',
        supplierId: supplier.id,
        supplierName: supplier.name,
        quantity: 10,
        purchasePrice: 10,
        mrp: 50,
        sellingPrice: 45,
        mfgDate: '2026-01-01',
        expiryDate: '2025-01-01'
      });

    expect(res.status).toBe(400);
  });

  it('derives Expired status for a batch added with a past expiry date, regardless of client input', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await makeSupplier();
    const created = await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload());
    const id = created.body.data.id;

    const res = await request(app)
      .post(`/api/medicines/${id}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchNumber: 'OLD-BATCH',
        supplierId: supplier.id,
        supplierName: supplier.name,
        quantity: 10,
        purchasePrice: 10,
        mrp: 50,
        sellingPrice: 45,
        mfgDate: '2020-01-01',
        expiryDate: '2020-06-01'
      });

    expect(res.status).toBe(201);
    const addedBatch = res.body.data.batches.find((b: { batchNumber: string }) => b.batchNumber === 'OLD-BATCH');
    expect(addedBatch.status).toBe('Expired');
    // Expired stock must not count toward totalStock.
    expect(res.body.data.totalStock).toBe(0);
  });
});

describe('Permissions', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app).get('/api/medicines');
    expect(res.status).toBe(401);
  });

  it('rejects medicine creation from a Cashier (lacks manage_medicines)', async () => {
    const app = createApp();
    const { token } = await authedUser(app, { role: 'Cashier', permissions: ['view_pos', 'create_sale', 'view_inventory'] });

    const res = await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a Cashier to read the medicine list (holds view_inventory)', async () => {
    const app = createApp();
    const { token } = await authedUser(app, { role: 'Cashier', permissions: ['view_pos', 'create_sale', 'view_inventory'] });

    const res = await request(app).get('/api/medicines').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('Search, filtering, pagination, and lookups', () => {
  it('paginates results with correct metadata', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/medicines')
        .set('Authorization', `Bearer ${token}`)
        .send(baseMedicinePayload({ name: `Drug ${i}`, barcode: `PG-${Date.now()}-${i}` }));
    }

    const res = await request(app).get('/api/medicines?page=1&limit=2').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });
  });

  it('filters by category', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(baseMedicinePayload({ name: 'Cardio Drug', category: 'Cardiovascular', barcode: `CAT-${Date.now()}-1` }));
    await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(baseMedicinePayload({ name: 'Antibiotic Drug', category: 'Antibiotics', barcode: `CAT-${Date.now()}-2` }));

    const res = await request(app).get('/api/medicines?category=Cardiovascular').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((m: { category: string }) => m.category === 'Cardiovascular')).toBe(true);
  });

  // Free-text search (?search=) now runs through Atlas Search ($search
  // aggregation stage), which mongodb-memory-server's in-process mongod
  // cannot execute at all — there is no local/self-hosted equivalent of
  // Atlas's mongot search process. That path is covered instead by
  // medicine.search.atlas.test.ts, an opt-in integration test that runs
  // against the real Atlas cluster (see that file for how to run it).
  // Category/manufacturer filtering and pagination above already exercise
  // the plain (non-search) `.find()` path against the in-memory replica set.

  it('finds a medicine by exact barcode lookup', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const barcode = `LOOKUP-${Date.now()}`;
    await request(app).post('/api/medicines').set('Authorization', `Bearer ${token}`).send(baseMedicinePayload({ barcode }));

    const res = await request(app).get(`/api/medicines/barcode/${barcode}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.barcode).toBe(barcode);
  });

  it('returns 404 for an unknown barcode', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const res = await request(app).get('/api/medicines/barcode/does-not-exist').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
