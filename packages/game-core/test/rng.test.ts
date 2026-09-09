import { describe, expect, it } from 'vitest';
import {
  dailySeed, mulberry32, pick, rangeFloat, rangeInt, seedFromString,
} from '../src/rng.js';

describe('mulberry32', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const draw = (r: () => number) => Array.from({ length: 20 }, r);
    expect(draw(a)).toEqual(draw(b));
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const r = mulberry32(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(r() * 10)]! += 1;
    for (const b of buckets) {
      expect(b).toBeGreaterThan(8_000);
      expect(b).toBeLessThan(12_000);
    }
  });
});

describe('seedFromString', () => {
  it('is stable for the same text', () => {
    expect(seedFromString('paperboy')).toBe(seedFromString('paperboy'));
  });

  it('differs for different text', () => {
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });

  it('returns a non-negative 32-bit integer', () => {
    const s = seedFromString('a rather long seed phrase indeed');
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

describe('dailySeed', () => {
  it('is the same for two times on the same UTC day', () => {
    expect(dailySeed(new Date('2026-09-10T01:00:00Z')))
      .toBe(dailySeed(new Date('2026-09-10T23:00:00Z')));
  });

  it('differs across days', () => {
    expect(dailySeed(new Date('2026-09-10T12:00:00Z')))
      .not.toBe(dailySeed(new Date('2026-09-11T12:00:00Z')));
  });
});

describe('helpers', () => {
  it('rangeInt is inclusive at both ends', () => {
    const seen = new Set<number>();
    const r = mulberry32(3);
    for (let i = 0; i < 2000; i++) seen.add(rangeInt(r, 2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('rangeFloat stays within bounds', () => {
    const r = mulberry32(4);
    for (let i = 0; i < 1000; i++) {
      const v = rangeFloat(r, -2, 6);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(6);
    }
  });

  it('pick returns an element of the array', () => {
    const r = mulberry32(5);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(pick(r, items));
  });
});
