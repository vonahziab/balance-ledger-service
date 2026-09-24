import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { bigintTransformer } from '../../database/bigint.transformer.js';
import { User } from './user.entity.js';

export enum LedgerAction {
  Debit = 'debit',
  Credit = 'credit',
}

/**
 * Append-only balance history; see architecture.md#модель-данных.
 * Constraints mirror the migration, which is the source of the DDL.
 */
@Entity({ name: 'balance_ledger' })
@Unique('uq_balance_ledger_user_idempotency_key', ['userId', 'idempotencyKey'])
@Check('chk_balance_ledger_amount_positive', `"amount" > 0`)
@Check('chk_balance_ledger_balance_after_non_negative', `"balance_after" >= 0`)
@Check(
  'chk_balance_ledger_idempotency_key_required',
  `"action" = 'credit' OR "idempotency_key" IS NOT NULL`,
)
export class BalanceLedger {
  // `@PrimaryGeneratedColumn` does not accept a transformer.
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  @Generated('increment')
  id: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_balance_ledger_user',
  })
  user?: Relation<User>;

  @Column({ type: 'enum', enum: LedgerAction, enumName: 'ledger_action' })
  action: LedgerAction;

  /** Amount in cents, always positive; the sign comes from `action`. */
  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  /** Balance snapshot right after this entry (ADR-0002). */
  @Column({
    name: 'balance_after',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  balanceAfter: number;

  /** `NULL` only for the seed credit entry (ADR-0002). */
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  idempotencyKey: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  ts: Date;
}
