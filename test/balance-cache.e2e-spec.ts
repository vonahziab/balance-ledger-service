import { once } from 'node:events';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { REDIS_CLIENT } from '../src/common/redis/redis.module.js';
import {
  SEED_BALANCE,
  startTestDatabase,
  type TestDatabase,
} from './utils/database.js';

/**
 * Cache-aside `GET /users/:id/balance` на полном AppModule с настоящим Redis:
 * промах заполняет кэш, попадание читается из него, списание его сбрасывает.
 * Работа без Redis — в balance.e2e-spec.ts.
 */
describe('GET /users/:id/balance with Redis', () => {
  let db: TestDatabase;
  let redisContainer: StartedRedisContainer;
  let app: INestApplication;
  let server: Server;
  let redis: Redis;
  const originalEnv = { ...process.env };

  const balance = () => request(server).get('/users/1/balance').expect(200);

  beforeAll(async () => {
    [db, redisContainer] = await Promise.all([
      startTestDatabase(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    // ConfigModule.forRoot читает process.env при импорте AppModule, поэтому
    // окружение задаётся до динамического импорта.
    Object.assign(process.env, {
      ...db.env,
      REDIS_HOST: redisContainer.getHost(),
      REDIS_PORT: String(redisContainer.getPort()),
    });
    const { AppModule } = await import('../src/app.module.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    // Клиент подключается в фоне; пока он не готов, кэш обходится.
    redis = app.get<Redis>(REDIS_CLIENT);
    if (redis.status !== 'ready') {
      await once(redis, 'ready');
    }
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([db?.stop(), redisContainer?.stop()]);
    process.env = originalEnv;
  });

  beforeEach(async () => {
    await Promise.all([db.reset(), redis.flushdb()]);
  });

  it('fills the cache on a miss and serves a hit from it', async () => {
    await balance().expect({ balance: SEED_BALANCE });
    await expect(redis.get('balance:1')).resolves.toBe(String(SEED_BALANCE));

    // Значение отличается от БД — значит, ответ взят из кэша.
    await redis.set('balance:1', '42');
    await balance().expect({ balance: 42 });
  });

  it('invalidates the cache after a debit', async () => {
    await balance();

    await request(server)
      .post('/users/1/debit')
      .set('Idempotency-Key', 'k1')
      .send({ amount: 10_000 })
      .expect(200);
    await expect(redis.exists('balance:1')).resolves.toBe(0);

    await balance().expect({ balance: SEED_BALANCE - 10_000 });
  });
});
