import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import type { EnvironmentVariables } from '../config/env.validation.js';

/**
 * Кэш баланса в Redis по ключу `balance:{id}`
 * (architecture.md#поток-запроса-get-usersidbalance).
 *
 * Redis — не источник истины, поэтому методы никогда не бросают: при любой
 * ошибке чтение считается промахом, а запись и удаление пропускаются.
 * Пока клиент не подключён, Redis не вызывается вовсе — недоступность уже
 * залогирована в RedisModule, и логи не засоряются строкой на каждый запрос.
 */
@Injectable()
export class BalanceCache {
  private readonly logger = new Logger(BalanceCache.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlSeconds = config.get('BALANCE_CACHE_TTL_SECONDS', { infer: true });
  }

  /** Баланс из кэша или `null` при промахе и недоступном Redis. */
  async get(userId: number): Promise<number | null> {
    const value = await this.run('GET', userId, (key) => this.redis.get(key));
    // Только строка из цифр: `Number('')` и `Number(' 5')` дали бы число.
    if (value == null || !/^\d+$/.test(value)) {
      return null;
    }
    const balance = Number(value);
    return Number.isSafeInteger(balance) ? balance : null;
  }

  async set(userId: number, balance: number): Promise<void> {
    await this.run('SET', userId, (key) =>
      this.redis.set(key, String(balance), 'EX', this.ttlSeconds),
    );
  }

  async invalidate(userId: number): Promise<void> {
    await this.run('DEL', userId, (key) => this.redis.del(key));
  }

  private async run<T>(
    command: string,
    userId: number,
    fn: (key: string) => Promise<T>,
  ): Promise<T | null> {
    if (this.redis.status !== 'ready') {
      return null;
    }
    try {
      return await fn(`balance:${userId}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${command} balance:${userId} failed: ${reason}`);
      return null;
    }
  }
}
