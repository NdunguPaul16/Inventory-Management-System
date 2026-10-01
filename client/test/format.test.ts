import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDuration } from '../src/lib/format';

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [59, '59s'],
    [125, '2m 5s'],
    [3_660, '1h 1m'],
    [90_000, '1d 1h'],
  ])('%i seconds → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('formatDateTime', () => {
  it('displays UTC timestamps in Africa/Nairobi time (UTC+3)', () => {
    expect(formatDateTime('2026-12-31T22:30:00Z')).toMatch(/1 Jan 2027.*01:30:00/);
  });
});
