import { Schema, model, ClientSession } from 'mongoose';

/**
 * Atomic sequence generator. The old frontend derived invoice numbers from
 * `sales.length + 1001` — safe with a single browser tab, not under
 * concurrent requests (two simultaneous sales could compute the same
 * "next number"). `$inc` via findOneAndUpdate is a single atomic operation,
 * so two concurrent callers always get distinct sequence values.
 */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 1000 }
});

const Counter = model('Counter', counterSchema);

export async function nextSequence(key: string, session: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
  return doc!.seq;
}
