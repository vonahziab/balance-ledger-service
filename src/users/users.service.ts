import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { bigintTransformer } from '../database/bigint.transformer.js';
import { isLockTimeout, isPoolTimeout } from '../database/pg-errors.js';
import type { DebitResponseDto } from './dto/debit.dto.js';
import {
  BalanceLedger,
  LedgerAction,
} from './entities/balance-ledger.entity.js';
import { User } from './entities/user.entity.js';
import {
  BalanceMismatchError,
  IdempotencyKeyReusedException,
  InsufficientFundsException,
  LockTimeoutException,
  ServiceBusyException,
  UserNotFoundException,
} from './users.errors.js';

@Injectable()
export class UsersService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Списывает `amount` центов с баланса пользователя
   * (architecture.md#поток-запроса-post-usersiddebit).
   *
   * Всё выполняется в одной транзакции под блокировкой строки пользователя
   * (ADR-0003): поиск ключа, проверка средств, запись в леджер и пересчёт
   * атомарны для пользователя. Любое исключение откатывает транзакцию.
   */
  async debit(
    userId: number,
    amount: number,
    idempotencyKey: string,
  ): Promise<DebitResponseDto> {
    try {
      return await this.dataSource.transaction((tx) =>
        this.debitInTransaction(tx, userId, amount, idempotencyKey),
      );
    } catch (error) {
      if (isLockTimeout(error)) {
        throw new LockTimeoutException();
      }
      if (isPoolTimeout(error)) {
        throw new ServiceBusyException();
      }
      throw error;
    }
  }

  private async debitInTransaction(
    tx: EntityManager,
    userId: number,
    amount: number,
    idempotencyKey: string,
  ): Promise<DebitResponseDto> {
    const user = await tx.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // Повтор возвращает исходный результат, а не текущий баланс
    // (ADR-0002). Ключи есть только у списаний, поэтому `action` не
    // проверяется.
    const existing = await tx.findOne(BalanceLedger, {
      where: { userId, idempotencyKey },
    });
    if (existing) {
      if (existing.amount !== amount) {
        throw new IdempotencyKeyReusedException();
      }
      return { balance: existing.balanceAfter, ledgerEntryId: existing.id };
    }

    if (amount > user.balance) {
      throw new InsufficientFundsException();
    }

    const entry = await tx.save(
      tx.create(BalanceLedger, {
        userId,
        action: LedgerAction.Debit,
        amount,
        balanceAfter: user.balance - amount,
        idempotencyKey,
      }),
    );

    const balance = await this.recalculateBalance(tx, userId);
    if (balance !== entry.balanceAfter) {
      throw new BalanceMismatchError(userId, balance, entry.balanceAfter);
    }

    return { balance, ledgerEntryId: entry.id };
  }

  /**
   * Перезаписывает `users.balance` суммой по леджеру пользователя и
   * возвращает её (ADR-0004). `tx` — менеджер транзакции `debit`: запрос
   * идёт в ней же, под блокировкой строки пользователя.
   */
  private async recalculateBalance(
    tx: EntityManager,
    userId: number,
  ): Promise<number> {
    // Для UPDATE Postgres-драйвер TypeORM возвращает `[rows, rowCount]`.
    const [[row]] = await tx.query<[[{ balance: string }], number]>(
      `UPDATE "users"
       SET "balance" = (
         SELECT COALESCE(SUM(CASE WHEN "action" = 'credit' THEN "amount" ELSE -"amount" END), 0)
         FROM "balance_ledger"
         WHERE "user_id" = $1
       )
       WHERE "id" = $1
       RETURNING "balance"`,
      [userId],
    );
    return bigintTransformer.from(row.balance)!;
  }
}
