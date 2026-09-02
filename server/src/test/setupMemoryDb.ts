import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Shared in-memory MongoDB test harness. Uses a (single-node) replica set —
 * not a plain standalone instance — because multi-document transactions
 * (the core of the Phase F sale-creation flow) require one; standalone mongod
 * doesn't support sessions/transactions at all.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function connectTestDB(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'pharmapos_test' });
}

export async function clearTestDB(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function disconnectTestDB(): Promise<void> {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}
