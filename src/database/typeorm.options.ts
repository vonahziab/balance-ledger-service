import type { DataSourceOptions } from 'typeorm';
import type { DatabaseEnvironmentVariables } from '../config/env.validation.js';
import { BalanceLedger } from '../users/entities/balance-ledger.entity.js';
import { User } from '../users/entities/user.entity.js';
import { InitialSchema1790274248883 } from './migrations/1790274248883-InitialSchema.js';

/**
 * Общие опции для Nest-приложения и TypeORM CLI (`data-source.ts`).
 * Сущности и миграции перечислены явно, а не glob-маской, поэтому одни и те
 * же опции работают и из `src`, и из `dist`.
 */
export function buildDataSourceOptions(
  env: DatabaseEnvironmentVariables,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    entities: [User, BalanceLedger],
    migrations: [InitialSchema1790274248883],
    // Схема меняется только миграциями (architecture.md#решения).
    synchronize: false,
  };
}
