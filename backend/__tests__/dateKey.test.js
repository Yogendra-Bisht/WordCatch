const { isValidDateKey } = require('../src/utils/dateKey');

describe('isValidDateKey()', () => {
  function todayUtc() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function offsetDay(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  test('accepts today (UTC)', () => {
    expect(isValidDateKey(todayUtc())).toBe(true);
  });

  test('accepts yesterday (within 1-day tolerance)', () => {
    expect(isValidDateKey(offsetDay(-1))).toBe(true);
  });

  test('accepts tomorrow (within 1-day tolerance)', () => {
    expect(isValidDateKey(offsetDay(1))).toBe(true);
  });

  test('rejects 2 days ago', () => {
    expect(isValidDateKey(offsetDay(-2))).toBe(false);
  });

  test('rejects 2 days in the future', () => {
    expect(isValidDateKey(offsetDay(2))).toBe(false);
  });

  test('rejects wrong format (slash-separated)', () => {
    expect(isValidDateKey('2026/09/21')).toBe(false);
  });

  test('rejects wrong format (no dashes)', () => {
    expect(isValidDateKey('20260921')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidDateKey('')).toBe(false);
  });

  test('rejects invalid calendar date', () => {
    expect(isValidDateKey('2026-13-01')).toBe(false); // month 13
  });

  test('rejects null / undefined gracefully', () => {
    expect(isValidDateKey(null)).toBe(false);
    expect(isValidDateKey(undefined)).toBe(false);
  });
});
