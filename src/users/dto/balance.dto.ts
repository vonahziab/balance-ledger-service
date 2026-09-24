import { ApiProperty } from '@nestjs/swagger';

export class BalanceResponseDto {
  @ApiProperty({
    description:
      'Текущий баланс в центах (ADR-0001). Может отставать от БД не больше ' +
      'чем на TTL кэша.',
    example: 90_000,
  })
  balance: number;
}
