import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common';
import type { Request } from 'express';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Совпадает с `balance_ledger.idempotency_key varchar(255)`. */
const MAX_LENGTH = 255;

/**
 * Проверяет заголовок `Idempotency-Key` (ADR-0002): непустая строка до 255
 * символов. Бросает 400, который фильтр отдаёт как `VALIDATION_ERROR`.
 *
 * Пробелы по краям Node отрезает ещё при разборе заголовков, поэтому
 * заголовок из одних пробелов приходит пустой строкой.
 */
export class IdempotencyKeyPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || value === '') {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} header is required`,
      );
    }
    if (value.length > MAX_LENGTH) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} must be at most ${MAX_LENGTH} characters`,
      );
    }
    return value;
  }
}

const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Request>().header(IDEMPOTENCY_KEY_HEADER),
);

/**
 * Подставляет проверенный заголовок `Idempotency-Key`. `@Headers()` не
 * принимает pipe, а собственный декоратор параметра — принимает.
 */
export const IdempotencyKey = (): ParameterDecorator =>
  IdempotencyKeyHeader(undefined, new IdempotencyKeyPipe());
