import { Schema } from 'mongoose';

/**
 * Every model in this app is consumed by a frontend that expects a string `id`
 * field (matching src/types/index.ts), not Mongo's `_id`/`__v`. Applying this
 * plugin keeps that contract without every controller/service re-mapping fields.
 */
export function toJSONPlugin(schema: Schema): void {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      if (ret._id !== undefined) {
        ret.id = (ret._id as { toString(): string }).toString();
        delete ret._id;
      }
      return ret;
    }
  });
}
