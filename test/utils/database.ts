import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/typeorm.options.js';

export interface TestDatabase {
  dataSource: DataSource;
  stop(): Promise<void>;
}

/**
 * Поднимает одноразовый Postgres (тот же образ, что в docker-compose.yml) и
 * применяет все миграции, чтобы тесты шли на реальной схеме.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start();

  const dataSource = new DataSource(
    buildDataSourceOptions({
      DATABASE_HOST: container.getHost(),
      DATABASE_PORT: container.getPort(),
      DATABASE_USER: container.getUsername(),
      DATABASE_PASSWORD: container.getPassword(),
      DATABASE_NAME: container.getDatabase(),
    }),
  );
  await dataSource.initialize();
  await dataSource.runMigrations();

  return {
    dataSource,
    async stop() {
      await dataSource.destroy();
      await container.stop();
    },
  };
}
