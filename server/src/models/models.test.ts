import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { clearTestDB, connectTestDB, disconnectTestDB } from '../test/setupMemoryDb';
import { Medicine } from './Medicine.model';
import { Supplier } from './Supplier.model';
import { Employee } from './Employee.model';
import { Settings, SETTINGS_SINGLETON_ID } from './Settings.model';
import { Sale } from './Sale.model';
import { CustomerLedgerEntry } from './CustomerLedgerEntry.model';

beforeAll(connectTestDB, 60000);
afterEach(clearTestDB);
afterAll(disconnectTestDB, 30000);

async function makeSupplier() {
  return Supplier.create({ name: 'Acme Distributors', phone: '9800000001', status: 'Active' });
}

async function makeEmployee() {
  return Employee.create({
    name: 'Priya Sharma',
    email: `priya-${Date.now()}@apexpharma.com`,
    phone: '9800000002',
    role: 'Cashier',
    permissions: ['view_pos', 'create_sale']
  });
}

describe('Medicine model', () => {
  it('derives batch.status and medicine.totalStock on save instead of trusting stored values', async () => {
    const supplier = await makeSupplier();
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const inTenDays = new Date(Date.now() + 10 * 24 * 3600 * 1000);

    const med = await Medicine.create({
      name: 'Augmentin 625 Duo',
      genericName: 'Amoxicillin + Clavulanic Acid',
      brand: 'GSK',
      category: 'Antibiotics',
      dosageForm: 'Tablet',
      strength: '625 mg',
      packSize: '10 Tablets / Strip',
      barcode: `BC-${Date.now()}`,
      purchasePrice: 80,
      mrp: 120,
      sellingPrice: 110,
      gstRate: 12,
      reorderLevel: 10,
      batches: [
        {
          batchNumber: 'EXPIRED-01',
          supplierId: supplier._id,
          supplierName: supplier.name,
          quantity: 5,
          purchasePrice: 80,
          mrp: 120,
          sellingPrice: 110,
          mfgDate: new Date('2024-01-01'),
          expiryDate: yesterday, // already expired
          status: 'Active' // deliberately wrong — model must correct this
        },
        {
          batchNumber: 'OUT-OF-STOCK-01',
          supplierId: supplier._id,
          supplierName: supplier.name,
          quantity: 0,
          purchasePrice: 80,
          mrp: 120,
          sellingPrice: 110,
          mfgDate: new Date('2024-01-01'),
          expiryDate: inTenDays
        },
        {
          batchNumber: 'ACTIVE-01',
          supplierId: supplier._id,
          supplierName: supplier.name,
          quantity: 25,
          purchasePrice: 80,
          mrp: 120,
          sellingPrice: 110,
          mfgDate: new Date('2024-01-01'),
          expiryDate: inTenDays
        }
      ]
    });

    const [expired, outOfStock, active] = med.batches;
    expect(expired.status).toBe('Expired');
    expect(outOfStock.status).toBe('Out of Stock');
    expect(active.status).toBe('Active');
    // totalStock excludes the expired batch's 5 units (25 + 0, not 30).
    expect(med.totalStock).toBe(25);
  });

  it('rejects a batch whose sellingPrice exceeds mrp (resolved decision #2)', async () => {
    const supplier = await makeSupplier();
    await expect(
      Medicine.create({
        name: 'Test Drug',
        genericName: 'Test Salt',
        brand: 'TestBrand',
        category: 'Analgesics',
        dosageForm: 'Tablet',
        strength: '500 mg',
        packSize: '10 Tablets',
        purchasePrice: 10,
        mrp: 50,
        sellingPrice: 45,
        gstRate: 12,
        reorderLevel: 5,
        batches: [
          {
            batchNumber: 'BAD-01',
            supplierId: supplier._id,
            supplierName: supplier.name,
            quantity: 10,
            purchasePrice: 10,
            mrp: 50,
            sellingPrice: 999, // > mrp, must fail
            mfgDate: new Date(),
            expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000)
          }
        ]
      })
    ).rejects.toThrow();
  });

  it('enforces a unique barcode', async () => {
    const barcode = `DUPLICATE-${Date.now()}`;
    const base = {
      genericName: 'Salt',
      brand: 'Brand',
      category: 'Analgesics' as const,
      dosageForm: 'Tablet' as const,
      strength: '500 mg',
      packSize: '10 Tablets',
      purchasePrice: 10,
      mrp: 50,
      sellingPrice: 45,
      gstRate: 12,
      reorderLevel: 5
    };
    await Medicine.create({ ...base, name: 'Drug A', barcode });
    await expect(Medicine.create({ ...base, name: 'Drug B', barcode })).rejects.toThrow();
  });
});

describe('Employee model', () => {
  it('enforces a unique email', async () => {
    const email = `dup-${Date.now()}@apexpharma.com`;
    await Employee.create({ name: 'A', email, phone: '1', role: 'Cashier' });
    await expect(Employee.create({ name: 'B', email, phone: '2', role: 'Cashier' })).rejects.toThrow();
  });
});

describe('Settings model (singleton)', () => {
  it('only ever allows one document via the fixed _id', async () => {
    await Settings.create({
      _id: SETTINGS_SINGLETON_ID,
      store: { name: 'Apex Care Pharmacy' },
      pos: {},
      inventory: {}
    });
    await expect(
      Settings.create({ _id: SETTINGS_SINGLETON_ID, store: { name: 'Another Store' }, pos: {}, inventory: {} })
    ).rejects.toThrow();
  });
});

describe('Sale model', () => {
  it('enforces a unique invoiceNumber and a unique idempotencyKey', async () => {
    const employee = await makeEmployee();
    const baseItem = {
      medicineId: new Types.ObjectId(),
      medicineName: 'Augmentin 625 Duo',
      batchId: new Types.ObjectId().toString(),
      batchNumber: 'B1',
      expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      availableBatchStock: 20,
      quantity: 1,
      purchasePrice: 80,
      mrp: 120,
      unitPrice: 110,
      taxRate: 12,
      taxAmount: 13.2,
      subtotal: 110,
      total: 123.2
    };
    const baseSale = {
      date: new Date(),
      customerName: 'Walk-in Customer',
      items: [baseItem],
      itemCount: 1,
      subtotal: 110,
      discountTotal: 0,
      taxTotal: 13.2,
      grandTotal: 123,
      paymentMethod: 'Cash' as const,
      amountPaid: 123,
      cashierId: employee._id,
      cashierName: employee.name,
      storeName: 'Apex Care'
    };

    await Sale.create({ ...baseSale, invoiceNumber: 'INV-2026-1001', idempotencyKey: 'idem-1' });
    await expect(Sale.create({ ...baseSale, invoiceNumber: 'INV-2026-1001', idempotencyKey: 'idem-2' })).rejects.toThrow();
    await expect(Sale.create({ ...baseSale, invoiceNumber: 'INV-2026-1002', idempotencyKey: 'idem-1' })).rejects.toThrow();
  });
});

describe('CustomerLedgerEntry model', () => {
  it('requires the core traceability fields', async () => {
    await expect(
      CustomerLedgerEntry.create({ type: 'CreditSale', amount: 100 } as never)
    ).rejects.toThrow();
  });
});
