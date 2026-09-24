import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../common/errors/api.exception.js';

export class UserNotFoundException extends ApiException {
  constructor(userId: number) {
    super(
      HttpStatus.NOT_FOUND,
      ErrorCode.UserNotFound,
      `User ${userId} not found`,
    );
  }
}

/** Овердрафт запрещён (architecture.md#решения). */
export class InsufficientFundsException extends ApiException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.InsufficientFunds,
      'Insufficient funds',
    );
  }
}

/** Ключ уже использован для списания другой суммы (ADR-0002). */
export class IdempotencyKeyReusedException extends ApiException {
  constructor() {
    super(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.IdempotencyKeyReused,
      'Idempotency-Key was already used with a different amount',
    );
  }
}

/**
 * Строка пользователя не освободилась за `lock_timeout`: параллельные
 * операции с тем же пользователем (architecture.md#решения). Повтор с тем же
 * `Idempotency-Key` безопасен.
 */
export class LockTimeoutException extends ApiException {
  constructor() {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.LockTimeout,
      'User is busy with concurrent operations, retry later',
      { 'Retry-After': '1' },
    );
  }
}

/**
 * Все соединения пула заняты дольше `connectionTimeoutMillis` — обычно их
 * держит очередь к «горячему» пользователю (architecture.md#решения). Та же
 * перегрузка, что и `LockTimeoutException`; повтор с тем же
 * `Idempotency-Key` безопасен.
 */
export class ServiceBusyException extends ApiException {
  constructor() {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.ServiceBusy,
      'Service is busy, retry later',
      { 'Retry-After': '1' },
    );
  }
}

/**
 * `users.balance`, пересчитанный по леджеру, не совпал с `balance_after`
 * новой записи (ADR-0004). Не `HttpException`: это `500`, детали логирует
 * exception filter.
 */
export class BalanceMismatchError extends Error {
  constructor(userId: number, ledgerBalance: number, balanceAfter: number) {
    super(
      `Balance mismatch for user ${userId}: ledger sum ${ledgerBalance}, ` +
        `expected balance_after ${balanceAfter}`,
    );
    this.name = BalanceMismatchError.name;
  }
}
