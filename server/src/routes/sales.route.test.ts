import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { authedUser } from '../test/authHelpers';
import { createApp } from '../app';
import { Medicine } from '../models/Medicine.model';
import { Supplier } from '../models/Supplier.model';
import { Customer } from '../models/Customer.model';
import { CustomerLedgerEntry } from '../models/CustomerLedgerEntry.model';
import { StockMovement } from '../models/StockMovement.model';
import { Sale } from '../models/Sale.model';

const DAY = 24 * 3600 * 1000;
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY);
}
function randomKey(): string {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

async function seedSupplier() {
  return Supplier.create({ name: 'Acme Distributors', phone: '9800000001' });
}

async function seedMedicine(
  overrides: {
    batches?: Array<{ quantity: number; expiryDaysFromNow: number; sellingPrice?: number; batchNumber?: string }>;
    gstRate?: number;
    sellingPrice?: number;
    prescriptionRequired?: boolean;
  } = {}
) {
  const supplier = await seedSupplier();
  const batchSpecs = overrides.batches ?? [{ quantity: 20, expiryDaysFromNow: 90 }];
  const sellingPrice = overrides.sellingPrice ?? 110;
  const mrp = Math.max(120, sellingPrice + 20); // always keep mrp comfortably above sellingPrice, whatever override is passed
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
    mrp,
    sellingPrice,
    gstRate: overrides.gstRate ?? 12,
    reorderLevel: 10,
    prescriptionRequired: overrides.prescriptionRequired ?? false,
    batches: batchSpecs.map((b, i) => ({
      batchNumber: b.batchNumber ?? `B${i + 1}`,
      supplierId: supplier._id,
      supplierName: supplier.name,
      quantity: b.quantity,
      purchasePrice: 80,
      mrp: Math.max(mrp, (b.sellingPrice ?? sellingPrice) + 20),
      sellingPrice: b.sellingPrice ?? sellingPrice,
      mfgDate: new Date('2024-01-01'),
      expiryDate: daysFromNow(b.expiryDaysFromNow)
    }))
  });
  return med;
}

async function seedCustomer(overrides: Record<string, unknown> = {}) {
  return Customer.create({ name: 'Ramesh Kumar', phone: '9811111111', outstandingBalance: 0, creditLimit: 5000, ...overrides });
}

describe('POST /api/sales/quote', () => {
  it('returns server-computed totals without accepting any client total', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, gstRate: 12 });

    const res = await request(app)
      .post('/api/sales/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 2, discountPercent: 10 }], cartDiscountPercent: 0 });

    expect(res.status).toBe(200);
    // subtotal 200, discount 10% = 20, taxable 180, tax 12% = 21.6, grand = round(201.6) = 202
    expect(res.body.data.subtotal).toBe(200);
    expect(res.body.data.discountTotal).toBe(20);
    expect(res.body.data.taxTotal).toBe(21.6);
    expect(res.body.data.grandTotal).toBe(202);
  });
});

describe('POST /api/sales — creation, validation, totals', () => {
  it('creates a sale, deducts stock, and records a stock movement', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, gstRate: 12, batches: [{ quantity: 20, expiryDaysFromNow: 90 }] });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ medicineId: med.id, quantity: 3 }],
        paymentMethod: 'Cash',
        amountPaid: 500,
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
    expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d+$/);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].quantity).toBe(3);
    expect(res.body.data.grandTotal).toBe(Math.round(300 * 1.12));
    expect(res.body.data.changeDue).toBeCloseTo(500 - res.body.data.grandTotal, 2);

    const reloaded = await Medicine.findById(med._id);
    expect(reloaded!.batches[0].quantity).toBe(17);

    const movements = await StockMovement.find({ referenceId: res.body.data.invoiceNumber });
    expect(movements.length).toBe(1);
    expect(movements[0].type).toBe('Sale');
    expect(movements[0].quantityChange).toBe(-3);
  });

  it('rejects a structurally invalid request (empty cart)', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [], paymentMethod: 'Cash', amountPaid: 0, idempotencyKey: randomKey() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('applies FEFO: consumes the earliest-expiring eligible batch first', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({
      sellingPrice: 100,
      batches: [
        { quantity: 20, expiryDaysFromNow: 200, batchNumber: 'LATE' },
        { quantity: 20, expiryDaysFromNow: 10, batchNumber: 'EARLY' }
      ]
    });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 5 }], paymentMethod: 'Cash', amountPaid: 1000, idempotencyKey: randomKey() });

    expect(res.status).toBe(201);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].batchNumber).toBe('EARLY');
  });

  it('spans multiple batches (FEFO order) when one batch cannot cover the full quantity', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({
      sellingPrice: 100,
      batches: [
        { quantity: 4, expiryDaysFromNow: 10, batchNumber: 'EARLY' },
        { quantity: 20, expiryDaysFromNow: 100, batchNumber: 'LATE' }
      ]
    });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 9 }], paymentMethod: 'Cash', amountPaid: 2000, idempotencyKey: randomKey() });

    expect(res.status).toBe(201);
    expect(res.body.data.items.length).toBe(2);
    const early = res.body.data.items.find((i: { batchNumber: string }) => i.batchNumber === 'EARLY');
    const late = res.body.data.items.find((i: { batchNumber: string }) => i.batchNumber === 'LATE');
    expect(early.quantity).toBe(4);
    expect(late.quantity).toBe(5);

    const reloaded = await Medicine.findById(med._id);
    expect(reloaded!.batches.find((b) => b.batchNumber === 'EARLY')!.quantity).toBe(0);
    expect(reloaded!.batches.find((b) => b.batchNumber === 'LATE')!.quantity).toBe(15);

    const movements = await StockMovement.find({ referenceId: res.body.data.invoiceNumber }).sort({ batchNumber: 1 });
    expect(movements.length).toBe(2);
  });

  it('rejects a sale against an expired batch even when quantity would otherwise be sufficient', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, batches: [{ quantity: 10, expiryDaysFromNow: -5 }] });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 2 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: randomKey() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EXPIRED_BATCH');

    const reloaded = await Medicine.findById(med._id);
    expect(reloaded!.batches[0].quantity).toBe(10); // untouched
  });

  it('rejects insufficient stock across all eligible batches combined', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, batches: [{ quantity: 3, expiryDaysFromNow: 90 }] });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 10 }], paymentMethod: 'Cash', amountPaid: 2000, idempotencyKey: randomKey() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('Concurrency', () => {
  it('stock=1, two simultaneous sales for qty=1 — exactly one succeeds, one Sale, one movement, final stock 0', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, batches: [{ quantity: 1, expiryDaysFromNow: 90 }] });

    const body = (key: string) => ({ items: [{ medicineId: med.id, quantity: 1 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: key });
    const [resA, resB] = await Promise.all([
      request(app).post('/api/sales').set('Authorization', `Bearer ${token}`).send(body(randomKey())),
      request(app).post('/api/sales').set('Authorization', `Bearer ${token}`).send(body(randomKey()))
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const reloaded = await Medicine.findById(med._id);
    expect(reloaded!.batches[0].quantity).toBe(0);

    const sales = await Sale.find({ 'items.medicineId': med._id });
    expect(sales.length).toBe(1);
    const movements = await StockMovement.find({ medicineId: med._id, type: 'Sale' });
    expect(movements.length).toBe(1);
  });

  it('stock=10, concurrent requests for 7 and 5 — total successful quantity never exceeds 10', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, batches: [{ quantity: 10, expiryDaysFromNow: 90 }] });

    const makeReq = (qty: number) =>
      request(app)
        .post('/api/sales')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ medicineId: med.id, quantity: qty }], paymentMethod: 'Cash', amountPaid: 2000, idempotencyKey: randomKey() });

    const [resA, resB] = await Promise.all([makeReq(7), makeReq(5)]);
    const succeeded = [resA, resB].filter((r) => r.status === 201);
    const failed = [resA, resB].filter((r) => r.status === 409);

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].body.error.code).toBe('INSUFFICIENT_STOCK');

    const totalSold = succeeded.reduce((sum, r) => sum + r.body.data.items.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0), 0);
    expect(totalSold).toBeLessThanOrEqual(10);

    const reloaded = await Medicine.findById(med._id);
    expect(reloaded!.batches[0].quantity).toBe(10 - totalSold);
  });
});

describe('Khata credit', () => {
  it('a Credit sale increases customer outstandingBalance and writes a ledger entry', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 200, gstRate: 12 });
    const customer = await seedCustomer();

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ medicineId: med.id, quantity: 1 }],
        customerId: customer.id,
        paymentMethod: 'Credit',
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amountPaid).toBe(0);

    const reloadedCustomer = await Customer.findById(customer._id);
    expect(reloadedCustomer!.outstandingBalance).toBe(res.body.data.grandTotal);

    const ledger = await CustomerLedgerEntry.find({ customerId: customer._id });
    expect(ledger.length).toBe(1);
    expect(ledger[0].type).toBe('CreditSale');
    expect(ledger[0].amount).toBe(res.body.data.grandTotal);
  });

  it('rejects a Credit sale with no customer (structural validation)', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 1 }], paymentMethod: 'Credit', idempotencyKey: randomKey() });

    expect(res.status).toBe(400);
  });
});

describe('Idempotency', () => {
  it('an exact-duplicate request with the same key returns the original sale, not a new one', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, batches: [{ quantity: 20, expiryDaysFromNow: 90 }] });
    const key = randomKey();
    const body = { items: [{ medicineId: med.id, quantity: 2 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: key };

    const first = await request(app).post('/api/sales').set('Authorization', `Bearer ${token}`).send(body);
    const second = await request(app).post('/api/sales').set('Authorization', `Bearer ${token}`).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.invoiceNumber).toBe(first.body.data.invoiceNumber);

    const reloaded = await Medicine.findById(med._id);
    expect(reloaded!.batches[0].quantity).toBe(18); // deducted exactly once, not twice

    const sales = await Sale.find({ idempotencyKey: key });
    expect(sales.length).toBe(1);
  });

  it('reusing the same key with a different payload is rejected, not silently returning the first sale', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100, batches: [{ quantity: 20, expiryDaysFromNow: 90 }] });
    const key = randomKey();

    const first = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 2 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: key });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      // same key, DIFFERENT quantity
      .send({ items: [{ medicineId: med.id, quantity: 5 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: key });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_RESOURCE');

    // The original sale must be unaffected.
    const original = await Sale.findOne({ idempotencyKey: key });
    expect(original!.items[0].quantity).toBe(2);
  });
});

describe('Authentication and RBAC', () => {
  it('rejects an unauthenticated sale request', async () => {
    const app = createApp();
    const med = await seedMedicine();
    const res = await request(app)
      .post('/api/sales')
      .send({ items: [{ medicineId: med.id, quantity: 1 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: randomKey() });
    expect(res.status).toBe(401);
  });

  it('rejects sale creation from a role lacking create_sale', async () => {
    const app = createApp();
    const { token } = await authedUser(app, { role: 'Inventory Specialist', permissions: ['view_inventory', 'adjust_inventory', 'manage_medicines', 'manage_purchases'] });
    const med = await seedMedicine();

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 1 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: randomKey() });
    expect(res.status).toBe(403);
  });
});

describe('Prescription / Schedule H enforcement', () => {
  it('blocks dispensing a prescription-required medicine without a doctor name', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ prescriptionRequired: true });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 1 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: randomKey() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRESCRIPTION_REQUIRED');
  });

  it('allows it once a doctor name is supplied', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ prescriptionRequired: true });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ medicineId: med.id, quantity: 1 }],
        doctorName: 'Dr. Sameer Mehta',
        paymentMethod: 'Cash',
        amountPaid: 500,
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(201);
  });
});

describe('Historical sale snapshot', () => {
  it('a completed sale keeps its original price/name even after the medicine is later changed', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 100 });

    const saleRes = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 1 }], paymentMethod: 'Cash', amountPaid: 500, idempotencyKey: randomKey() });
    expect(saleRes.status).toBe(201);

    await request(app)
      .patch(`/api/medicines/${med.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Later', sellingPrice: 999 });

    const fetched = await request(app).get(`/api/sales/${saleRes.body.data.id}`).set('Authorization', `Bearer ${token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.items[0].medicineName).toBe('Augmentin 625 Duo');
    expect(fetched.body.data.items[0].unitPrice).toBe(100);
  });
});

describe('Rollback on mid-transaction failure', () => {
  it('if the second item in a multi-item cart fails, the first item is NOT left deducted', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const medOk = await seedMedicine({ sellingPrice: 50, batches: [{ quantity: 20, expiryDaysFromNow: 90 }] });
    const medShort = await seedMedicine({ sellingPrice: 50, batches: [{ quantity: 1, expiryDaysFromNow: 90 }] });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { medicineId: medOk.id, quantity: 5 },
          { medicineId: medShort.id, quantity: 10 } // this one must fail
        ],
        paymentMethod: 'Cash',
        amountPaid: 2000,
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');

    const reloadedOk = await Medicine.findById(medOk._id);
    expect(reloadedOk!.batches[0].quantity).toBe(20); // untouched — rolled back

    const movements = await StockMovement.find({ medicineId: medOk._id, type: 'Sale' });
    expect(movements.length).toBe(0);

    const sales = await Sale.find({});
    expect(sales.length).toBe(0);
  });
});

describe('Payment validation', () => {
  it('rejects Cash payment with insufficient amount tendered', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 500 });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 1 }], paymentMethod: 'Cash', amountPaid: 10, idempotencyKey: randomKey() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PAYMENT');
  });

  it('rejects a Split payment whose parts do not add up to the grand total', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const med = await seedMedicine({ sellingPrice: 500 });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ medicineId: med.id, quantity: 1 }],
        paymentMethod: 'Split',
        splitDetails: [{ method: 'Cash', amount: 100 }, { method: 'UPI', amount: 100 }],
        idempotencyKey: randomKey()
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PAYMENT');
  });
});
