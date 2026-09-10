import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { CADENCE_TIMEOUT_S, mulberry32 } from '@paperboy/game-core';
import {
  AMBIGUITY_BAND, CADENCE_HIGH_RPM, CADENCE_LOW_RPM, DANGER_FRACTION, DEEPEST_M,
  FISH_TIERS,
  LIGHT_SIMULATION, MAX_SIZE_M, SHALLOWEST_M, START_SIZE_M, TANK_DEPTH_M,
  advance, createSession, depthFor, ensureFish, fishDepth, grownBy, isAmbiguous,
  isEdible, setCadence, simulationFor, spawnSize, speedFor, stopRun, tierFor,
  toRunSummary, touching,
} from '../src/session.js';
import type { Fish, FishSession } from '../src/session.js';

const DT = 1 / 120;

function swim(
  s: FishSession, seconds: number, rpm: number | null, watts = 150,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    setCadence(s, rpm);
    advance(s, DT, watts);
  }
}

/** An empty sea, so one hand-placed fish is the only thing that can happen. */
function emptySea(): FishSession {
  const s = createSession(DEFAULT_RIDER, 11);
  s.nextSpawnX = Number.POSITIVE_INFINITY;
  return s;
}

function planted(s: FishSession, size: number, overrides: Partial<Fish> = {}): Fish {
  const f: Fish = {
    id: 1, x: s.distance, depth: s.depth, size,
    vx: 0, bobAmp: 0, bobRate: 0, bobPhase: 0, look: 0, eaten: false,
    ...overrides,
  };
  s.fish.push(f);
  return f;
}

describe('depthFor — the control axis', () => {
  it('is a direct map: a cadence is a depth', () => {
    expect(depthFor(CADENCE_LOW_RPM)).toBeCloseTo(DEEPEST_M, 9);
    expect(depthFor(CADENCE_HIGH_RPM)).toBeCloseTo(SHALLOWEST_M, 9);
  });

  it('puts a higher cadence higher in the water, as Spin Cycle does', () => {
    expect(depthFor(100)).toBeLessThan(depthFor(70));
  });

  it('is proportional between the ends', () => {
    const mid = (CADENCE_LOW_RPM + CADENCE_HIGH_RPM) / 2;
    expect(depthFor(mid)).toBeCloseTo((DEEPEST_M + SHALLOWEST_M) / 2, 9);
  });

  it('clamps rather than swimming out of the sea', () => {
    expect(depthFor(5)).toBe(DEEPEST_M);
    expect(depthFor(400)).toBe(SHALLOWEST_M);
  });
});

describe('advance — cadence steers depth', () => {
  it('rises toward the surface on a high cadence', () => {
    const s = emptySea();
    const before = s.depth;
    swim(s, 2, 105);
    expect(s.depth).toBeLessThan(before);
  });

  it('sinks toward the floor on a low cadence', () => {
    const s = emptySea();
    const before = s.depth;
    swim(s, 2, 55);
    expect(s.depth).toBeGreaterThan(before);
  });

  it('settles on the mapped depth rather than drifting past it', () => {
    const s = emptySea();
    swim(s, 4, 95);
    expect(s.depth).toBeCloseTo(depthFor(95), 3);
  });

  it('gets there quickly, because swimming should feel precise', () => {
    const s = emptySea();
    swim(s, 0.5, 105);
    const remaining = Math.abs(s.depth - depthFor(105));
    expect(remaining).toBeLessThan(TANK_DEPTH_M * 0.02);
  });

  it('stays in the water at both extremes', () => {
    const shallow = emptySea();
    swim(shallow, 4, 200);
    expect(shallow.depth).toBeGreaterThanOrEqual(0);
    const deep = emptySea();
    swim(deep, 4, 0);
    expect(deep.depth).toBeLessThanOrEqual(TANK_DEPTH_M);
  });
});

describe('speedFor — power is the other axis', () => {
  it('drifts with nothing on the pedals', () => {
    expect(speedFor(DEFAULT_RIDER, 0)).toBeGreaterThan(0);
  });

  it('swims faster the harder the rider goes', () => {
    expect(speedFor(DEFAULT_RIDER, 300)).toBeGreaterThan(speedFor(DEFAULT_RIDER, 60));
  });

  it('survives nonsense watts', () => {
    expect(Number.isFinite(speedFor(DEFAULT_RIDER, Number.NaN))).toBe(true);
  });
});

describe('size — the whole game', () => {
  it('calls strictly smaller things food', () => {
    expect(isEdible(2, 1.9)).toBe(true);
    expect(isEdible(2, 2)).toBe(false);
    expect(isEdible(2, 2.1)).toBe(false);
  });

  it('grows you when you eat, and by less each time', () => {
    const first = grownBy(START_SIZE_M, 0.8);
    expect(first).toBeGreaterThan(START_SIZE_M);
    const laterGain = grownBy(6, 0.8) - 6;
    expect(laterGain).toBeLessThan(first - START_SIZE_M);
  });

  it('stops growing at the cap', () => {
    expect(grownBy(MAX_SIZE_M, 10)).toBe(MAX_SIZE_M);
  });

  it('finds the rung of the ladder for a size', () => {
    expect(FISH_TIERS[tierFor(0.1)]).toBe(FISH_TIERS[0]);
    expect(FISH_TIERS[tierFor(1_000)]).toBe(FISH_TIERS[FISH_TIERS.length - 1]);
  });

  it('never spawns something too close to your size to call', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 3000; i++) {
      const playerSize = 0.5 + (i % 200) * 0.06;
      const size = spawnSize(rng, playerSize);
      expect(isAmbiguous(playerSize, size)).toBe(false);
      expect(size).toBeGreaterThan(0);
    }
  });

  it('offers mostly food and some danger, at every size', () => {
    // Half-and-half made the sea unswimmable: you cannot grow if every other
    // thing you meet ends the run, and without growing there is no game.
    const rng = mulberry32(5);
    const n = 4000;
    for (const playerSize of [0.4, 1.2, 2.6, 5.0, 9.0]) {
      let danger = 0;
      for (let i = 0; i < n; i++) {
        if (!isEdible(playerSize, spawnSize(rng, playerSize))) danger += 1;
      }
      expect(danger / n).toBeGreaterThan(DANGER_FRACTION - 0.12);
      expect(danger / n).toBeLessThan(DANGER_FRACTION + 0.12);
    }
  });

  it('always produces a real, positive size', () => {
    const rng = mulberry32(77);
    for (let i = 0; i < 4000; i++) {
      const size = spawnSize(rng, 0.3 + (i % 300) * 0.05);
      expect(Number.isFinite(size)).toBe(true);
      expect(size).toBeGreaterThan(0);
    }
  });

  it('draws from an ABSOLUTE ladder, so growing changes what is dangerous', () => {
    // The rung that ends a 1.2 m fish is lunch for a 3 m one. That is the
    // entire difficulty curve, and no number went up to produce it.
    const rung = FISH_TIERS[3]!;
    expect(isEdible(1.2, rung)).toBe(false);
    expect(isEdible(3.0, rung)).toBe(true);
    expect(AMBIGUITY_BAND).toBeGreaterThan(0);
  });
});

describe('eating and being eaten', () => {
  it('grows you when you touch something smaller', () => {
    const s = emptySea();
    planted(s, START_SIZE_M * 0.5);
    setCadence(s, 80);
    advance(s, DT, 150);
    expect(s.over).toBe(false);
    expect(s.eaten).toBe(1);
    expect(s.size).toBeGreaterThan(START_SIZE_M);
  });

  it('ends the run when you touch something bigger', () => {
    const s = emptySea();
    planted(s, START_SIZE_M * 2);
    setCadence(s, 80);
    advance(s, DT, 150);
    expect(s.over).toBe(true);
    expect(s.swallowed).toBe(true);
  });

  it('remembers the biggest mouthful', () => {
    const s = emptySea();
    planted(s, 0.4, { id: 1 });
    planted(s, 0.9, { id: 2 });
    setCadence(s, 80);
    advance(s, DT, 150);
    expect(s.eaten).toBe(2);
    expect(s.biggestEaten).toBeCloseTo(0.9, 9);
  });

  it('lets a fish that was lethal become food once you have grown', () => {
    const small = emptySea();
    planted(small, 2.0);
    setCadence(small, 80);
    advance(small, DT, 150);
    expect(small.swallowed).toBe(true);

    const big = emptySea();
    big.size = 3.5;
    planted(big, 2.0);
    setCadence(big, 80);
    advance(big, DT, 150);
    expect(big.swallowed).toBe(false);
    expect(big.eaten).toBe(1);
  });

  it('clears an eaten fish out of the sea', () => {
    const s = emptySea();
    planted(s, 0.4);
    setCadence(s, 80);
    advance(s, DT, 150);
    expect(s.fish).toHaveLength(0);
  });
});

describe('touching', () => {
  const f: Fish = {
    id: 1, x: 100, depth: 20, size: 1, vx: 0,
    bobAmp: 0, bobRate: 0, bobPhase: 0, look: 0, eaten: false,
  };

  it('misses at a distance', () => {
    expect(touching(80, 20, 1, f, 20)).toBe(false);
  });

  it('misses when at the same place but different depths', () => {
    expect(touching(100, 32, 1, f, 20)).toBe(false);
  });

  it('touches when overlapping', () => {
    expect(touching(100, 20, 1, f, 20)).toBe(true);
  });

  it('reaches further for a bigger fish', () => {
    expect(touching(101.7, 20, 1, f, 20)).toBe(false);
    expect(touching(101.7, 20, 3, f, 20)).toBe(true);
  });
});

describe('fishDepth', () => {
  it('bobs around the fish own depth', () => {
    const f: Fish = {
      id: 1, x: 0, depth: 20, size: 1, vx: 0,
      bobAmp: 2, bobRate: 1, bobPhase: 0, look: 0, eaten: false,
    };
    expect(fishDepth(f, 0)).toBeCloseTo(20, 9);
    expect(fishDepth(f, Math.PI / 2)).toBeCloseTo(22, 9);
  });

  it('keeps a fish inside the water however hard it bobs', () => {
    const f: Fish = {
      id: 1, x: 0, depth: 1, size: 3, vx: 0,
      bobAmp: 40, bobRate: 1, bobPhase: 0, look: 0, eaten: false,
    };
    for (let t = 0; t < 20; t += 0.3) {
      expect(fishDepth(f, t)).toBeGreaterThanOrEqual(f.size);
      expect(fishDepth(f, t)).toBeLessThanOrEqual(TANK_DEPTH_M - f.size);
    }
  });
});

describe('stocking the sea', () => {
  it('puts fish ahead of you and forgets what is behind', () => {
    const s = createSession(DEFAULT_RIDER, 3);
    ensureFish(s);
    expect(s.fish.length).toBeGreaterThan(0);
    for (const f of s.fish) expect(f.x).toBeGreaterThan(s.distance);
  });

  it('keeps the population bounded over a long swim', () => {
    const s = createSession(DEFAULT_RIDER, 3);
    s.size = MAX_SIZE_M;
    swim(s, 90, 80, 250);
    expect(s.fish.length).toBeLessThan(60);
  });
});

describe('cadence missing', () => {
  it('is not reported during the short grace period', () => {
    const s = emptySea();
    swim(s, CADENCE_TIMEOUT_S * 0.5, null);
    expect(s.cadence.missing).toBe(false);
  });

  it('holds the depth last asked for through the grace period', () => {
    const s = emptySea();
    swim(s, 2, 100);
    const held = s.depth;
    swim(s, CADENCE_TIMEOUT_S * 0.5, null);
    // It keeps converging on the depth it was already going to, and does not
    // drift off toward the floor.
    expect(Math.abs(s.depth - held)).toBeLessThan(0.01);
  });

  it('is entered and reported once the timeout passes', () => {
    const s = emptySea();
    swim(s, CADENCE_TIMEOUT_S + 0.5, null);
    expect(s.cadence.missing).toBe(true);
  });

  it('holds the sea still rather than feeding you to something', () => {
    const s = emptySea();
    swim(s, CADENCE_TIMEOUT_S + 1, null);
    expect(s.cadence.missing).toBe(true);

    planted(s, START_SIZE_M * 4, { x: s.distance + 2, vx: -4 });
    const where = s.distance;
    swim(s, 20, null, 250);
    expect(s.over).toBe(false);
    expect(s.speed).toBe(0);
    expect(s.distance).toBe(where);
  });

  it('does not start the run before the first reading arrives at all', () => {
    // A trainer with no cadence sensor must not be swum into a shark during
    // the grace period, so the world does not move until it has been steered.
    const s = createSession(DEFAULT_RIDER, 3);
    swim(s, CADENCE_TIMEOUT_S * 0.5, null, 300);
    expect(s.distance).toBe(0);
    expect(s.fish).toHaveLength(0);
    expect(s.over).toBe(false);
  });

  it('clears the moment a real reading arrives', () => {
    const s = emptySea();
    swim(s, CADENCE_TIMEOUT_S + 1, null);
    expect(s.cadence.missing).toBe(true);
    swim(s, 0.5, 105);
    expect(s.cadence.missing).toBe(false);
  });

  it('treats an implausible reading as no reading at all', () => {
    const s = emptySea();
    swim(s, CADENCE_TIMEOUT_S + 0.5, 5000);
    expect(s.cadence.missing).toBe(true);
  });
});

describe('the end of a run', () => {
  it('is inert afterwards', () => {
    const s = createSession(DEFAULT_RIDER, 8);
    swim(s, 2, 90, 200);
    stopRun(s);
    const snapshot = { ...s };
    swim(s, 5, 105, 320);
    expect(s.distance).toBe(snapshot.distance);
    expect(s.depth).toBe(snapshot.depth);
    expect(s.size).toBe(snapshot.size);
    expect(s.eaten).toBe(snapshot.eaten);
    expect(s.elapsed).toBe(snapshot.elapsed);
  });

  it('cannot be eaten after being eaten', () => {
    const s = emptySea();
    planted(s, START_SIZE_M * 3);
    setCadence(s, 80);
    advance(s, DT, 150);
    expect(s.over).toBe(true);
    const eatenCount = s.eaten;
    planted(s, 0.1);
    advance(s, DT, 150);
    expect(s.eaten).toBe(eatenCount);
  });

  it('marks a safety stop as stopped rather than swallowed', () => {
    const s = createSession(DEFAULT_RIDER, 8);
    stopRun(s);
    expect(s.stopped).toBe(true);
    expect(s.swallowed).toBe(false);
    expect(s.over).toBe(true);
  });

  it('summarises the run', () => {
    const s = emptySea();
    swim(s, 4, 80, 220);
    const r = toRunSummary(s);
    expect(r.distanceM).toBeGreaterThan(0);
    expect(r.avgPower).toBeGreaterThan(150);
    expect(r.size).toBeCloseTo(START_SIZE_M, 6);
  });
});

describe('determinism', () => {
  it('reproduces a run exactly from the same seed and inputs', () => {
    const inputs = Array.from({ length: 3000 }, (_, i) => ({
      rpm: 80 + Math.sin(i / 110) * 28,
      watts: 190 + Math.sin(i / 43) * 90,
    }));
    const run = (): FishSession => {
      const s = createSession(DEFAULT_RIDER, 20260910);
      for (const step of inputs) {
        setCadence(s, step.rpm);
        advance(s, DT, step.watts);
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(a.distance).toBe(b.distance);
    expect(a.depth).toBe(b.depth);
    expect(a.size).toBe(b.size);
    expect(a.eaten).toBe(b.eaten);
    expect(a.over).toBe(b.over);
    expect(a.fish.map((f) => `${f.id}:${f.size}:${f.x}`))
      .toEqual(b.fish.map((f) => `${f.id}:${f.size}:${f.x}`));
  });

  it('gives a different sea for a different seed', () => {
    const a = createSession(DEFAULT_RIDER, 1);
    const b = createSession(DEFAULT_RIDER, 2);
    ensureFish(a);
    ensureFish(b);
    expect(a.fish.map((f) => f.size).join())
      .not.toBe(b.fish.map((f) => f.size).join());
  });
});

describe('simulationFor', () => {
  it('asks for a flat road and thin water, so steering stays cheap', () => {
    const s = createSession(DEFAULT_RIDER, 1);
    expect(simulationFor(s)).toBe(LIGHT_SIMULATION);
    expect(LIGHT_SIMULATION.grade).toBe(0);
    expect(LIGHT_SIMULATION.cw).toBeLessThan(0.51);
  });
});
