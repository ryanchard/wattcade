import { describe, expect, it } from 'vitest';
import {
  MIN_CORRIDOR_M, RIDABLE_MAX, RIDABLE_MIN,
  freeCorridors, generateBlock,
} from '../src/route.js';
import type { HazardKind } from '../src/route.js';
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

  it('keeps every hazard kind within its expected lateral band', () => {
    // Deliberately NOT sourced from src/route.ts's internal TEMPLATES table:
    // if this asserted against that same table, a bad edit to a band in
    // TEMPLATES would move both the generated hazards and the expectation
    // together, and the test could never fail. These bounds are copied by
    // hand from the coordinate-system spec (lawn 1.5-3.0, sidewalk 3.0-4.5,
    // curb 4.5-5.5, road 5.5-10.0) with a small margin, independent of
    // route.ts, so a wrong band in the generator actually trips this.
    const expectedBand: Record<HazardKind, [number, number]> = {
      car: [5.5, 10.0],
      skater: [3.0, 4.5],
      dog: [1.5, 4.5],
      lawnmower: [1.5, 3.0],
      sprinkler: [1.5, 3.0],
      bin: [3.0, 4.5],
      drain: [4.5, 5.5],
    };
    const seenKinds = new Set<HazardKind>();
    for (const seed of SEEDS) {
      for (let i = 0; i < 40; i++) {
        for (const h of generateBlock(seed, i).hazards) {
          const [lo, hi] = expectedBand[h.kind];
          expect(h.lateral).toBeGreaterThanOrEqual(lo);
          expect(h.lateral).toBeLessThanOrEqual(hi);
          seenKinds.add(h.kind);
        }
      }
    }
    // Guards against the per-hazard assertions above passing vacuously for a
    // kind that simply never got drawn in the sample — every kind must
    // actually be exercised, not merely checked when it shows up by chance.
    for (const kind of Object.keys(expectedBand) as HazardKind[]) {
      expect(seenKinds.has(kind)).toBe(true);
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

  it('tracks the subscriber ratio ramp across the difficulty curve', () => {
    // Sampling only the first few (easiest) blocks against a loose >0.4
    // bound let a badly broken ratio slip through, since the target there
    // sits at 0.66-0.72 anyway. Instead: sample windows spread across the
    // whole ramp — including where it bottoms out at its 0.35 floor — and
    // compare the observed ratio in each window against the *average*
    // target over that window (the per-block target shifts slightly index
    // to index, so averaging it over the window is the correct comparison,
    // not a looseness concession).
    //
    // Tolerance of 0.15 was set from direct measurement: aggregating 5
    // seeds x a 6-block window x 6 houses (n=180) per checkpoint, the
    // largest deviation seen across three independent 5-seed sets over 8
    // checkpoints spanning indices 0-55 was 0.091. 0.15 leaves that
    // headroom while still catching a materially broken ratio (e.g. a
    // regression that flattens or halves the ramp would miss by far more
    // than this at the extremes of the curve, where target is 0.35 vs 0.72).
    const WINDOW = 6;
    const TOLERANCE = 0.15;
    const starts = [0, 6, 12, 18, 24, 30, 40, 50];
    for (const start of starts) {
      const indices = Array.from({ length: WINDOW }, (_, k) => start + k);
      const avgTarget =
        indices.reduce((sum, i) => sum + difficultyAt(i).subscriberRatio, 0)
        / indices.length;
      let subs = 0;
      let total = 0;
      for (const idx of indices) {
        for (const seed of SEEDS) {
          for (const h of generateBlock(seed, idx).houses) {
            total += 1;
            if (h.subscriber) subs += 1;
          }
        }
      }
      expect(Math.abs(subs / total - avgTarget)).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});

describe('passability invariant', () => {
  // SCOPE: this only proves passability of each block's static spawn
  // configuration — every hazard evaluated at its spawn distance/lateral,
  // never accounting for `speed`, `phase`, or `moving`. A later system that
  // animates hazards along those fields is not covered by this test; see
  // the doc comment on `freeCorridors` in src/route.ts for the full scope
  // note and why a moving hazard transiently narrowing a corridor is fine.
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
