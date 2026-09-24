import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiException, ErrorCode } from '../errors/api.exception.js';
import type { ErrorResponseDto } from './error-response.dto.js';

/**
 * Приводит любую ошибку к `{ statusCode, code, error, message }`
 * (architecture.md#обработка-ошибок).
 *
 * Непредвиденные ошибки (`500 INTERNAL_ERROR`) логируются со стеком, а клиент
 * получает общий текст — внутренние детали наружу не уходят. Ожидаемые
 * `5xx` (`ApiException`: перегрузка) — `warn`. `4xx` — штатные ответы, статус
 * которых уже пишет middleware, поэтому причина идёт только в `debug`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<{ method: string; originalUrl: string }>();
    const res = http.getResponse<Response>();
    const body = toErrorResponse(exception);
    const route = `${req.method} ${req.originalUrl}`;
    const summary = `${route} ${body.statusCode} ${body.code}: ${body.message}`;

    if (body.statusCode < 500) {
      this.logger.debug(summary);
    } else if (exception instanceof ApiException) {
      this.logger.warn(summary);
    } else {
      this.logger.error(
        `${route} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (exception instanceof ApiException) {
      res.set(exception.headers);
    }
    res.status(body.statusCode).json(body);
  }
}

function toErrorResponse(exception: unknown): ErrorResponseDto {
  const status = statusOf(exception);

  if (exception instanceof ApiException) {
    return build(status, exception.code, messageOf(exception));
  }
  if (status >= 500) {
    return build(status, ErrorCode.InternalError, 'Internal server error');
  }

  const message = messageOf(exception);
  // Сюда с 400 попадают ValidationPipe, проверка Idempotency-Key и
  // невалидный JSON.
  if (status === 400) {
    return build(status, ErrorCode.ValidationError, message);
  }
  // Прочие ошибки фреймворка (неизвестный маршрут, rate limit, большое тело…):
  // кодом служит имя статуса, например 429 -> TOO_MANY_REQUESTS.
  return build(status, HttpStatus[status] ?? 'ERROR', message);
}

function build(
  statusCode: number,
  code: string,
  message: string,
): ErrorResponseDto {
  return {
    statusCode,
    code,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message,
  };
}

/**
 * Кроме `HttpException`, безопасный для клиента 4xx `status` несут ошибки
 * body-parser из Express (невалидный JSON, слишком большое тело).
 */
function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (isHttpError(exception)) {
    return exception.status;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function messageOf(exception: unknown): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    // ValidationPipe кладёт в массив по сообщению на каждое нарушение.
    const { message } = response as { message?: string | string[] };
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return message ?? exception.message;
  }
  return exception instanceof Error ? exception.message : String(exception);
}

function isHttpError(
  exception: unknown,
): exception is Error & { status: number; expose: true } {
  return (
    exception instanceof Error &&
    'expose' in exception &&
    exception.expose === true &&
    'status' in exception &&
    typeof exception.status === 'number'
  );
}
