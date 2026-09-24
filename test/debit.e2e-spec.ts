import type { Server } from 'node:http';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  SEED_BALANCE,
  startTestDatabase,
  type TestDatabase,
} from './utils/database.js';

/**
 * HTTP-контракт `POST /users/:id/debit` на полном AppModule: валидация,
 * формат ошибок из architecture.md#обработка-ошибок, заголовки ответа.
 * Бизнес-логика под гонкой — в debit.integration-spec.ts.
 */
describe('POST /users/:id/debit', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let server: Server;
  const originalEnv = { ...process.env };

  const debit = (id: string | number, body: object | string, key?: string) => {
    const req = request(server)
      .post(`/users/${id}/debit`)
      .set('Content-Type', 'application/json');
    if (key !== undefined) {
      req.set('Idempotency-Key', key);
    }
    return req.send(typeof body === 'string' ? body : JSON.stringify(body));
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    // ConfigModule.forRoot читает process.env при импорте AppModule, поэтому
    // окружение задаётся до динамического импорта. Redis в M2 не нужен:
    // приложение работает и без него.
    Object.assign(process.env, {
      ...db.env,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '1',
    });
    const { AppModule } = await import('../src/app.module.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
    process.env = originalEnv;
  });

  beforeEach(async () => {
    await db.reset();
  });

  it('200: debits and replays the same result for the same key', async () => {
    const first = await debit(1, { amount: 10_000 }, 'k1').expect(200);
    expect(first.body).toEqual({
      balance: SEED_BALANCE - 10_000,
      ledgerEntryId: expect.any(Number) as number,
    });

    const replay = await debit(1, { amount: 10_000 }, 'k1').expect(200);
    expect(replay.body).toEqual(first.body);
  });

  it.each([
    ['non-numeric :id', 'abc', { amount: 100 }, 'k'],
    ['zero :id', 0, { amount: 100 }, 'k'],
    ['fractional amount', 1, { amount: 1.5 }, 'k'],
    ['string amount', 1, { amount: '100' }, 'k'],
    ['non-positive amount', 1, { amount: 0 }, 'k'],
    ['unknown field', 1, { amount: 100, userId: 2 }, 'k'],
    ['missing Idempotency-Key', 1, { amount: 100 }, undefined],
    ['too long Idempotency-Key', 1, { amount: 100 }, 'x'.repeat(256)],
    ['malformed JSON', 1, '{"amount":', 'k'],
  ])('400 VALIDATION_ERROR: %s', async (_case, id, body, key) => {
    const res = await debit(id, body, key).expect(400);
    expect(res.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      error: 'Bad Request',
      message: expect.any(String) as string,
    });
  });

  it('404 USER_NOT_FOUND', async () => {
    const res = await debit(999, { amount: 100 }, 'k').expect(404);
    expect(res.body).toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('409 INSUFFICIENT_FUNDS', async () => {
    const res = await debit(1, { amount: SEED_BALANCE + 1 }, 'k').expect(409);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('422 IDEMPOTENCY_KEY_REUSED', async () => {
    await debit(1, { amount: 100 }, 'reused').expect(200);

    const res = await debit(1, { amount: 200 }, 'reused').expect(422);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('503 LOCK_TIMEOUT with Retry-After', async () => {
    const holder = db.dataSource.createQueryRunner();
    await holder.startTransaction();
    try {
      await holder.query(`SELECT 1 FROM "users" WHERE "id" = 1 FOR UPDATE`);

      const res = await debit(1, { amount: 100 }, 'locked').expect(503);
      expect(res.headers['retry-after']).toBe('1');
      expect(res.body).toMatchObject({ code: 'LOCK_TIMEOUT' });
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }
  });

  it('500 INTERNAL_ERROR without details on balance mismatch', async () => {
    await db.dataSource.query(
      `UPDATE "users" SET "balance" = 1 WHERE "id" = 1`,
    );

    // Стек в логе ожидаем — глушим вывод, но проверяем, что он был.
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      const res = await debit(1, { amount: 1 }, 'drift').expect(500);
      expect(logError).toHaveBeenCalledWith(
        'POST /users/1/debit failed',
        expect.stringContaining('BalanceMismatchError'),
      );
      expect(res.body).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        error: 'Internal Server Error',
        message: 'Internal server error',
      });
    } finally {
      logError.mockRestore();
    }
  });

  it('404 NOT_FOUND for an unknown route', async () => {
    const res = await request(server).get('/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
