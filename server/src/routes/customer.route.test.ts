import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { authedUser } from '../test/authHelpers';
import { createApp } from '../app';
import { Customer } from '../models/Customer.model';
import { CustomerLedgerEntry } from '../models/CustomerLedgerEntry.model';
import { Medicine } from '../models/Medicine.model';
import { Supplier } from '../models/Supplier.model';
import { Sale } from '../models/Sale.model';

function randomKey(): string {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

async function seedCustomer(overrides: Record<string, unknown> = {}) {
  return Customer.create({ name: 'Ramesh Kumar', phone: '9811111111', creditLimit: 100000, ...overrides });
}

async function seedMedicineForSale(overrides: { sellingPrice?: number; quantity?: number } = {}) {
  const supplier = await Supplier.create({ name: 'Acme', phone: '9800000001' });
  const sellingPrice = overrides.sellingPrice ?? 100;
  return Medicine.create({
    name: 'Augmentin 625 Duo',
    genericName: 'Amoxicillin + Clavulanic Acid',
    brand: 'GSK',
    category: 'Antibiotics',
    dosageForm: 'Tablet',
    strength: '625 mg',
    packSize: '10 Tablets / Strip',
    barcode: `BC-${Date.now()}-${Math.random()}`,
    purchasePrice: 50,
    mrp: sellingPrice + 30,
    sellingPrice,
    gstRate: 12,
    reorderLevel: 10,
    batches: [
      {
        batchNumber: 'B1',
        supplierId: supplier._id,
        supplierName: supplier.name,
        quantity: overrides.quantity ?? 100,
        purchasePrice: 50,
        mrp: sellingPrice + 30,
        sellingPrice,
        mfgDate: new Date('2024-01-01'),
        expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000)
      }
    ]
  });
}

describe('Customer CRUD + validation', () => {
  it('creates, reads, updates a customer; server ignores client-supplied financial fields', async () => {
    const app = createApp();
    const { token } = await authedUser(app);

    const createRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sunita Sharma',
        phone: '9822222222',
        creditLimit: 5000,
        // attempted spoofing of derived fields — must be ignored
        outstandingBalance: 99999,
        totalPurchases: 99999,
        loyaltyPoints: 99999
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.outstandingBalance).toBe(0);
    expect(createRes.body.data.totalPurchases).toBe(0);
    expect(createRes.body.data.loyaltyPoints).toBe(0);

    const id = createRes.body.data.id;
    const getRes = await request(app).get(`/api/customers/${id}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('Sunita Sharma');

    const updateRes = await request(app)
      .patch(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ city: 'Bengaluru', outstandingBalance: 12345 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.city).toBe('Bengaluru');
    expect(updateRes.body.data.outstandingBalance).toBe(0); // untouched by the spoofed field
  });

  it('rejects creation with a missing required field', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const res = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'No Phone' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a nonexistent customer', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const res = await request(app).get('/api/customers/64b000000000000000000000').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('Search and pagination', () => {
  it('finds a customer by name (word-level $text match)', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    await seedCustomer({ name: 'Ramesh Kumar', phone: '9811111111' });
    await seedCustomer({ name: 'Sunita Sharma', phone: '9822222222' });

    const res = await request(app).get('/api/customers?search=Kumar').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].name).toBe('Ramesh Kumar');
  });

  it('finds a customer by phone prefix', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    await seedCustomer({ name: 'Ramesh Kumar', phone: '9811111111' });
    await seedCustomer({ name: 'Sunita Sharma', phone: '9822222222' });

    const res = await request(app).get('/api/customers?search=98111').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].phone).toBe('9811111111');
  });

  it('paginates results with correct metadata', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    for (let i = 0; i < 5; i++) {
      await seedCustomer({ name: `Customer ${i}`, phone: `98000000${i}${i}` });
    }
    const res = await request(app).get('/api/customers?page=1&limit=2').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });
  });
});

describe('Khata settlement (payment/collection)', () => {
  it('creates an immutable ledger entry and atomically decrements the cached balance', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 1000 });

    const res = await request(app)
      .post(`/api/customers/${customer.id}/settle`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 400, method: 'Cash' });

    expect(res.status).toBe(201);
    expect(res.body.data.customer.outstandingBalance).toBe(600);
    expect(res.body.data.ledgerEntry.type).toBe('Payment');
    expect(res.body.data.ledgerEntry.amount).toBe(-400);
    expect(res.body.data.ledgerEntry.balanceAfter).toBe(600);

    const ledgerRes = await request(app).get(`/api/customers/${customer.id}/ledger`).set('Authorization', `Bearer ${token}`);
    expect(ledgerRes.body.data.length).toBe(1);
  });

  it('floors at 0 on overpayment, and the ledger amount reflects what was actually applied (existing behavior preserved)', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 300 });

    const res = await request(app)
      .post(`/api/customers/${customer.id}/settle`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000, method: 'Cash' });

    expect(res.status).toBe(201);
    expect(res.body.data.customer.outstandingBalance).toBe(0);
    // The ledger records the APPLIED amount (300), not the raw 1000 received —
    // this is what keeps balanceAfter = balanceBefore + amount an exact invariant.
    expect(res.body.data.ledgerEntry.amount).toBe(-300);
  });

  it('rejects a zero or negative payment amount', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 500 });

    const res = await request(app)
      .post(`/api/customers/${customer.id}/settle`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when settling a nonexistent customer', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const res = await request(app)
      .post('/api/customers/64b000000000000000000000/settle')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100 });
    expect(res.status).toBe(404);
  });
});

describe('Credit sale integration (Phase F) and transaction rollback', () => {
  it('a credit sale creates the sale, a CreditSale ledger entry, and updates the balance atomically', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 0 });
    const med = await seedMedicineForSale({ sellingPrice: 200 });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 1 }], customerId: customer.id, paymentMethod: 'Credit', idempotencyKey: randomKey() });

    expect(res.status).toBe(201);
    const reloadedCustomer = await Customer.findById(customer._id);
    expect(reloadedCustomer!.outstandingBalance).toBe(res.body.data.grandTotal);

    const ledger = await CustomerLedgerEntry.find({ customerId: customer._id });
    expect(ledger.length).toBe(1);
    expect(ledger[0].type).toBe('CreditSale');
    expect(ledger[0].balanceAfter).toBe(reloadedCustomer!.outstandingBalance);
  });

  it('a failed credit sale (insufficient stock) leaves no sale, no ledger entry, and no balance change', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 0 });
    const med = await seedMedicineForSale({ sellingPrice: 200, quantity: 2 });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 10 }], customerId: customer.id, paymentMethod: 'Credit', idempotencyKey: randomKey() });

    expect(res.status).toBe(409);

    const reloadedCustomer = await Customer.findById(customer._id);
    expect(reloadedCustomer!.outstandingBalance).toBe(0);
    expect(await CustomerLedgerEntry.countDocuments({ customerId: customer._id })).toBe(0);
    expect(await Sale.countDocuments({ customerId: customer._id })).toBe(0);

    const reloadedMed = await Medicine.findById(med._id);
    expect(reloadedMed!.batches[0].quantity).toBe(2); // untouched
  });
});

describe('Concurrency', () => {
  it('two simultaneous credit sales for the same customer both succeed and the final balance is the exact sum', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 0 });
    const med = await seedMedicineForSale({ sellingPrice: 100, quantity: 1000 }); // plenty of stock — isolates ledger concurrency from stock concurrency

    const makeSale = () =>
      request(app)
        .post('/api/sales')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ medicineId: med.id, quantity: 2 }], customerId: customer.id, paymentMethod: 'Credit', idempotencyKey: randomKey() });

    const [resA, resB] = await Promise.all([makeSale(), makeSale()]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const expectedTotal = resA.body.data.grandTotal + resB.body.data.grandTotal;
    const reloadedCustomer = await Customer.findById(customer._id);
    expect(reloadedCustomer!.outstandingBalance).toBe(expectedTotal);

    const ledger = await CustomerLedgerEntry.find({ customerId: customer._id }).sort({ createdAt: 1 });
    expect(ledger.length).toBe(2);
    // balanceAfter values must be internally consistent regardless of commit order
    const balancesAfter = ledger.map((l) => l.balanceAfter).sort((a, b) => a - b);
    expect(balancesAfter[1]).toBe(expectedTotal);
  });

  it('two simultaneous settlements for the same customer both succeed and the final balance is mathematically correct', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 1000 });

    const settle = (amount: number) =>
      request(app).post(`/api/customers/${customer.id}/settle`).set('Authorization', `Bearer ${token}`).send({ amount });

    const [resA, resB] = await Promise.all([settle(300), settle(400)]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const reloadedCustomer = await Customer.findById(customer._id);
    expect(reloadedCustomer!.outstandingBalance).toBe(1000 - 300 - 400);

    const ledger = await CustomerLedgerEntry.find({ customerId: customer._id });
    expect(ledger.length).toBe(2);
  });

  it('a concurrent credit sale and settlement resolve to a mathematically correct final balance', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer({ outstandingBalance: 500 });
    const med = await seedMedicineForSale({ sellingPrice: 100, quantity: 1000 });

    const saleReq = request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ medicineId: med.id, quantity: 1 }], customerId: customer.id, paymentMethod: 'Credit', idempotencyKey: randomKey() });
    const settleReq = request(app).post(`/api/customers/${customer.id}/settle`).set('Authorization', `Bearer ${token}`).send({ amount: 200 });

    const [saleRes, settleRes] = await Promise.all([saleReq, settleReq]);
    expect(saleRes.status).toBe(201);
    expect(settleRes.status).toBe(201);

    const expectedBalance = 500 + saleRes.body.data.grandTotal - 200;
    const reloadedCustomer = await Customer.findById(customer._id);
    expect(reloadedCustomer!.outstandingBalance).toBe(expectedBalance);

    const ledger = await CustomerLedgerEntry.find({ customerId: customer._id });
    expect(ledger.length).toBe(2);
    expect(ledger.some((l) => l.type === 'CreditSale')).toBe(true);
    expect(ledger.some((l) => l.type === 'Payment')).toBe(true);
  });
});

describe('Ledger immutability', () => {
  it('exposes no update or delete route for ledger entries', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const customer = await seedCustomer();

    const patchRes = await request(app)
      .patch(`/api/customers/${customer.id}/ledger/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 0 });
    const deleteRes = await request(app).delete(`/api/customers/${customer.id}/ledger/${customer.id}`).set('Authorization', `Bearer ${token}`);

    expect(patchRes.status).toBe(404);
    expect(deleteRes.status).toBe(404);
  });
});

describe('Authorization / RBAC', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('rejects customer creation from a role lacking create_sale', async () => {
    const app = createApp();
    const { token } = await authedUser(app, {
      role: 'Inventory Specialist',
      permissions: ['view_inventory', 'adjust_inventory', 'manage_medicines', 'manage_purchases']
    });
    const res = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'X', phone: '9800000000' });
    expect(res.status).toBe(403);
  });

  it('rejects customer reads from a role lacking view_pos', async () => {
    const app = createApp();
    const { token } = await authedUser(app, {
      role: 'Inventory Specialist',
      permissions: ['view_inventory', 'adjust_inventory', 'manage_medicines', 'manage_purchases']
    });
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows a Cashier (holds view_pos + create_sale) full customer access', async () => {
    const app = createApp();
    const { token } = await authedUser(app, { role: 'Cashier', permissions: ['view_pos', 'create_sale', 'view_inventory'] });
    const res = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'X', phone: '9800000000' });
    expect(res.status).toBe(201);
  });
});
