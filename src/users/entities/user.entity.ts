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
   * Баланс в центах. Производное от `balance_ledger` значение,
   * пересчитывается после каждой операции (ADR-0004).
   */
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  balance: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
