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
 * Provides a shared ioredis client under the `REDIS_CLIENT` token.
 *
 * Redis is only a cache (architecture.md#поток-запроса-get-usersidbalance),
 * so the app must start and serve requests without it: the client connects
 * in the background, and with the offline queue disabled commands fail fast
 * while disconnected (or time out if Redis stops responding) instead of
 * hanging, letting callers fall back to the DB.
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
          // A connected but unresponsive Redis must not stall requests.
          commandTimeout: 500,
          // Keep reconnecting with backoff, capped at 5 s.
          retryStrategy: (times) => Math.min(times * 200, 5_000),
        });

        // Without an error listener ioredis would emit unhandled errors.
        // Log each outage once rather than on every reconnect attempt.
        let healthy = true;
        client.on('ready', () => {
          healthy = true;
          logger.log('Connected');
        });
        client.on('error', (err: NodeJS.ErrnoException) => {
          if (healthy) {
            healthy = false;
            // Connection failures to `localhost` arrive as an AggregateError
            // with an empty message; the code (ECONNREFUSED) is what matters.
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
