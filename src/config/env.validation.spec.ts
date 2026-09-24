import { DatabaseEnvironmentVariables, validateEnv } from './env.validation.js';

const database = {
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_USER: 'postgres',
  DATABASE_PASSWORD: 'postgres',
  DATABASE_NAME: 'balance_ledger',
};
const valid = { ...database, REDIS_HOST: 'localhost', REDIS_PORT: '6379' };

describe('validateEnv', () => {
  it('converts numeric strings to numbers', () => {
    const env = validateEnv({ ...valid, PORT: '8080' });

    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_PORT).toBe(5432);
    expect(env.REDIS_PORT).toBe(6379);
  });

  it('applies defaults for optional variables', () => {
    const env = validateEnv(valid);

    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('log');
    expect(env.THROTTLE_LIMIT).toBe(100);
    expect(env.BALANCE_CACHE_TTL_SECONDS).toBe(30);
  });

  it('lists every invalid variable', () => {
    const run = () =>
      validateEnv({ ...valid, DATABASE_PORT: 'abc', LOG_LEVEL: 'trace' });

    expect(run).toThrow(/DATABASE_PORT/);
    expect(run).toThrow(/LOG_LEVEL/);
  });

  it('rejects missing required variables', () => {
    expect(() => validateEnv({ ...valid, REDIS_HOST: undefined })).toThrow(
      /REDIS_HOST/,
    );
  });

  it('does not require Redis for the database-only schema', () => {
    const env = validateEnv(database, DatabaseEnvironmentVariables);

    expect(env.DATABASE_PORT).toBe(5432);
  });
});
