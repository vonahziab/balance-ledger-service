import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  SEED_BALANCE,
  startTestDatabase,
  type TestDatabase,
} from './utils/database.js';

/**
 * HTTP-контракт `GET /users/:id/balance` на полном AppModule. Redis намеренно
 * недоступен: чтение должно работать из БД. С настоящим Redis — в
 * balance-cache.e2e-spec.ts.
 */
describe('GET /users/:id/balance', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let server: Server;
  const originalEnv = { ...process.env };

  const balance = (id: string | number) =>
    request(server).get(`/users/${id}/balance`);

  beforeAll(async () => {
    db = await startTestDatabase();
    // ConfigModule.forRoot читает process.env при импорте AppModule, поэтому
    // окружение задаётся до динамического импорта.
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

  it('200: returns the balance without Redis', async () => {
    const res = await balance(1).expect(200);
    expect(res.body).toEqual({ balance: SEED_BALANCE });
  });

  it('200: reflects a debit', async () => {
    await request(server)
      .post('/users/1/debit')
      .set('Idempotency-Key', 'k1')
      .send({ amount: 10_000 })
      .expect(200);

    const res = await balance(1).expect(200);
    expect(res.body).toEqual({ balance: SEED_BALANCE - 10_000 });
  });

  it('400 VALIDATION_ERROR for invalid :id', async () => {
    const res = await balance('abc').expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('404 USER_NOT_FOUND', async () => {
    const res = await balance(999).expect(404);
    expect(res.body).toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
