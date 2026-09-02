/**
 * Opt-in integration test for the Atlas Search-backed POS medicine search.
 * $search cannot run against mongodb-memory-server (no local mongot), so this
 * connects to the REAL cluster in server/.env instead of the in-memory harness
 * used by every other test file. Skipped by default — run explicitly with:
 *
 *   RUN_ATLAS_SEARCH_TESTS=true npx vitest run src/routes/medicine.search.atlas.test.ts
 *
 * Requires scripts/createSearchIndexes.ts to have been run against that
 * cluster already (it has been, against the project's dev cluster).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../config/db';
import { createApp } from '../app';
import { authedUser } from '../test/authHelpers';
import { Medicine } from '../models/Medicine.model';
import { Employee } from '../models/Employee.model';
import { User } from '../models/User.model';

const RUN = process.env.RUN_ATLAS_SEARCH_TESTS === 'true';
const TAG = `atlas-search-test-${Date.now()}`;

describe.skipIf(!RUN)('Atlas Search — POS medicine search (real cluster)', () => {
  const createdBarcodes: string[] = [];
  const cleanupEmails: string[] = [];

  beforeAll(async () => {
    await connectDB();
  }, 30000);

  afterAll(async () => {
    await Medicine.deleteMany({ barcode: { $in: createdBarcodes } });
    await User.deleteMany({ email: { $in: cleanupEmails } });
    await Employee.deleteMany({ email: { $in: cleanupEmails } });
    await disconnectDB();
  }, 30000);

  it('matches a true mid-word substring ("moxi" -> "Amoxicillin"), not just a prefix', async () => {
    const app = createApp();
    const { token, email } = await authedUser(app);
    cleanupEmails.push(email);

    const barcode1 = `${TAG}-1`;
    const barcode2 = `${TAG}-2`;
    createdBarcodes.push(barcode1, barcode2);

    const create1 = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `${TAG} Augmentin 625 Duo`,
        genericName: 'Amoxicillin + Clavulanic Acid',
        brand: 'GSK',
        category: 'Antibiotics',
        dosageForm: 'Tablet',
        strength: '625 mg',
        packSize: '10 Tablets / Strip',
        barcode: barcode1,
        purchasePrice: 80,
        mrp: 120,
        sellingPrice: 110,
        gstRate: 12,
        reorderLevel: 10
      });
    const create2 = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `${TAG} Crocin Advance`,
        genericName: 'Paracetamol',
        brand: 'GSK Consumer',
        category: 'Analgesics',
        dosageForm: 'Tablet',
        strength: '500 mg',
        packSize: '10 Tablets / Strip',
        barcode: barcode2,
        purchasePrice: 10,
        mrp: 30,
        sellingPrice: 28,
        gstRate: 12,
        reorderLevel: 10
      });
    expect(create1.status).toBe(201);
    expect(create2.status).toBe(201);

    // Atlas Search indexing is near-real-time but not synchronous with the
    // write — measured empirically at ~15s on this cluster/tier for a fresh
    // insert to become queryable (see Phase F write-up). Poll rather than
    // hard-sleep so the test is only as slow as it needs to be.
    let names: string[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await request(app).get('/api/medicines?search=moxi').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      names = res.body.data.map((m: { name: string }) => m.name);
      if (names.length > 0) break;
    }

    expect(names).toContain(`${TAG} Augmentin 625 Duo`);
    expect(names).not.toContain(`${TAG} Crocin Advance`);
  }, 45000);
});
