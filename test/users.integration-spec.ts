import type { BalanceCache } from '../src/users/balance-cache.js';
import { UsersService } from '../src/users/users.service.js';
import {
  BalanceMismatchError,
  IdempotencyKeyReusedException,
  InsufficientFundsException,
  LockTimeoutException,
  ServiceBusyException,
  UserNotFoundException,
} from '../src/users/users.errors.js';
import {
  SEED_BALANCE,
  startTestDatabase,
  type TestDatabase,
} from './utils/database.js';

const USER_ID = 1;

/**
 * `UsersService` на реальном Postgres: то, что моки не ловят, —
 * блокировка строки пользователя, идемпотентность под гонкой и пересчёт
 * через `SUM`. После каждого сценария проверяется инвариант ADR-0004.
 * Кэш — заглушка: проверяется, когда сервис его читает, пишет и сбрасывает;
 * работа с Redis — в src/users/balance-cache.spec.ts.
 */
describe('UsersService', () => {
  let db: TestDatabase;
  let service: UsersService;
  const cache = {
    get: vi.fn<BalanceCache['get']>(),
    set: vi.fn<BalanceCache['set']>(),
    invalidate: vi.fn<BalanceCache['invalidate']>(),
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    service = new UsersService(db.dataSource, cache as unknown as BalanceCache);
  });

  afterAll(async () => {
    await db?.stop();
  });

  // Сценарии независимы: каждый начинает с сидового состояния и пустого кэша.
  beforeEach(async () => {
    vi.resetAllMocks();
    cache.get.mockResolvedValue(null);
    await db.reset();
  });

  // Инвариант ADR-0004: users.balance = SUM по леджеру = balance_after
  // последней записи.
  afterEach(async () => {
    const [row] = await db.dataSource.query<
      { balance: string; ledger_sum: string; last_balance_after: string }[]
    >(
      `SELECT u."balance",
              (SELECT SUM(CASE WHEN "action" = 'credit' THEN "amount" ELSE -"amount" END)
               FROM "balance_ledger" WHERE "user_id" = u."id") AS ledger_sum,
              (SELECT "balance_after" FROM "balance_ledger"
               WHERE "user_id" = u."id" ORDER BY "id" DESC LIMIT 1) AS last_balance_after
       FROM "users" u WHERE u."id" = $1`,
      [USER_ID],
    );
    expect(row.ledger_sum).toBe(row.balance);
    expect(row.last_balance_after).toBe(row.balance);
  });

  it('parallel debits with different keys are all applied exactly once', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        service.debit(USER_ID, 100, `key-${i}`),
      ),
    );

    // Под блокировкой списания идут строго по очереди: каждый видит
    // баланс после предыдущего, промежуточные значения не повторяются.
    const balances = results.map((r) => r.balance).sort((a, b) => b - a);
    expect(balances).toEqual(
      Array.from({ length: 20 }, (_, i) => SEED_BALANCE - 100 * (i + 1)),
    );
  });

  it('parallel requests with one key debit once and return the same result', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.debit(USER_ID, 100, 'same')),
    );

    expect(results).toEqual(
      Array(20).fill({
        balance: SEED_BALANCE - 100,
        ledgerEntryId: results[0].ledgerEntryId,
      }),
    );
  });

  it('never overdraws under parallel debits', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        service.debit(USER_ID, 30_000, `big-${i}`),
      ),
    );

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.length - rejected.length).toBe(3);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(InsufficientFundsException);
    }
  });

  it('rejects a reused key with a different amount', async () => {
    await service.debit(USER_ID, 100, 'reused');

    await expect(service.debit(USER_ID, 200, 'reused')).rejects.toBeInstanceOf(
      IdempotencyKeyReusedException,
    );
  });

  it('replay returns the original balance, not the current one', async () => {
    const first = await service.debit(USER_ID, 100, 'first');
    await service.debit(USER_ID, 100, 'second');

    await expect(service.debit(USER_ID, 100, 'first')).resolves.toEqual(first);
  });

  it('replay succeeds even when the remaining balance is insufficient', async () => {
    const first = await service.debit(USER_ID, 100, 'first');
    await service.debit(USER_ID, SEED_BALANCE - 100, 'rest');

    await expect(service.debit(USER_ID, 100, 'first')).resolves.toEqual(first);
  });

  it('rolls back when users.balance drifts from the ledger', async () => {
    await db.dataSource.query(
      `UPDATE "users" SET "balance" = $1 WHERE "id" = $2`,
      [SEED_BALANCE / 2, USER_ID],
    );
    try {
      await expect(service.debit(USER_ID, 100, 'drift')).rejects.toBeInstanceOf(
        BalanceMismatchError,
      );

      const [{ balance }] = await db.dataSource.query<{ balance: string }[]>(
        `SELECT "balance" FROM "users" WHERE "id" = $1`,
        [USER_ID],
      );
      const [{ count }] = await db.dataSource.query<{ count: string }[]>(
        `SELECT count(*) FROM "balance_ledger" WHERE "idempotency_key" = 'drift'`,
      );
      expect(balance).toBe(String(SEED_BALANCE / 2));
      expect(count).toBe('0');
    } finally {
      // Иначе инвариант в afterEach упадёт на намеренно испорченном балансе.
      await db.reset();
    }
  });

  it('rejects an unknown user', async () => {
    await expect(service.debit(999, 100, 'unknown')).rejects.toBeInstanceOf(
      UserNotFoundException,
    );
  });

  it('gives up with LockTimeoutException when the user row stays locked', async () => {
    const holder = db.dataSource.createQueryRunner();
    await holder.startTransaction();
    try {
      await holder.query(`SELECT 1 FROM "users" WHERE "id" = $1 FOR UPDATE`, [
        USER_ID,
      ]);

      await expect(
        service.debit(USER_ID, 100, 'locked'),
      ).rejects.toBeInstanceOf(LockTimeoutException);
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }
  });

  it('gives up with ServiceBusyException when the pool is exhausted', async () => {
    // Пул приложения — 10 соединений (buildAppDataSourceOptions).
    const holders = Array.from({ length: 10 }, () =>
      db.dataSource.createQueryRunner(),
    );
    try {
      await Promise.all(holders.map((h) => h.connect()));

      await expect(service.debit(USER_ID, 100, 'busy')).rejects.toBeInstanceOf(
        ServiceBusyException,
      );
      await expect(service.getBalance(USER_ID)).rejects.toBeInstanceOf(
        ServiceBusyException,
      );
    } finally {
      await Promise.all(holders.map((h) => h.release()));
    }
  });

  it('invalidates the cache after a debit, but not after a rejected one', async () => {
    await service.debit(USER_ID, 100, 'ok');
    expect(cache.invalidate).toHaveBeenCalledExactlyOnceWith(USER_ID);

    cache.invalidate.mockClear();
    await expect(
      service.debit(USER_ID, SEED_BALANCE, 'too-much'),
    ).rejects.toBeInstanceOf(InsufficientFundsException);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('getBalance returns a cache hit without touching the cache further', async () => {
    // Значение отличается от БД — значит, ответ взят из кэша.
    cache.get.mockResolvedValue(42);

    await expect(service.getBalance(USER_ID)).resolves.toEqual({ balance: 42 });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('getBalance reads the DB on a miss and fills the cache', async () => {
    await expect(service.getBalance(USER_ID)).resolves.toEqual({
      balance: SEED_BALANCE,
    });
    expect(cache.set).toHaveBeenCalledExactlyOnceWith(USER_ID, SEED_BALANCE);
  });

  it('getBalance does not cache an unknown user', async () => {
    await expect(service.getBalance(999)).rejects.toBeInstanceOf(
      UserNotFoundException,
    );
    expect(cache.set).not.toHaveBeenCalled();
  });
});
