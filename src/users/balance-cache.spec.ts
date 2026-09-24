import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { BalanceCache } from './balance-cache.js';

describe('BalanceCache', () => {
  const redis = {
    status: 'ready',
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
  const cache = new BalanceCache(
    redis as unknown as Redis,
    new ConfigService({ BALANCE_CACHE_TTL_SECONDS: 30 }),
  );

  beforeEach(() => {
    vi.resetAllMocks();
    redis.status = 'ready';
  });

  it('reads a cached balance', async () => {
    redis.get.mockResolvedValue('90000');

    await expect(cache.get(1)).resolves.toBe(90_000);
    expect(redis.get).toHaveBeenCalledWith('balance:1');
  });

  it.each([null, '', ' 5', 'abc', '-1', '1.5'])(
    'treats %s as a miss',
    async (value) => {
      redis.get.mockResolvedValue(value);

      await expect(cache.get(1)).resolves.toBeNull();
    },
  );

  it('writes with TTL and deletes by key', async () => {
    await cache.set(1, 90_000);
    await cache.invalidate(1);

    expect(redis.set).toHaveBeenCalledWith('balance:1', '90000', 'EX', 30);
    expect(redis.del).toHaveBeenCalledWith('balance:1');
  });

  it('bypasses Redis while the client is not connected', async () => {
    redis.status = 'reconnecting';

    await expect(cache.get(1)).resolves.toBeNull();
    await cache.set(1, 90_000);
    await cache.invalidate(1);

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('swallows Redis errors and logs a warning', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    redis.get.mockRejectedValue(new Error('Command timed out'));
    redis.del.mockRejectedValue(new Error('Command timed out'));

    try {
      await expect(cache.get(1)).resolves.toBeNull();
      await expect(cache.invalidate(1)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'GET balance:1 failed: Command timed out',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
