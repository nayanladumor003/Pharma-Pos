import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { authedUser } from '../test/authHelpers';
import { createApp } from '../app';
import { Supplier } from '../models/Supplier.model';
import { SupplierLedgerEntry } from '../models/SupplierLedgerEntry.model';

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

async function seedSupplier(overrides: Record<string, unknown> = {}) {
  return Supplier.create({ name: 'Acme Distributors', phone: '9800000001', gstin: '29AABCA1234F1Z5', ...overrides });
}

describe('Supplier CRUD + validation', () => {
  it('creates, reads, updates a supplier; server ignores client-supplied financial fields', async () => {
    const app = createApp();
    const { token } = await authedUser(app);

    const createRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Medico Pharma', phone: '9800000002', outstandingAmount: 99999, totalPurchases: 99999 });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.outstandingAmount).toBe(0);
    expect(createRes.body.data.totalPurchases).toBe(0);

    const id = createRes.body.data.id;
    const getRes = await request(app).get(`/api/suppliers/${id}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);

    const updateRes = await request(app)
      .patch(`/api/suppliers/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ creditDays: 30, outstandingAmount: 55555 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.creditDays).toBe(30);
    expect(updateRes.body.data.outstandingAmount).toBe(0);
  });

  it('rejects creation with a missing required field', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const res = await request(app).post('/api/suppliers').set('Authorization', `Bearer ${token}`).send({ name: 'No Phone' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent supplier', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const res = await request(app).get('/api/suppliers/64b000000000000000000000').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('Search and pagination', () => {
  it('finds by name (text) and phone (prefix)', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    await seedSupplier({ name: 'Acme Distributors', phone: '9800000001' });
    await seedSupplier({ name: 'Medico Pharma', phone: '9822222222' });

    const byName = await request(app).get('/api/suppliers?search=Acme').set('Authorization', `Bearer ${token}`);
    expect(byName.body.data.length).toBe(1);
    expect(byName.body.data[0].name).toBe('Acme Distributors');

    const byPhone = await request(app).get('/api/suppliers?search=98000').set('Authorization', `Bearer ${token}`);
    expect(byPhone.body.data.length).toBe(1);
    expect(byPhone.body.data[0].phone).toBe('9800000001');
  });

  it('finds by GSTIN prefix without misreading it as a name search', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    await seedSupplier({ name: 'Acme Distributors', phone: '9800000001', gstin: '29AABCA1234F1Z5' });
    await seedSupplier({ name: 'Medico Pharma', phone: '9822222222', gstin: '27XYZDE5678G1Z9' });

    const res = await request(app).get('/api/suppliers?search=29AABCA').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].gstin).toBe('29AABCA1234F1Z5');
  });

  it('paginates results', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    for (let i = 0; i < 5; i++) await seedSupplier({ name: `Supplier ${i}`, phone: `98000000${i}${i}` });

    const res = await request(app).get('/api/suppliers?page=1&limit=2').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });
  });
});

describe('Supplier payment (payable settlement)', () => {
  it('creates an immutable ledger entry and atomically decrements the cached balance', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier({ outstandingAmount: 1000 });

    const res = await request(app)
      .post(`/api/suppliers/${supplier.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 400, method: 'Bank Transfer' });

    expect(res.status).toBe(201);
    expect(res.body.data.supplier.outstandingAmount).toBe(600);
    expect(res.body.data.ledgerEntry.type).toBe('Payment');
    expect(res.body.data.ledgerEntry.amount).toBe(-400);

    const ledgerRes = await request(app).get(`/api/suppliers/${supplier.id}/ledger`).set('Authorization', `Bearer ${token}`);
    expect(ledgerRes.body.data.length).toBe(1);
  });

  it('floors at 0 on overpayment', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier({ outstandingAmount: 300 });

    const res = await request(app)
      .post(`/api/suppliers/${supplier.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000 });

    expect(res.status).toBe(201);
    expect(res.body.data.supplier.outstandingAmount).toBe(0);
    expect(res.body.data.ledgerEntry.amount).toBe(-300);
  });

  it('rejects a zero payment amount', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier({ outstandingAmount: 500 });
    const res = await request(app).post(`/api/suppliers/${supplier.id}/pay`).set('Authorization', `Bearer ${token}`).send({ amount: 0 });
    expect(res.status).toBe(400);
  });

  it('two simultaneous payments both succeed and the final balance is mathematically correct', async () => {
    const app = createApp();
    const { token } = await authedUser(app);
    const supplier = await seedSupplier({ outstandingAmount: 1000 });

    const pay = (amount: number) =>
      request(app).post(`/api/suppliers/${supplier.id}/pay`).set('Authorization', `Bearer ${token}`).send({ amount });

    const [resA, resB] = await Promise.all([pay(300), pay(400)]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const reloaded = await Supplier.findById(supplier._id);
    expect(reloaded!.outstandingAmount).toBe(300);
    expect(await SupplierLedgerEntry.countDocuments({ supplierId: supplier._id })).toBe(2);
  });
});

describe('Authorization / RBAC', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app).get('/api/suppliers');
    expect(res.status).toBe(401);
  });

  it('rejects a Cashier (lacks manage_purchases)', async () => {
    const app = createApp();
    const { token } = await authedUser(app, { role: 'Cashier', permissions: ['view_pos', 'create_sale', 'view_inventory'] });
    const res = await request(app).get('/api/suppliers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows an Inventory Specialist (holds manage_purchases)', async () => {
    const app = createApp();
    const { token } = await authedUser(app, {
      role: 'Inventory Specialist',
      permissions: ['view_inventory', 'adjust_inventory', 'manage_medicines', 'manage_purchases']
    });
    const res = await request(app).post('/api/suppliers').set('Authorization', `Bearer ${token}`).send({ name: 'X', phone: '9800000000' });
    expect(res.status).toBe(201);
  });
});
