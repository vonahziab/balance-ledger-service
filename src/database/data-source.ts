import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import {
  DatabaseEnvironmentVariables,
  validateEnv,
} from '../config/env.validation.js';
import { buildDataSourceOptions } from './typeorm.options.js';

// DataSource for the TypeORM CLI (`npm run migration:run`). The Nest app
// builds its own connection from the same options in AppModule. Only the
// database variables are validated, so migrations run without Redis config.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default new DataSource(
  buildDataSourceOptions(
    validateEnv(process.env, DatabaseEnvironmentVariables),
  ),
);
