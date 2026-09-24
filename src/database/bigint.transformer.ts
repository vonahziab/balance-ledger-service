import type { ValueTransformer } from 'typeorm';

/**
 * Maps Postgres `bigint` (returned by `pg` as a string) to a JS `number`.
 *
 * Money is stored in integer cents (ADR-0001). Values beyond
 * `Number.MAX_SAFE_INTEGER` would silently lose precision, so reading one
 * is treated as data corruption and throws instead.
 */
export const bigintTransformer = {
  to(value: number | null | undefined): number | null | undefined {
    return value;
  },

  from(value: string | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new RangeError(
        `bigint value ${value} is outside the safe integer range`,
      );
    }
    return parsed;
  },
} satisfies ValueTransformer;
