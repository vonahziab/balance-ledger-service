import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class DebitDto {
  @ApiProperty({
    description: 'Сумма списания в целых центах (ADR-0001).',
    example: 10_000,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;
}

export class DebitResponseDto {
  @ApiProperty({
    description:
      'Баланс в центах сразу после этого списания. Повтор с тем же ' +
      'Idempotency-Key возвращает исходное значение (ADR-0002).',
    example: 90_000,
  })
  balance: number;

  @ApiProperty({ description: 'Id записи в леджере.', example: 2 })
  ledgerEntryId: number;
}
