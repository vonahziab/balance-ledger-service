import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import type { DatabaseEnvironmentVariables } from '../../src/config/env.validation.js';
import { buildAppDataSourceOptions } from '../../src/database/typeorm.options.js';

/** Баланс сидового пользователя `id = 1` из миграции. */
export const SEED_BALANCE = 100_000;

export interface TestDatabase {
  dataSource: DataSource;
  /** Параметры подключения — для e2e, где AppModule подключается сам. */
  env: DatabaseEnvironmentVariables;
  /** Возвращает БД к сидовому состоянию: остаётся только сидовая запись. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Поднимает одноразовый Postgres (тот же образ, что в docker-compose.yml) и
 * применяет все миграции, чтобы тесты шли на реальной схеме. Опции — те же,
 * что у приложения, включая таймауты.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start();

  const env: DatabaseEnvironmentVariables = {
    DATABASE_HOST: container.getHost(),
    DATABASE_PORT: container.getPort(),
    DATABASE_USER: container.getUsername(),
    DATABASE_PASSWORD: container.getPassword(),
    DATABASE_NAME: container.getDatabase(),
  };
  const dataSource = new DataSource(buildAppDataSourceOptions(env));
  await dataSource.initialize();
  await dataSource.runMigrations();

  return {
    dataSource,
    env,
    async reset() {
      await dataSource.query(
        `DELETE FROM "balance_ledger" WHERE "idempotency_key" IS NOT NULL`,
      );
      await dataSource.query(`UPDATE "users" SET "balance" = $1`, [
        SEED_BALANCE,
      ]);
    },
    async stop() {
      await dataSource.destroy();
      await container.stop();
    },
  };
}
