import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/filters/error-response.dto.js';
import { BalanceResponseDto } from './dto/balance.dto.js';
import { DebitDto, DebitResponseDto } from './dto/debit.dto.js';
import { UserIdParamsDto } from './dto/user-id-params.dto.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from './idempotency-key.decorator.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description: 'VALIDATION_ERROR',
})
@ApiNotFoundResponse({ type: ErrorResponseDto, description: 'USER_NOT_FOUND' })
@ApiTooManyRequestsResponse({
  type: ErrorResponseDto,
  description: 'TOO_MANY_REQUESTS',
})
@ApiInternalServerErrorResponse({
  type: ErrorResponseDto,
  description: 'INTERNAL_ERROR',
})
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':id/debit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Списать с баланса пользователя',
    description:
      'Записывает списание в леджер и пересчитывает баланс по всей ' +
      'истории. Повтор с тем же Idempotency-Key и суммой возвращает ' +
      'исходный результат без повторного списания.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Уникален для каждого списания пользователя, до 255 символов (например, UUID).',
  })
  @ApiOkResponse({ type: DebitResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_FUNDS',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'IDEMPOTENCY_KEY_REUSED: ключ уже использован с другой суммой',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description:
      'LOCK_TIMEOUT: пользователь занят параллельными операциями; ' +
      'SERVICE_BUSY: нет свободных соединений с БД. Повторить с тем же ' +
      'Idempotency-Key после Retry-After',
  })
  debit(
    @Param() { id }: UserIdParamsDto,
    @IdempotencyKey() idempotencyKey: string,
    @Body() { amount }: DebitDto,
  ): Promise<DebitResponseDto> {
    return this.usersService.debit(id, amount, idempotencyKey);
  }

  @Get(':id/balance')
  @ApiOperation({
    summary: 'Текущий баланс пользователя',
    description:
      'Читается из Redis-кэша, при промахе или недоступном Redis — из БД. ' +
      'После списания кэш сбрасывается, но при гонке значение может ' +
      'отставать не дольше TTL кэша.',
  })
  @ApiOkResponse({ type: BalanceResponseDto })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_BUSY: нет свободных соединений с БД',
  })
  getBalance(@Param() { id }: UserIdParamsDto): Promise<BalanceResponseDto> {
    return this.usersService.getBalance(id);
  }
}
