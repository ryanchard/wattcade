import { describe, expect, it } from 'vitest';
import {
  HAZARD_WEAVE_LATERAL_MIN, SPRINKLER_OFF_S, SPRINKLER_ON_S,
  SPRINKLER_PERIOD_S, hazardPositionAt, isHazardActive,
} from '../src/hazard.js';
import { RIDABLE_MAX } from '../src/route.js';
import type { HazardSpec } from '../src/route.js';

function spec(over: Partial<HazardSpec> = {}): HazardSpec {
  return {
    id: 'z', kind: 'sprinkler', distance: 100, lateral: 2.2, width: 1.2,
    speed: 0, phase: 0, moving: false, ...over,
  };
}

function weaveSpec(over: Partial<HazardSpec> = {}): HazardSpec {
  return spec({ kind: 'dog', moving: true, ...over });
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

describe('hazardPositionAt — the shared weave', () => {
  it('never puts a hazard below the house-footprint edge or above the ridable band', () => {
    // Sweep a wide range of phases and elapsed times: the clamp must hold
    // everywhere, not just at a few hand-picked points. This is exactly
    // the clamp that was present in Version A's hand-copied formula and
    // silently missing from Version B's — pinning it here means neither
    // app can drop it again without this test failing.
    for (let phaseStep = 0; phaseStep <= 10; phaseStep++) {
      const phase = phaseStep / 10;
      for (let t = 0; t < 30; t += 0.37) {
        const { lateral } = hazardPositionAt(weaveSpec({ phase }), t);
        expect(lateral).toBeGreaterThanOrEqual(HAZARD_WEAVE_LATERAL_MIN);
        expect(lateral).toBeLessThanOrEqual(RIDABLE_MAX);
      }
    }
  });

  it('clamps a hazard whose base lateral already sits at the edge of the band', () => {
    const low = hazardPositionAt(
      weaveSpec({ lateral: HAZARD_WEAVE_LATERAL_MIN, phase: 0.25 }),
      0,
    );
    expect(low.lateral).toBeGreaterThanOrEqual(HAZARD_WEAVE_LATERAL_MIN);

    const high = hazardPositionAt(
      weaveSpec({ lateral: RIDABLE_MAX, phase: 0.75 }),
      0,
    );
    expect(high.lateral).toBeLessThanOrEqual(RIDABLE_MAX);
  });

  it('keeps two hazards with different phases out of sync', () => {
    const a = weaveSpec({ id: 'a', phase: 0 });
    const b = weaveSpec({ id: 'b', phase: 0.5 });

    let disagreed = false;
    for (let t = 0; t < 20; t += 0.1) {
      const pa = hazardPositionAt(a, t);
      const pb = hazardPositionAt(b, t);
      if (pa.lateral !== pb.lateral || pa.distance !== pb.distance) {
        disagreed = true;
        break;
      }
    }
    expect(disagreed).toBe(true);
  });

  it('is a deterministic, pure function of spec and elapsed', () => {
    const s = weaveSpec({ phase: 0.63, lateral: 3.4, distance: 250 });
    const a = hazardPositionAt(s, 17.25);
    const b = hazardPositionAt(s, 17.25);
    expect(a).toEqual(b);

    const results = new Set(
      Array.from({ length: 5 }, () => JSON.stringify(hazardPositionAt(s, 42))),
    );
    expect(results.size).toBe(1);
  });
});
