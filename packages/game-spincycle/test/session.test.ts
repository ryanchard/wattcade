import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { CADENCE_TIMEOUT_S } from '@paperboy/game-core';
import {
  CADENCE_DEADBAND_RPM, CRAFT_HALF_H_M, GAP_MIN_M, GAP_START_M,
  LIGHT_SIMULATION, MAX_CLIMB_MPS, MAX_SINK_MPS, NEUTRAL_CADENCE_RPM,
  SKY_HEIGHT_M, START_ALTITUDE_M, advance, climbRate, createSession,
  ensureObstacles, gapAt, hits, makeObstacle, setCadence, simulationFor,
  spacingAt, speedFor, stopRun, toRunSummary,
} from '../src/session.js';
import type { SpinSession } from '../src/session.js';
import { mulberry32 } from '@paperboy/game-core';

const DT = 1 / 120;

/** Runs a session for `seconds` at a fixed cadence and power. */
function fly(
  s: SpinSession, seconds: number, rpm: number | null, watts = 150,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    setCadence(s, rpm);
    advance(s, DT, watts);
  }
}

/** A session with no landscape in it, so vertical behaviour can be observed
 * without being interrupted by a church. */
function emptySky(): SpinSession {
  const s = createSession(DEFAULT_RIDER, 7);
  s.nextObstacleX = Number.POSITIVE_INFINITY;
  return s;
}

describe('climbRate — the control axis', () => {
  it('holds level inside the deadband around neutral', () => {
    expect(climbRate(NEUTRAL_CADENCE_RPM)).toBe(0);
    expect(climbRate(NEUTRAL_CADENCE_RPM + CADENCE_DEADBAND_RPM)).toBe(0);
    expect(climbRate(NEUTRAL_CADENCE_RPM - CADENCE_DEADBAND_RPM)).toBe(0);
  });

  it('climbs above neutral and sinks below it', () => {
    expect(climbRate(NEUTRAL_CADENCE_RPM + 20)).toBeGreaterThan(0);
    expect(climbRate(NEUTRAL_CADENCE_RPM - 20)).toBeLessThan(0);
  });

  it('scales with how far past the deadband the rider is', () => {
    const near = climbRate(NEUTRAL_CADENCE_RPM + 10);
    const far = climbRate(NEUTRAL_CADENCE_RPM + 25);
    expect(far).toBeGreaterThan(near);
  });

  it('clamps at the climb and sink ceilings', () => {
    expect(climbRate(400)).toBe(MAX_CLIMB_MPS);
    expect(climbRate(0)).toBe(-MAX_SINK_MPS);
  });

  it('sinks faster than it climbs, so gravity reads as gravity', () => {
    expect(MAX_SINK_MPS).toBeGreaterThan(MAX_CLIMB_MPS);
  });
});

describe('advance — cadence steers altitude', () => {
  it('climbs when cadence is above neutral', () => {
    const s = emptySky();
    fly(s, 2, 100);
    expect(s.altitude).toBeGreaterThan(START_ALTITUDE_M);
  });

  it('sinks when cadence is below neutral', () => {
    const s = emptySky();
    fly(s, 2, 60);
    expect(s.altitude).toBeLessThan(START_ALTITUDE_M);
  });

  it('holds level at neutral cadence', () => {
    const s = emptySky();
    fly(s, 4, NEUTRAL_CADENCE_RPM);
    expect(s.altitude).toBeCloseTo(START_ALTITUDE_M, 6);
  });

  it('falls out of the sky when the rider stops pedalling', () => {
    const s = emptySky();
    fly(s, 6, 0, 0);
    expect(s.over).toBe(true);
    expect(s.crashed).toBe(true);
    expect(s.altitude).toBe(0);
  });

  it('eases the climb rate rather than snapping to it', () => {
    const s = emptySky();
    setCadence(s, 110);
    advance(s, DT, 150);
    // One 1/120 s step cannot have reached the full climb rate.
    expect(s.vertical).toBeLessThan(MAX_CLIMB_MPS * 0.2);
    expect(s.vertical).toBeGreaterThan(0);
  });

  it('bumps along the top of the sky rather than passing through it', () => {
    const s = emptySky();
    fly(s, 12, 130);
    expect(s.altitude).toBe(SKY_HEIGHT_M);
    expect(s.over).toBe(false);
  });
});

describe('speedFor — power is the other axis', () => {
  it('still glides with nothing on the pedals', () => {
    expect(speedFor(DEFAULT_RIDER, 0)).toBeGreaterThan(0);
  });

  it('goes faster the harder the rider goes', () => {
    expect(speedFor(DEFAULT_RIDER, 300)).toBeGreaterThan(speedFor(DEFAULT_RIDER, 100));
  });

  it('survives nonsense watts', () => {
    expect(Number.isFinite(speedFor(DEFAULT_RIDER, Number.NaN))).toBe(true);
    expect(speedFor(DEFAULT_RIDER, -50)).toBe(speedFor(DEFAULT_RIDER, 0));
  });

  it('takes the rider further in the same time when they push harder', () => {
    const easy = emptySky();
    const hard = emptySky();
    fly(easy, 5, NEUTRAL_CADENCE_RPM, 80);
    fly(hard, 5, NEUTRAL_CADENCE_RPM, 320);
    expect(hard.distance).toBeGreaterThan(easy.distance);
  });
});

describe('difficulty', () => {
  it('tightens the gap with time aloft, down to a floor', () => {
    expect(gapAt(0)).toBe(GAP_START_M);
    expect(gapAt(120)).toBeLessThan(GAP_START_M);
    expect(gapAt(100_000)).toBe(GAP_MIN_M);
  });

  it('closes the spacing with time aloft, down to a floor', () => {
    expect(spacingAt(120)).toBeLessThan(spacingAt(0));
    expect(spacingAt(100_000)).toBeGreaterThan(0);
  });

  it('is the same for both riders at the same moment, whatever their speed', () => {
    // This is what makes riding hard worth anything: at any instant the sky
    // is equally tight for everyone, so the faster rider has simply covered
    // more ground to reach it.
    const easy = emptySky();
    const hard = emptySky();
    fly(easy, 30, NEUTRAL_CADENCE_RPM, 90);
    fly(hard, 30, NEUTRAL_CADENCE_RPM, 340);
    expect(hard.distance).toBeGreaterThan(easy.distance);
    expect(gapAt(hard.elapsed)).toBeCloseTo(gapAt(easy.elapsed), 6);
  });
});

describe('makeObstacle', () => {
  it('always leaves somewhere to fly, for every kind', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 400; i++) {
      const o = makeObstacle(rng, 100, gapAt(i * 40));
      const solid = o.spans.reduce((sum, sp) => sum + (sp.hi - sp.lo), 0);
      expect(solid).toBeLessThan(SKY_HEIGHT_M - CRAFT_HALF_H_M * 2);
      for (const span of o.spans) {
        expect(span.hi).toBeGreaterThan(span.lo);
        expect(span.lo).toBeGreaterThanOrEqual(0);
        expect(span.hi).toBeLessThanOrEqual(SKY_HEIGHT_M + 0.001);
      }
    }
  });

  it('produces every kind eventually', () => {
    const rng = mulberry32(3);
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) kinds.add(makeObstacle(rng, 0, 24).kind);
    expect(kinds).toEqual(new Set(['spire', 'bunting', 'birds', 'balloon']));
  });
});

describe('hits — collision', () => {
  const solid = {
    kind: 'spire' as const, x: 100, halfW: 5,
    spans: [{ lo: 0, hi: 40 }], flourish: 0, passed: false,
  };

  it('misses when the machine is nowhere near horizontally', () => {
    expect(hits(solid, 0, 20)).toBe(false);
  });

  it('misses when the machine is above the solid span', () => {
    expect(hits(solid, 100, 60)).toBe(false);
  });

  it('hits when the machine is inside the solid span', () => {
    expect(hits(solid, 100, 20)).toBe(true);
  });

  it('hits on a clipped wingtip rather than only dead centre', () => {
    expect(hits(solid, 100 + 5 + 3, 20)).toBe(true);
  });

  it('counts the machine box, not a point, at the edge of a span', () => {
    expect(hits(solid, 100, 40 + CRAFT_HALF_H_M * 0.5)).toBe(true);
    expect(hits(solid, 100, 40 + CRAFT_HALF_H_M * 2)).toBe(false);
  });

  it('ends the run when the machine flies into something', () => {
    const s = createSession(DEFAULT_RIDER, 4);
    s.obstacles.push({
      kind: 'balloon', x: s.distance + 1, halfW: 6,
      spans: [{ lo: 0, hi: SKY_HEIGHT_M }], flourish: 0, passed: false,
    });
    s.nextObstacleX = Number.POSITIVE_INFINITY;
    setCadence(s, NEUTRAL_CADENCE_RPM);
    advance(s, DT, 150);
    expect(s.over).toBe(true);
    expect(s.crashed).toBe(true);
  });
});

describe('obstacle generation', () => {
  it('fills the sky ahead and forgets what is behind', () => {
    const s = createSession(DEFAULT_RIDER, 12);
    ensureObstacles(s);
    expect(s.obstacles.length).toBeGreaterThan(0);
    for (const o of s.obstacles) expect(o.x).toBeGreaterThan(s.distance);
  });

  it('counts obstacles as cleared once they are behind the machine', () => {
    const s = createSession(DEFAULT_RIDER, 12);
    // A flat, empty run: replace the landscape with a harmless marker.
    s.nextObstacleX = Number.POSITIVE_INFINITY;
    s.obstacles.push({
      kind: 'birds', x: 20, halfW: 2, spans: [{ lo: 0, hi: 0.001 }],
      flourish: 0, passed: false,
    });
    fly(s, 6, NEUTRAL_CADENCE_RPM, 200);
    expect(s.cleared).toBe(1);
  });
});

describe('cadence missing', () => {
  it('is not reported during the short grace period', () => {
    const s = emptySky();
    fly(s, CADENCE_TIMEOUT_S * 0.5, null);
    expect(s.cadence.missing).toBe(false);
  });

  it('holds the machine level through the grace period', () => {
    const s = emptySky();
    fly(s, 1, 80);
    fly(s, CADENCE_TIMEOUT_S * 0.5, null);
    expect(s.altitude).toBeCloseTo(START_ALTITUDE_M, 6);
  });

  it('does not start the run before the first reading arrives at all', () => {
    // A trainer with no cadence sensor must not be flown into a church during
    // the grace period, so nothing moves until it has been steered.
    const s = createSession(DEFAULT_RIDER, 3);
    fly(s, CADENCE_TIMEOUT_S * 0.5, null, 300);
    expect(s.distance).toBe(0);
    expect(s.obstacles).toHaveLength(0);
    expect(s.over).toBe(false);
  });

  it('is entered and reported once the timeout passes', () => {
    const s = emptySky();
    fly(s, CADENCE_TIMEOUT_S + 0.5, null);
    expect(s.cadence.missing).toBe(true);
  });

  it('holds the world still rather than killing the rider', () => {
    const s = emptySky();
    fly(s, 20, null, 250);
    expect(s.cadence.missing).toBe(true);
    expect(s.over).toBe(false);
    expect(s.speed).toBe(0);
    expect(s.altitude).toBeCloseTo(START_ALTITUDE_M, 6);
  });

  it('clears the moment a real reading arrives', () => {
    const s = emptySky();
    fly(s, CADENCE_TIMEOUT_S + 1, null);
    expect(s.cadence.missing).toBe(true);
    fly(s, 0.5, 95);
    expect(s.cadence.missing).toBe(false);
    expect(s.altitude).toBeGreaterThan(START_ALTITUDE_M);
  });

  it('treats an implausible reading as no reading at all', () => {
    const s = emptySky();
    fly(s, CADENCE_TIMEOUT_S + 0.5, 4000);
    expect(s.cadence.missing).toBe(true);
  });
});

describe('the end of a run', () => {
  it('is inert afterwards', () => {
    const s = createSession(DEFAULT_RIDER, 5);
    fly(s, 3, 100, 200);
    stopRun(s);
    const snapshot = { ...s };
    fly(s, 5, 110, 320);
    expect(s.distance).toBe(snapshot.distance);
    expect(s.altitude).toBe(snapshot.altitude);
    expect(s.elapsed).toBe(snapshot.elapsed);
    expect(s.cleared).toBe(snapshot.cleared);
  });

  it('marks a safety stop as stopped rather than crashed', () => {
    const s = createSession(DEFAULT_RIDER, 5);
    stopRun(s);
    expect(s.stopped).toBe(true);
    expect(s.crashed).toBe(false);
    expect(s.over).toBe(true);
  });

  it('summarises the run', () => {
    const s = emptySky();
    fly(s, 4, NEUTRAL_CADENCE_RPM, 200);
    const r = toRunSummary(s);
    expect(r.distanceM).toBeGreaterThan(0);
    expect(r.avgPower).toBeGreaterThan(150);
    expect(r.durationS).toBeCloseTo(4, 1);
  });
});

describe('determinism', () => {
  it('reproduces a run exactly from the same seed and inputs', () => {
    const inputs = Array.from({ length: 2400 }, (_, i) => ({
      rpm: 80 + Math.sin(i / 90) * 26,
      watts: 180 + Math.sin(i / 37) * 110,
    }));
    const run = (): SpinSession => {
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
    expect(a.altitude).toBe(b.altitude);
    expect(a.cleared).toBe(b.cleared);
    expect(a.over).toBe(b.over);
    expect(a.obstacles.map((o) => `${o.kind}:${o.x}`))
      .toEqual(b.obstacles.map((o) => `${o.kind}:${o.x}`));
  });

  it('gives different landscapes for different seeds', () => {
    const a = createSession(DEFAULT_RIDER, 1);
    const b = createSession(DEFAULT_RIDER, 2);
    ensureObstacles(a);
    ensureObstacles(b);
    expect(a.obstacles.map((o) => o.kind).join())
      .not.toBe(b.obstacles.map((o) => o.kind).join());
  });
});

describe('simulationFor', () => {
  it('asks for a flat road and thin air, so steering stays cheap', () => {
    const s = createSession(DEFAULT_RIDER, 1);
    expect(simulationFor(s)).toBe(LIGHT_SIMULATION);
    expect(LIGHT_SIMULATION.grade).toBe(0);
    expect(LIGHT_SIMULATION.cw).toBeLessThan(0.51);
  });
});
