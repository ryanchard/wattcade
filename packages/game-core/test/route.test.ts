import { describe, expect, it } from 'vitest';
import {
  MIN_CORRIDOR_M, RIDABLE_MAX, RIDABLE_MIN,
  freeCorridors, generateBlock,
} from '../src/route.js';
import { BLOCK_LENGTH_M, difficultyAt } from '../src/difficulty.js';

const SEEDS = [1, 42, 1337, 999_999, 7];

describe('generateBlock determinism', () => {
  it('produces an identical block for the same seed and index', () => {
    expect(generateBlock(42, 3)).toEqual(generateBlock(42, 3));
  });

  it('produces different blocks for different seeds', () => {
    expect(generateBlock(1, 3)).not.toEqual(generateBlock(2, 3));
  });

  it('produces different blocks for different indices', () => {
    expect(generateBlock(42, 3)).not.toEqual(generateBlock(42, 4));
  });

  it('does not depend on generation order', () => {
    const forwards = [0, 1, 2, 3].map((i) => generateBlock(42, i));
    const backwards = [3, 2, 1, 0].map((i) => generateBlock(42, i)).reverse();
    expect(forwards).toEqual(backwards);
  });
});

describe('generateBlock geometry', () => {
  it('places the block at the right distance along the street', () => {
    const b = generateBlock(42, 5);
    expect(b.startDistance).toBe(5 * BLOCK_LENGTH_M);
    expect(b.length).toBe(BLOCK_LENGTH_M);
  });

  it('keeps every entity inside the block', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 20; i++) {
        const b = generateBlock(seed, i);
        const inside = (d: number) =>
          d >= b.startDistance && d <= b.startDistance + b.length;
        b.houses.forEach((h) => expect(inside(h.distance)).toBe(true));
        b.hazards.forEach((h) => expect(inside(h.distance)).toBe(true));
        b.stacks.forEach((s) => expect(inside(s.distance)).toBe(true));
      }
    }
  });

  it('respects the grade limit for its difficulty', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 40; i++) {
        const b = generateBlock(seed, i);
        expect(Math.abs(b.gradePercent))
          .toBeLessThanOrEqual(difficultyAt(i).maxGradePercent);
      }
    }
  });

  it('keeps traffic on the road and static hazards off it', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 20; i++) {
        for (const h of generateBlock(seed, i).hazards) {
          if (h.kind === 'car') expect(h.lateral).toBeGreaterThanOrEqual(5.5);
          if (h.kind === 'sprinkler') expect(h.lateral).toBeLessThan(3.0);
        }
      }
    }
  });

  it('gives every house three distinct targets in the right bands', () => {
    for (const h of generateBlock(42, 0).houses) {
      expect(h.windowLateral).toBeLessThan(1.5);
      expect(h.porchLateral).toBeGreaterThanOrEqual(1.5);
      expect(h.porchLateral).toBeLessThan(3.0);
      expect(h.mailboxLateral).toBeGreaterThanOrEqual(2.8);
      expect(h.mailboxLateral).toBeLessThan(4.5);
    }
  });

  it('gives every entity a unique id across a long route', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const b = generateBlock(42, i);
      for (const e of [...b.houses, ...b.hazards, ...b.stacks]) {
        expect(ids.has(e.id)).toBe(false);
        ids.add(e.id);
      }
    }
  });

  it('provides at least one paper stack every few blocks', () => {
    let stacks = 0;
    for (let i = 0; i < 12; i++) stacks += generateBlock(42, i).stacks.length;
    expect(stacks).toBeGreaterThanOrEqual(4);
  });

  it('honours the subscriber ratio approximately', () => {
    let subs = 0;
    let total = 0;
    for (let i = 0; i < 3; i++) {
      for (const h of generateBlock(42, i).houses) {
        total += 1;
        if (h.subscriber) subs += 1;
      }
    }
    expect(subs / total).toBeGreaterThan(0.4);
  });
});

describe('passability invariant', () => {
  it('always leaves a ridable corridor, on every seed and every block', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 60; i++) {
        const b = generateBlock(seed, i);
        for (let d = b.startDistance; d <= b.startDistance + b.length; d += 1) {
          const gaps = freeCorridors(b.hazards, d);
          const widest = Math.max(0, ...gaps.map(([lo, hi]) => hi - lo));
          expect(widest).toBeGreaterThanOrEqual(MIN_CORRIDOR_M);
        }
      }
    }
  });
});

describe('freeCorridors', () => {
  it('returns the whole ridable band when nothing is in the way', () => {
    expect(freeCorridors([], 10)).toEqual([[RIDABLE_MIN, RIDABLE_MAX]]);
  });

  it('splits the band around an obstacle', () => {
    const hazard = {
      id: 'h', kind: 'bin' as const, distance: 10, lateral: 6,
      width: 1, speed: 0, phase: 0, moving: false,
    };
    expect(freeCorridors([hazard], 10)).toEqual([
      [RIDABLE_MIN, 5.5], [6.5, RIDABLE_MAX],
    ]);
  });

  it('ignores hazards that are far away along the street', () => {
    const hazard = {
      id: 'h', kind: 'bin' as const, distance: 80, lateral: 6,
      width: 1, speed: 0, phase: 0, moving: false,
    };
    expect(freeCorridors([hazard], 10)).toEqual([[RIDABLE_MIN, RIDABLE_MAX]]);
  });
});
