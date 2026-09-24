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
 * Starts a throwaway Postgres (same image as docker-compose.yml) and applies
 * all migrations, so tests run against the real schema.
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
