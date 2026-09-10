import { describe, expect, it } from 'vitest';
import {
  SPRINKLER_OFF_S, SPRINKLER_ON_S, SPRINKLER_PERIOD_S, isHazardActive,
} from '../src/hazard.js';
import type { HazardSpec } from '../src/route.js';

function spec(over: Partial<HazardSpec> = {}): HazardSpec {
  return {
    id: 'z', kind: 'sprinkler', distance: 100, lateral: 2.2, width: 1.2,
    speed: 0, phase: 0, moving: false, ...over,
  };
}

describe('isHazardActive — sprinkler cycle', () => {
  it('is active for the on-portion of its period', () => {
    const s = spec({ phase: 0 });
    expect(isHazardActive(s, 0)).toBe(true);
    expect(isHazardActive(s, SPRINKLER_ON_S - 0.001)).toBe(true);
  });

  it('is inactive for the off-portion of its period', () => {
    const s = spec({ phase: 0 });
    expect(isHazardActive(s, SPRINKLER_ON_S)).toBe(false);
    expect(isHazardActive(s, SPRINKLER_ON_S + SPRINKLER_OFF_S - 0.001)).toBe(false);
  });

  it('repeats with the documented period', () => {
    const s = spec({ phase: 0 });
    for (let cycle = 0; cycle < 5; cycle++) {
      const base = cycle * SPRINKLER_PERIOD_S;
      expect(isHazardActive(s, base)).toBe(true);
      expect(isHazardActive(s, base + SPRINKLER_ON_S + 0.5)).toBe(false);
    }
  });

  it('is a pure function of phase and elapsed (deterministic, repeatable)', () => {
    const s = spec({ phase: 0.37 });
    const a = isHazardActive(s, 12.34);
    const b = isHazardActive(s, 12.34);
    expect(a).toBe(b);
  });

  it('offsets two sprinklers with different phases out of sync', () => {
    const a = spec({ id: 'a', phase: 0 });
    const b = spec({ id: 'b', phase: 0.5 });

    // Scan a full period: the two must disagree somewhere, proving they are
    // not just two copies of the same cycle running in lockstep.
    let disagreed = false;
    for (let t = 0; t < SPRINKLER_PERIOD_S; t += 0.1) {
      if (isHazardActive(a, t) !== isHazardActive(b, t)) disagreed = true;
    }
    expect(disagreed).toBe(true);
  });

  it('never lets Math.random or wall-clock time leak in — same phase and elapsed always agree', () => {
    const s = spec({ phase: 0.81 });
    const results = new Set(
      Array.from({ length: 5 }, () => isHazardActive(s, 42)),
    );
    expect(results.size).toBe(1);
  });
});

describe('isHazardActive — non-sprinkler hazards', () => {
  const kinds: HazardSpec['kind'][] = [
    'car', 'dog', 'lawnmower', 'drain', 'bin', 'skater',
  ];

  it('is always active regardless of elapsed time or phase', () => {
    for (const kind of kinds) {
      const s = spec({ kind, phase: 0.9 });
      expect(isHazardActive(s, 0)).toBe(true);
      expect(isHazardActive(s, SPRINKLER_ON_S)).toBe(true);
      expect(isHazardActive(s, 1_000_000)).toBe(true);
    }
  });
});
