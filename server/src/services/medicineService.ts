import { FilterQuery } from 'mongoose';
import { Medicine, MedicineDoc, MEDICINE_SEARCH_INDEX } from '../models/Medicine.model';
import { AppError } from '../errors/AppError';
import { buildPagination, Pagination } from '../utils/response';
import { serializeLeanMedicine } from '../utils/serializeLean';
import { CreateMedicineBody, ListMedicinesQuery, UpdateMedicineBody, BatchInput } from '../validators/medicine.validators';

/**
 * Search strategy (see Phase F write-up for the full evaluation): POS search
 * needs genuine mid-word substring matches — "moxi" must find "Amoxicillin" —
 * which neither a MongoDB $text index (whole-word/stemmed only) nor an
 * anchored-prefix regex (`^moxi`, matches only the start of a field) can do.
 * An unanchored regex would match, but can't use a B-tree index and is exactly
 * the unbounded-collection-scan pattern to avoid at scale.
 *
 * Atlas Search's `autocomplete` field type with nGram tokenization gives real
 * substring matching, is index-backed (not a scan), and is a native Atlas
 * capability already available on this cluster — no new infrastructure.
 * Verified empirically against the real cluster: "moxi" correctly matches
 * both "Moxikind-CV 625" and "Augmentin 625 Duo" (generic name "Amoxicillin
 * + Clavulanic Acid") at ~40ms. See scripts/createSearchIndexes.ts.
 *
 * The plain `.find()` path below (no `search` term — just browsing/filtering/
 * sorting) doesn't need any of this and stays index-backed via the regular
 * category/manufacturer/status indexes from Phase E.
 */
const SEARCH_MATCH_CAP = 500;

export async function listMedicines(query: ListMedicinesQuery): Promise<{ items: unknown[]; pagination: Pagination }> {
  if (query.search) return searchMedicines(query);

  const filter: FilterQuery<MedicineDoc> = { status: query.status ?? 'Active' };
  if (query.category) filter.category = query.category;
  if (query.manufacturer) filter.manufacturer = query.manufacturer;

  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    Medicine.find(filter)
      .sort({ [query.sortBy]: query.sortDir === 'desc' ? -1 : 1 })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    Medicine.countDocuments(filter)
  ]);

  return {
    items: docs.map((d) => serializeLeanMedicine(d as unknown as Record<string, unknown>)),
    pagination: buildPagination(query.page, query.limit, total)
  };
}

async function searchMedicines(query: ListMedicinesQuery): Promise<{ items: unknown[]; pagination: Pagination }> {
  const filterClauses: Record<string, unknown>[] = [{ equals: { path: 'status', value: query.status ?? 'Active' } }];
  if (query.category) filterClauses.push({ equals: { path: 'category', value: query.category } });
  if (query.manufacturer) filterClauses.push({ equals: { path: 'manufacturer', value: query.manufacturer } });

  const skip = (query.page - 1) * query.limit;

  const [result] = await Medicine.aggregate([
    {
      $search: {
        index: MEDICINE_SEARCH_INDEX,
        compound: {
          should: [
            { autocomplete: { query: query.search, path: 'name', score: { boost: { value: 3 } } } },
            { autocomplete: { query: query.search, path: 'genericName', score: { boost: { value: 2 } } } },
            { autocomplete: { query: query.search, path: 'brand' } },
            { autocomplete: { query: query.search, path: 'manufacturer' } }
          ],
          minimumShouldMatch: 1,
          filter: filterClauses
        }
      }
    },
    // Hard bound on how many matches are ever considered — "bounded result
    // sets" even for a very generic query term. Relevance-sorted, so the 500
    // best matches are what get paginated, not an arbitrary slice.
    { $limit: SEARCH_MATCH_CAP },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: query.limit }],
        totalCount: [{ $count: 'count' }]
      }
    }
  ]);

  const docs: Record<string, unknown>[] = result?.data ?? [];
  const total = result?.totalCount?.[0]?.count ?? 0;

  return {
    items: docs.map((d) => serializeLeanMedicine(d)),
    pagination: buildPagination(query.page, query.limit, total)
  };
}

export async function getMedicineById(id: string) {
  const med = await Medicine.findById(id);
  if (!med) throw AppError.notFound('Medicine');
  return med;
}

export async function getMedicineByBarcode(barcode: string) {
  const med = await Medicine.findOne({ barcode, status: 'Active' });
  if (!med) throw AppError.notFound('Medicine');
  return med;
}

export async function getMedicineBySku(sku: string) {
  const med = await Medicine.findOne({ sku, status: 'Active' });
  if (!med) throw AppError.notFound('Medicine');
  return med;
}

export async function createMedicine(body: CreateMedicineBody) {
  // totalStock/batch.status are recomputed by Medicine's pre-save hook regardless
  // of what (if anything) was supplied — never trust client-provided derived fields.
  const med = new Medicine(body);
  await med.save();
  return med;
}

export async function updateMedicine(id: string, updates: UpdateMedicineBody) {
  const med = await Medicine.findById(id);
  if (!med) throw AppError.notFound('Medicine');
  Object.assign(med, updates);
  await med.save();
  return med;
}

export async function archiveMedicine(id: string) {
  const med = await Medicine.findById(id);
  if (!med) throw AppError.notFound('Medicine');
  med.status = 'Archived';
  await med.save();
  return med;
}

export async function addBatch(medicineId: string, batch: BatchInput) {
  const med = await Medicine.findById(medicineId);
  if (!med) throw AppError.notFound('Medicine');
  med.batches.push(batch);
  await med.save();
  return med;
}

export async function updateBatchMeta(medicineId: string, batchId: string, updates: Partial<BatchInput>) {
  const med = await Medicine.findById(medicineId);
  if (!med) throw AppError.notFound('Medicine');
  const batch = med.batches.id(batchId);
  if (!batch) throw AppError.notFound('Batch');
  Object.assign(batch, updates);
  await med.save();
  return med;
}
