import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import {
  DatabaseEnvironmentVariables,
  validateEnv,
} from '../config/env.validation.js';
import { buildDataSourceOptions } from './typeorm.options.js';

// DataSource для TypeORM CLI (`npm run migration:run`). Nest-приложение
// создаёт своё подключение из тех же опций в AppModule. Проверяются только
// переменные БД, поэтому миграции запускаются без настроек Redis.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default new DataSource(
  buildDataSourceOptions(
    validateEnv(process.env, DatabaseEnvironmentVariables),
  ),
);
