import { bigintTransformer } from './bigint.transformer.js';

describe('bigintTransformer', () => {
  describe('from', () => {
    it('parses a pg bigint string into a number', () => {
      expect(bigintTransformer.from('100000')).toBe(100_000);
    });

    it('keeps null', () => {
      expect(bigintTransformer.from(null)).toBeNull();
    });

    it('accepts Number.MAX_SAFE_INTEGER', () => {
      expect(bigintTransformer.from(String(Number.MAX_SAFE_INTEGER))).toBe(
        Number.MAX_SAFE_INTEGER,
      );
    });

    it('throws beyond Number.MAX_SAFE_INTEGER', () => {
      expect(() => bigintTransformer.from('9007199254740992')).toThrow(
        RangeError,
      );
    });
  });
});
