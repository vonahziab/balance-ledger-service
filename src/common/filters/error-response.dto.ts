import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from '../errors/api.exception.js';

/** Тело любого ответа с ошибкой (architecture.md#обработка-ошибок). */
export class ErrorResponseDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({
    example: ErrorCode.InsufficientFunds,
    // Не `enum`: ошибки фреймворка получают код по имени статуса, и список
    // был бы неполным для генераторов клиентов.
    description:
      'Стабильный машиночитаемый код; логику клиента строить по нему. ' +
      `Коды сервиса: ${Object.values(ErrorCode).join(', ')}. Прочие ошибки ` +
      'получают код по имени HTTP-статуса (NOT_FOUND, TOO_MANY_REQUESTS, …).',
  })
  code: string;

  @ApiProperty({ example: 'Conflict' })
  error: string;

  @ApiProperty({
    example: 'Insufficient funds',
    description: 'Описание ошибки для человека.',
  })
  message: string;
}
