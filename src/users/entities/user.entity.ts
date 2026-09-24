import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigintTransformer } from '../../database/bigint.transformer.js';

@Entity({ name: 'users' })
@Check('chk_users_balance_non_negative', `"balance" >= 0`)
export class User {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  /**
   * Balance in cents. Derived from `balance_ledger` and recalculated after
   * every operation (ADR-0004).
   */
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  balance: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
