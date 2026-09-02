import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { authedUser } from '../test/authHelpers';
import { createApp } from '../app';
import { Medicine } from '../models/Medicine.model';
import { Supplier } from '../models/Supplier.model';
import { SupplierLedgerEntry } from '../models/SupplierLedgerEntry.model';
import { StockMovement } from '../models/StockMovement.model';
import { PurchaseOrder } from '../models/PurchaseOrder.model';

function randomKey(): string {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

async function seedSupplier() {
  return Supplier.create({ name: 'Acme Distributors', phone: '9800000001' });
}

async function seedMedicine(overrides: { batches?: unknown[] } = {}) {
  return Medicine.create({
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
    batches: overrides.batches ?? []
  });
}

function purchaseItem(medicineId: string, overrides: Record<string, unknown> = {}) {
  return {
    medicineId,
    medicineName: 'Augmentin 625 Duo',
    batchNumber: 'PB-001',
    mfgDate: '2026-01-01',
    expiryDate: '2028-01-01',
    quantity: 10,
    freeQuantity: 2,
    purchasePrice: 80,
    mrp: 120,
    sellingPrice: 110,
    taxRate: 12,
    discountPercent: 0,
    ...overrides
  };
}

describe('POST /api/purchases — creation, stock inwarding, validation', () => {
  it('creates a Received PO, adds a new batch (qty = invoiced + free), and logs a Purchase movement', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-001',
        items: [purchaseItem(med.id, { quantity: 10, freeQuantity: 2 })],
        paidAmount: 0,
        status: 'Received',
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('Received');
    // billable subtotal is 10 * 80 = 800, tax 12% = 96, grandTotal = 896 (free units aren't billed)
    expect(res.body.data.subtotal).toBe(800);
    expect(res.body.data.taxTotal).toBe(96);
    expect(res.body.data.grandTotal).toBe(896);

    const reloadedMed = await Medicine.findById(med._id);
    expect(reloadedMed!.batches.length).toBe(1);
    expect(reloadedMed!.batches[0].quantity).toBe(12); // 10 invoiced + 2 free

    const movements = await StockMovement.find({ referenceId: 'SUPINV-001' });
    expect(movements.length).toBe(1);
    expect(movements[0].type).toBe('Purchase');
    expect(movements[0].quantityChange).toBe(12);
  });

  it('increments an existing batch instead of creating a duplicate when batchNumber already exists', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine({
      batches: [
        {
          batchNumber: 'PB-001',
          supplierId: supplier._id,
          supplierName: supplier.name,
          quantity: 5,
          purchasePrice: 80,
          mrp: 120,
          sellingPrice: 110,
          mfgDate: new Date('2026-01-01'),
          expiryDate: new Date('2028-01-01')
        }
      ]
    });

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-002',
        items: [purchaseItem(med.id, { quantity: 8, freeQuantity: 0 })],
        paidAmount: 0,
        status: 'Received',
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
    const reloadedMed = await Medicine.findById(med._id);
    expect(reloadedMed!.batches.length).toBe(1); // still one batch, incremented
    expect(reloadedMed!.batches[0].quantity).toBe(13); // 5 + 8
  });

  it('an Ordered (not yet received) PO does not touch stock, movements, or supplier payable', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-003',
        items: [purchaseItem(med.id)],
        status: 'Ordered',
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
    const reloadedMed = await Medicine.findById(med._id);
    expect(reloadedMed!.batches.length).toBe(0);
    expect(await StockMovement.countDocuments({ referenceId: 'SUPINV-003' })).toBe(0);

    const reloadedSupplier = await Supplier.findById(supplier._id);
    expect(reloadedSupplier!.outstandingAmount).toBe(0);
    expect(reloadedSupplier!.totalPurchases).toBe(0);
  });

  it('derives paymentStatus from paidAmount and updates supplier payable + ledger only for the owed portion', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-004',
        items: [purchaseItem(med.id, { quantity: 10, freeQuantity: 0 })], // grandTotal 896
        paidAmount: 400,
        status: 'Received',
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paymentStatus).toBe('Partial');
    expect(res.body.data.paidAmount).toBe(400);

    const reloadedSupplier = await Supplier.findById(supplier._id);
    expect(reloadedSupplier!.outstandingAmount).toBe(896 - 400);
    expect(reloadedSupplier!.totalPurchases).toBe(896);

    const ledger = await SupplierLedgerEntry.find({ supplierId: supplier._id });
    expect(ledger.length).toBe(1);
    expect(ledger[0].type).toBe('PurchaseCredit');
    expect(ledger[0].amount).toBe(896 - 400);
  });

  it('a fully-paid PO is marked Paid and writes no supplier ledger entry (no balance changed)', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-005',
        items: [purchaseItem(med.id, { quantity: 10, freeQuantity: 0 })],
        paidAmount: 896,
        status: 'Received',
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paymentStatus).toBe('Paid');

    const reloadedSupplier = await Supplier.findById(supplier._id);
    expect(reloadedSupplier!.outstandingAmount).toBe(0);
    expect(reloadedSupplier!.totalPurchases).toBe(896);
    expect(await SupplierLedgerEntry.countDocuments({ supplierId: supplier._id })).toBe(0);
  });

  it('rejects a batch with sellingPrice > mrp', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-006',
        items: [purchaseItem(med.id, { mrp: 50, sellingPrice: 999 })],
        idempotencyKey: randomKey()
      });
    expect(res.status).toBe(400);
  });

  it('rejects an expiryDate that is not after mfgDate', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-007',
        items: [purchaseItem(med.id, { mfgDate: '2028-01-01', expiryDate: '2026-01-01' })],
        idempotencyKey: randomKey()
      });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate (supplier, invoiceNumber) pair', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();
    const body = {
      supplierId: supplier.id,
      invoiceNumber: 'SUPINV-DUP',
      items: [purchaseItem(med.id)],
      status: 'Ordered'
    };

    const first = await request(app).post('/api/purchases').set('Authorization', `Bearer ${token}`).send({ ...body, idempotencyKey: randomKey() });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/purchases').set('Authorization', `Bearer ${token}`).send({ ...body, idempotencyKey: randomKey() });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_RESOURCE');
  });

  it('returns 404 for a nonexistent supplier', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine();
    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: '64b000000000000000000000',
        invoiceNumber: 'SUPINV-008',
        items: [purchaseItem(med.id)],
        idempotencyKey: randomKey()
      });
    expect(res.status).toBe(404);
  });

  it('rolls back everything if one item in a multi-item PO references a nonexistent medicine', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const medOk = await seedMedicine();

    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'SUPINV-009',
        items: [purchaseItem(medOk.id, { quantity: 5 }), purchaseItem('64b000000000000000000000', { batchNumber: 'PB-BAD' })],
        status: 'Received',
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(404);
    const reloadedMedOk = await Medicine.findById(medOk._id);
    expect(reloadedMedOk!.batches.length).toBe(0); // untouched — rolled back
    expect(await PurchaseOrder.countDocuments({})).toBe(0);
  });
});

describe('Idempotency', () => {
  it('an exact-duplicate request returns the original PO, not a new one, and does not double-inward stock', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();
    const key = randomKey();
    const body = {
      supplierId: supplier.id,
      invoiceNumber: 'SUPINV-010',
      items: [purchaseItem(med.id, { quantity: 10, freeQuantity: 0 })],
      status: 'Received',
      idempotencyKey: key
    };

    const first = await request(app).post('/api/purchases').set('Authorization', `Bearer ${token}`).send(body);
    const second = await request(app).post('/api/purchases').set('Authorization', `Bearer ${token}`).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const reloadedMed = await Medicine.findById(med._id);
    expect(reloadedMed!.batches[0].quantity).toBe(10); // inwarded exactly once
  });

  it('reusing the same key with a different payload is rejected', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();
    const key = randomKey();

    const first = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId: supplier.id, invoiceNumber: 'SUPINV-011', items: [purchaseItem(med.id, { quantity: 5 })], idempotencyKey: key });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId: supplier.id, invoiceNumber: 'SUPINV-012', items: [purchaseItem(med.id, { quantity: 9 })], idempotencyKey: key });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_RESOURCE');
  });
});

describe('Authorization / RBAC', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app).get('/api/purchases');
    expect(res.status).toBe(401);
  });

  it('rejects a Cashier (lacks manage_purchases)', async () => {
    const app = createApp();
    const { token } = await authedUser(app, { role: 'Cashier', permissions: ['view_pos', 'create_sale', 'view_inventory'] });
    const res = await request(app).get('/api/purchases').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/purchases', () => {
  it('lists and filters by supplier/status, paginated', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier();
    const med = await seedMedicine();

    await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId: supplier.id, invoiceNumber: 'SUPINV-013', items: [purchaseItem(med.id)], status: 'Ordered', idempotencyKey: randomKey() });
    await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId: supplier.id, invoiceNumber: 'SUPINV-014', items: [purchaseItem(med.id)], status: 'Received', idempotencyKey: randomKey() });

    const res = await request(app).get(`/api/purchases?supplierId=${supplier.id}&status=Received`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].invoiceNumber).toBe('SUPINV-014');
  });
});
