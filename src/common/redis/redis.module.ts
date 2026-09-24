import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { EnvironmentVariables } from '../../config/env.validation.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Общий ioredis-клиент под токеном `REDIS_CLIENT`.
 *
 * Redis — только кэш (architecture.md#поток-запроса-get-usersidbalance),
 * поэтому приложение должно стартовать и обслуживать запросы без него:
 * клиент подключается в фоне, а с выключенной offline-очередью команды без
 * соединения сразу падают (или по таймауту, если Redis перестал отвечать),
 * а не зависают, и вызывающий код уходит в БД.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          // Подключённый, но не отвечающий Redis не должен тормозить запросы.
          commandTimeout: 500,
          // Переподключение с нарастающей паузой, не больше 5 с.
          retryStrategy: (times) => Math.min(times * 200, 5_000),
        });

        // Без обработчика error ioredis выбрасывал бы необработанные ошибки.
        // Каждый сбой логируется один раз, а не на каждой попытке переподключения.
        let healthy = true;
        client.on('ready', () => {
          healthy = true;
          logger.log('Connected');
        });
        client.on('error', (err: NodeJS.ErrnoException) => {
          if (healthy) {
            healthy = false;
            // Ошибки подключения к `localhost` приходят как AggregateError с
            // пустым message; важен code (ECONNREFUSED).
            const reason = err.message || err.code || 'unknown error';
            logger.warn(`Unavailable, cache is bypassed: ${reason}`);
          }
        });

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }
}
