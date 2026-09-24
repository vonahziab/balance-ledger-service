import type { QueryRunner } from 'typeorm';
import { startTestDatabase, type TestDatabase } from './utils/database.js';

// Коды SQLSTATE Postgres.
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

/**
 * Ограничения схемы — последний рубеж защиты инвариантов баланса, поэтому
 * они проверяются напрямую, в обход приложения.
 */
describe('InitialSchema migration', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await db?.stop();
  });

  describe('seed', () => {
    it('creates user 1 with $1000 backed by a single credit entry', async () => {
      const users: unknown[] = await db.dataSource.query(
        `SELECT "id", "balance" FROM "users"`,
      );
      const ledger: unknown[] = await db.dataSource.query(
        `SELECT "user_id", "action", "amount", "balance_after", "idempotency_key"
         FROM "balance_ledger"`,
      );

      expect(users).toEqual([{ id: 1, balance: '100000' }]);
      expect(ledger).toEqual([
        {
          user_id: 1,
          action: 'credit',
          amount: '100000',
          balance_after: '100000',
          idempotency_key: null,
        },
      ]);
    });
  });

  // Каждый тест идёт в транзакции, которая откатывается, поэтому тесты не
  // видят строк друг друга. Отклонённый запрос должен быть последним: он
  // обрывает транзакцию.
  describe('constraints', () => {
    let runner: QueryRunner;

    const insertEntry = (entry: {
      userId?: number;
      action?: 'debit' | 'credit';
      amount?: number;
      balanceAfter?: number;
      idempotencyKey?: string | null;
    }): Promise<unknown> =>
      runner.query(
        `INSERT INTO "balance_ledger"
           ("user_id", "action", "amount", "balance_after", "idempotency_key")
         VALUES ($1, $2, $3, $4, $5)`,
        [
          entry.userId ?? 1,
          entry.action ?? 'debit',
          entry.amount ?? 100,
          entry.balanceAfter ?? 99_900,
          entry.idempotencyKey === undefined ? 'key-1' : entry.idempotencyKey,
        ],
      );

    beforeEach(async () => {
      runner = db.dataSource.createQueryRunner();
      await runner.startTransaction();
    });

    afterEach(async () => {
      await runner.rollbackTransaction();
      await runner.release();
    });

    it('accepts a valid debit entry', async () => {
      await expect(insertEntry({})).resolves.toBeDefined();
    });

    it('rejects a negative user balance', async () => {
      await expect(
        runner.query(`UPDATE "users" SET "balance" = -1 WHERE "id" = 1`),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'chk_users_balance_non_negative',
      });
    });

    it.each([0, -100])('rejects amount %i', async (amount) => {
      await expect(insertEntry({ amount })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'chk_balance_ledger_amount_positive',
      });
    });

    it('rejects a negative balance_after', async () => {
      await expect(insertEntry({ balanceAfter: -1 })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'chk_balance_ledger_balance_after_non_negative',
      });
    });

    it('rejects a debit without an idempotency key', async () => {
      await expect(insertEntry({ idempotencyKey: null })).rejects.toMatchObject(
        {
          code: CHECK_VIOLATION,
          constraint: 'chk_balance_ledger_idempotency_key_required',
        },
      );
    });

    it('accepts credits without an idempotency key', async () => {
      await insertEntry({ action: 'credit', idempotencyKey: null });
      await expect(
        insertEntry({ action: 'credit', idempotencyKey: null }),
      ).resolves.toBeDefined();
    });

    it('rejects a repeated idempotency key for the same user', async () => {
      await insertEntry({ idempotencyKey: 'dup' });

      await expect(
        insertEntry({ idempotencyKey: 'dup' }),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'uq_balance_ledger_user_idempotency_key',
      });
    });

    it('accepts the same idempotency key for another user', async () => {
      const [{ id }] = (await runner.query(
        `INSERT INTO "users" ("balance") VALUES (1000) RETURNING "id"`,
      )) as [{ id: number }];
      await insertEntry({ idempotencyKey: 'shared' });

      await expect(
        insertEntry({
          userId: id,
          balanceAfter: 900,
          idempotencyKey: 'shared',
        }),
      ).resolves.toBeDefined();
    });

    it('generates user ids past the seeded one', async () => {
      const [{ id }] = (await runner.query(
        `INSERT INTO "users" DEFAULT VALUES RETURNING "id"`,
      )) as [{ id: number }];

      expect(id).toBeGreaterThan(1);
    });
  });

  // Последним: удаляет и заново создаёт схему.
  describe('down', () => {
    it('reverts cleanly and can be applied again', async () => {
      await db.dataSource.undoLastMigration();

      const [{ tables }] = await db.dataSource.query<[{ tables: number }]>(
        `SELECT count(*)::int AS "tables" FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('users', 'balance_ledger')`,
      );
      expect(tables).toBe(0);

      await db.dataSource.runMigrations();
      const users: unknown[] = await db.dataSource.query(
        `SELECT "id" FROM "users"`,
      );
      expect(users).toEqual([{ id: 1 }]);
    });
  });
});
