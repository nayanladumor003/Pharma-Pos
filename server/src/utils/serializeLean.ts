/**
 * Maps a `.lean()` Medicine document (plain object, no toJSON transform) to the
 * same { id, ...batches:[{id,...}] } shape the hydrated-document toJSON plugin
 * produces, so list/search endpoints can use lean() for read performance
 * without the response contract diverging from single-resource endpoints.
 */
export function serializeLeanMedicine(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, __v, batches, ...rest } = doc;
  const mappedBatches = Array.isArray(batches)
    ? batches.map((b: Record<string, unknown>) => {
        const { _id: batchId, ...batchRest } = b;
        return { id: (batchId as { toString(): string })?.toString(), ...batchRest };
      })
    : batches;
  return { id: (_id as { toString(): string })?.toString(), ...rest, batches: mappedBatches };
}
