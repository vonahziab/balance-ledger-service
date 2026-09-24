import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** Максимум для колонки `users.id` типа Postgres `int`. */
const MAX_USER_ID = 2_147_483_647;

export class UserIdParamsDto {
  @ApiProperty({ example: 1, minimum: 1, maximum: MAX_USER_ID })
  // В число превращаются только строки из цифр; `1.5`, `1e3` или `0x1`
  // остаются строками и не проходят `@IsInt`.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  // class-validator проверяет декораторы снизу вверх, а
  // `stopAtFirstError` оставляет первое сообщение: `@IsInt` идёт последним,
  // чтобы на строку ответ был «must be an integer», а не про `@Max`.
  @Max(MAX_USER_ID)
  @Min(1)
  @IsInt()
  id: number;
}
