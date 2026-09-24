import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Seed user balance in cents ($1000). */
const SEED_BALANCE = 100_000;

/**
 * Schema from architecture.md#модель-данных plus the fixture user `id = 1`.
 *
 * The seed balance is written together with a matching `credit` entry, so
 * `users.balance` is derivable from the ledger from the very first row
 * (ADR-0004).
 */
export class InitialSchema1790274248883 implements MigrationInterface {
  name = 'InitialSchema1790274248883';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "ledger_action" AS ENUM ('debit', 'credit')`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"         serial      PRIMARY KEY,
        "balance"    bigint      NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_users_balance_non_negative" CHECK ("balance" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "balance_ledger" (
        "id"              bigserial     PRIMARY KEY,
        "user_id"         int           NOT NULL,
        "action"          ledger_action NOT NULL,
        "amount"          bigint        NOT NULL,
        "balance_after"   bigint        NOT NULL,
        "idempotency_key" varchar(255),
        "ts"              timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "fk_balance_ledger_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_balance_ledger_user_idempotency_key"
          UNIQUE ("user_id", "idempotency_key"),
        CONSTRAINT "chk_balance_ledger_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "chk_balance_ledger_balance_after_non_negative"
          CHECK ("balance_after" >= 0),
        CONSTRAINT "chk_balance_ledger_idempotency_key_required"
          CHECK ("action" = 'credit' OR "idempotency_key" IS NOT NULL)
      )
    `);

    await queryRunner.query(
      `INSERT INTO "users" ("id", "balance") VALUES (1, $1)`,
      [SEED_BALANCE],
    );
    await queryRunner.query(
      `INSERT INTO "balance_ledger" ("user_id", "action", "amount", "balance_after")
       VALUES (1, 'credit', $1, $1)`,
      [SEED_BALANCE],
    );
    // `id = 1` was inserted explicitly; move the sequence past it so the
    // next generated id does not collide.
    await queryRunner.query(
      `SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX("id") FROM "users"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "balance_ledger"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "ledger_action"`);
  }
}
