import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from './common/redis/redis.module.js';
import {
  type EnvironmentVariables,
  validateEnv,
} from './config/env.validation.js';
import { buildDataSourceOptions } from './database/typeorm.options.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildDataSourceOptions({
          DATABASE_HOST: config.get('DATABASE_HOST', { infer: true }),
          DATABASE_PORT: config.get('DATABASE_PORT', { infer: true }),
          DATABASE_USER: config.get('DATABASE_USER', { infer: true }),
          DATABASE_PASSWORD: config.get('DATABASE_PASSWORD', { infer: true }),
          DATABASE_NAME: config.get('DATABASE_NAME', { infer: true }),
        }),
    }),
    // THROTTLE_LIMIT запросов в минуту с IP, счётчики в памяти процесса
    // (architecture.md#безопасность).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => [
        { ttl: 60_000, limit: config.get('THROTTLE_LIMIT', { infer: true }) },
      ],
    }),
    RedisModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
