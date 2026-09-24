import { HttpException, type HttpStatus } from '@nestjs/common';

/** Машиночитаемые коды ошибок (architecture.md#обработка-ошибок). */
export enum ErrorCode {
  ValidationError = 'VALIDATION_ERROR',
  UserNotFound = 'USER_NOT_FOUND',
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  IdempotencyKeyReused = 'IDEMPOTENCY_KEY_REUSED',
  LockTimeout = 'LOCK_TIMEOUT',
  ServiceBusy = 'SERVICE_BUSY',
  InternalError = 'INTERNAL_ERROR',
}

/**
 * Ожидаемая ошибка с явным `code`: её `message` безопасен для клиента при
 * любом статусе, `headers` добавляются к ответу. Остальные ошибки получают в
 * exception filter код, выведенный из HTTP-статуса.
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message, status);
  }
}
