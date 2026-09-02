/**
 * One-time (idempotent) setup script — creates the Atlas Search index the POS
 * medicine search relies on. Not run automatically on server boot: Atlas
 * Search indexes are a deployment concern (like a schema migration), not
 * request-path logic, and index builds are async (seconds, not instant).
 *
 * Run with: npx tsx src/scripts/createSearchIndexes.ts
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db';
import { Medicine, MEDICINE_SEARCH_INDEX } from '../models/Medicine.model';

async function main() {
  await connectDB();
  const coll = Medicine.collection;
  const db = mongoose.connection.db!;

  // Atlas Search requires the underlying collection to physically exist first —
  // on a fresh database it won't until the first document is inserted.
  const collections = await db.listCollections({ name: coll.collectionName }).toArray();
  if (collections.length === 0) {
    await db.createCollection(coll.collectionName);
    console.log(`Created empty "${coll.collectionName}" collection so the search index has somewhere to attach.`);
  }

  let existingCount = 0;
  try {
    existingCount = (await coll.listSearchIndexes(MEDICINE_SEARCH_INDEX).toArray()).length;
  } catch {
    existingCount = 0;
  }
  if (existingCount > 0) {
    console.log(`Search index "${MEDICINE_SEARCH_INDEX}" already exists. Nothing to do.`);
    await disconnectDB();
    return;
  }

  await coll.createSearchIndex({
    name: MEDICINE_SEARCH_INDEX,
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          // nGram (not edgeGram) tokenization is what makes a true mid-word
          // substring like "moxi" match "Amoxicillin" — edgeGram only matches
          // from the start of a word (prefix search), which would miss this.
          name: [{ type: 'autocomplete', tokenization: 'nGram', minGrams: 3, maxGrams: 10, foldDiacritics: true }],
          genericName: [{ type: 'autocomplete', tokenization: 'nGram', minGrams: 3, maxGrams: 10, foldDiacritics: true }],
          brand: [{ type: 'autocomplete', tokenization: 'nGram', minGrams: 3, maxGrams: 10, foldDiacritics: true }],
          manufacturer: [{ type: 'autocomplete', tokenization: 'nGram', minGrams: 3, maxGrams: 10, foldDiacritics: true }],
          category: { type: 'token' },
          status: { type: 'token' }
        }
      }
    }
  });

  console.log(`Search index "${MEDICINE_SEARCH_INDEX}" creation requested. It builds asynchronously (usually <60s on Atlas).`);
  await disconnectDB();
}

main().catch((err) => {
  console.error('Failed to create search index:', err);
  process.exit(1);
});
