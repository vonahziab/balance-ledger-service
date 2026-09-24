import type { DataSourceOptions } from 'typeorm';
import type { DatabaseEnvironmentVariables } from '../config/env.validation.js';
import { BalanceLedger } from '../users/entities/balance-ledger.entity.js';
import { User } from '../users/entities/user.entity.js';
import { InitialSchema1790274248883 } from './migrations/1790274248883-InitialSchema.js';

/**
 * Shared by the Nest app and the TypeORM CLI (`data-source.ts`).
 * Entities and migrations are listed explicitly rather than globbed, so the
 * same options work from `src` and `dist` alike.
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
    // Schema changes go through migrations only (architecture.md#решения).
    synchronize: false,
  };
}
