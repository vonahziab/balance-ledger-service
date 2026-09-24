import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import type { LogLevel } from '@nestjs/common';

// От самого важного к наименее: LOG_LEVEL включает свой уровень и все выше.
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const satisfies readonly LogLevel[];

/** Переменные для подключения к Postgres; нужны и TypeORM CLI. */
export class DatabaseEnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DATABASE_PORT: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_USER: string;

  @IsString()
  DATABASE_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_NAME: string;
}

export class EnvironmentVariables extends DatabaseEnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'log';

  // Разрешённые origin через запятую; пустое значение выключает CORS.
  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  // Запросов в минуту с одного IP (architecture.md#безопасность).
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = 100;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number;

  @IsInt()
  @Min(1)
  BALANCE_CACHE_TTL_SECONDS: number = 30;
}

/**
 * Проверяет объект вида `process.env` по `schema` и возвращает типизированные
 * значения. Ошибка перечисляет все невалидные переменные, чтобы приложение
 * падало при старте, а не на первом запросе, которому нужно значение.
 */
export function validateEnv<T extends object = EnvironmentVariables>(
  config: Record<string, unknown>,
  schema: new () => T = EnvironmentVariables as new () => T,
): T {
  const env = plainToInstance(schema, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env);

  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return env;
}
