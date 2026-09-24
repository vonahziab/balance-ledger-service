import { QueryFailedError } from 'typeorm';

/** SQLSTATE `lock_not_available`: истёк `lock_timeout`. */
const PG_LOCK_NOT_AVAILABLE = '55P03';

/** Текст ошибки `pg-pool`, когда за `connectionTimeoutMillis` не нашлось свободного соединения. */
const POOL_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

export function isLockTimeout(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === PG_LOCK_NOT_AVAILABLE
  );
}

/**
 * `pg-pool` не даёт ошибке кода, TypeORM пробрасывает её как есть — остаётся
 * сравнивать текст. Если при обновлении `pg` текст изменится, это поймает
 * интеграционный тест `ServiceBusyException`.
 */
export function isPoolTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === POOL_TIMEOUT_MESSAGE;
}
