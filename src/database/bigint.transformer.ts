import type { ValueTransformer } from 'typeorm';

/**
 * Переводит Postgres `bigint` (`pg` отдаёт его строкой) в JS `number`.
 *
 * Деньги хранятся в целых центах (ADR-0001). Значения больше
 * `Number.MAX_SAFE_INTEGER` молча потеряли бы точность, поэтому такое
 * значение считается порчей данных и вызывает исключение.
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
