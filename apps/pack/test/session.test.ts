import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import {
  DOG_ATTACH_INITIAL_INTERVAL_S, FIXED_DT, FLAT_SIMULATION, MAX_SUBSTEPS,
  SHAKE_HOLD_DURATION_S, advance, advanceFixed, createSession,
  effectiveSimulation, setPower, shakeThreshold, simulationFor, stepGap,
  stopRun, toRunResult,
} from '../src/session.js';

describe('createSession', () => {
  it('starts stopped, unclaimed, and with a healthy gap', () => {
    const s = createSession(DEFAULT_RIDER);
    expect(s.speed).toBe(0);
    expect(s.dogs).toBe(0);
    expect(s.dogsShaken).toBe(0);
    expect(s.caught).toBe(false);
    expect(s.gap).toBeGreaterThan(0);
  });
});

describe('setPower', () => {
  it('records a target rather than snapping the current value', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 250);
    expect(s.powerTarget).toBe(250);
    expect(s.powerCurrent).toBe(0);
  });

  it('treats a null reading as zero rather than throwing', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, null);
    expect(s.powerTarget).toBe(0);
  });

  it('ignores an implausible reading', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 99_999);
    expect(s.powerTarget).toBeLessThanOrEqual(2000);
  });
});

describe('stepGap', () => {
  it('grows when the rider is faster than the pack', () => {
    expect(stepGap(10, 8, 5, 1)).toBeCloseTo(13, 9);
  });

  it('shrinks when the rider is slower than the pack', () => {
    expect(stepGap(10, 3, 5, 1)).toBeCloseTo(8, 9);
  });

  it('holds steady when speeds match', () => {
    expect(stepGap(10, 5, 5, 2)).toBeCloseTo(10, 9);
  });
});

describe('advance — gap dynamics', () => {
  it('grows the gap over time when the rider holds strong power', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 320);
    const startGap = s.gap;
    for (let i = 0; i < 600; i++) advance(s, 1 / 60);
    expect(s.gap).toBeGreaterThan(startGap);
  });

  it('shrinks the gap and eventually catches a rider producing no power', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 0);
    for (let i = 0; i < 6000 && !s.caught; i++) advance(s, 1 / 60);
    expect(s.caught).toBe(true);
    expect(s.gap).toBe(0);
  });
});

describe('advance — dog attachment', () => {
  it('attaches the first dog only once the initial interval has elapsed', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 200);
    const dt = 1 / 60;
    const stepsJustBefore = Math.floor((DOG_ATTACH_INITIAL_INTERVAL_S - 0.5) / dt);
    for (let i = 0; i < stepsJustBefore; i++) advance(s, dt);
    expect(s.dogs).toBe(0);

    const stepsToJustAfter = Math.ceil(1 / dt); // cover the remaining ~1s
    for (let i = 0; i < stepsToJustAfter; i++) advance(s, dt);
    expect(s.dogs).toBe(1);
  });

  it('schedules attaches on an accelerating cadence', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 200);
    const dt = 1 / 30;
    let lastDogs = 0;
    const attachTimes: number[] = [];
    for (let i = 0; i < 60 * 60 && attachTimes.length < 3; i++) {
      advance(s, dt);
      if (s.dogs > lastDogs) {
        attachTimes.push(s.elapsed);
        lastDogs = s.dogs;
      }
    }
    expect(attachTimes.length).toBe(3);
    const gap1 = attachTimes[1]! - attachTimes[0]!;
    const gap2 = attachTimes[2]! - attachTimes[1]!;
    expect(gap2).toBeLessThan(gap1);
  });
});

describe('advance — shaking a dog', () => {
  it('sustained power above threshold shakes exactly one dog', () => {
    const s = createSession(DEFAULT_RIDER);
    s.dogs = 1;
    setPower(s, 2000); // full gas — converges well above the shake threshold
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 30 && s.dogs === 1; i++) advance(s, dt);
    expect(s.dogs).toBe(0);
    expect(s.dogsShaken).toBe(1);
  });

  it('breaking the effort resets shake progress instead of merely pausing it', () => {
    const s = createSession(DEFAULT_RIDER);
    s.dogs = 1;
    setPower(s, 2000);
    const dt = 1 / 60;
    // Ramp up and hold long enough to bank real progress, but not enough to
    // shake the dog yet.
    for (let i = 0; i < 60 * 2; i++) advance(s, dt);
    expect(s.shakeHoldS).toBeGreaterThan(0);
    expect(s.dogs).toBe(1);

    // Simulate the power reading itself dropping below threshold (rather
    // than easing down to it over several frames) so this test isolates the
    // reset rule from the easing behaviour covered elsewhere.
    s.powerCurrent = 0;
    s.powerTarget = 0;
    advance(s, dt);
    expect(s.shakeHoldS).toBe(0);
    expect(s.dogs).toBe(1);
  });

  it('does nothing when no dog is attached', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 2000);
    for (let i = 0; i < 60 * 5; i++) advance(s, 1 / 60);
    expect(s.dogs).toBe(0);
    expect(s.dogsShaken).toBe(0);
  });

  it('threshold scales with FTP', () => {
    const weak = { ...DEFAULT_RIDER, ftpWatts: 100 };
    const strong = { ...DEFAULT_RIDER, ftpWatts: 300 };
    expect(shakeThreshold(strong)).toBeGreaterThan(shakeThreshold(weak));
  });
});

describe('drag scales with dogs', () => {
  it('sends a steeper grade and higher rolling resistance with more dogs', () => {
    const s0 = createSession(DEFAULT_RIDER);
    const s2 = createSession(DEFAULT_RIDER);
    s2.dogs = 2;
    const sim0 = simulationFor(s0);
    const sim2 = simulationFor(s2);
    expect(sim2.grade).toBeGreaterThan(sim0.grade);
    expect(sim2.crr).toBeGreaterThan(sim0.crr);
  });

  it('a rider producing identical power covers less ground with more dogs attached', () => {
    const light = createSession(DEFAULT_RIDER);
    const heavy = createSession(DEFAULT_RIDER);
    heavy.dogs = 3;
    setPower(light, 220);
    setPower(heavy, 220);
    for (let i = 0; i < 60 * 30; i++) {
      advance(light, 1 / 60);
      advance(heavy, 1 / 60);
    }
    expect(heavy.distance).toBeLessThan(light.distance);
  });

  it('never asks the trainer for a grade beyond the clamp, however many dogs pile on', () => {
    const s = createSession(DEFAULT_RIDER);
    s.dogs = 50;
    expect(simulationFor(s).grade).toBe(8);
  });
});

describe('run over behaviour', () => {
  it('ends the run when the gap reaches zero and is inert afterward', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 0);
    for (let i = 0; i < 6000 && !s.caught; i++) advance(s, 1 / 60);
    expect(s.caught).toBe(true);

    const distanceAtCatch = s.distance;
    const elapsedAtCatch = s.elapsed;
    setPower(s, 400);
    for (let i = 0; i < 120; i++) advance(s, 1 / 60);
    expect(s.distance).toBe(distanceAtCatch);
    expect(s.elapsed).toBe(elapsedAtCatch);
  });

  it('stopRun ends the run immediately as a safety stop', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 300);
    for (let i = 0; i < 60; i++) advance(s, 1 / 60);
    stopRun(s);
    expect(s.caught).toBe(true);
    expect(s.paused).toBe(true);

    const distance = s.distance;
    advance(s, 1 / 60);
    expect(s.distance).toBe(distance);
  });
});

describe('advanceFixed', () => {
  it('divides a long frame into fixed substeps identically to manual stepping', () => {
    const a = createSession(DEFAULT_RIDER);
    const b = createSession(DEFAULT_RIDER);
    setPower(a, 250);
    setPower(b, 250);

    advanceFixed(a, 0.2);
    for (let i = 0; i < 24; i++) advance(b, FIXED_DT);

    expect(a.distance).toBeCloseTo(b.distance, 3);
  });

  it('caps substeps so a stalled tab cannot freeze the loop', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 250);
    advanceFixed(s, 600);
    expect(s.elapsed).toBeCloseTo(MAX_SUBSTEPS * FIXED_DT, 9);
  });

  it('never runs zero substeps forever at a high refresh rate', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 250);
    const highRefreshDt = 1 / 144;
    for (let i = 0; i < 1000; i++) advanceFixed(s, highRefreshDt);
    expect(s.elapsed).toBeGreaterThan(1000 * highRefreshDt * 0.9);
  });
});

describe('effectiveSimulation', () => {
  it('passes through the live simulation while riding normally', () => {
    const s = createSession(DEFAULT_RIDER);
    advance(s, 1 / 60);
    expect(effectiveSimulation(s)).toEqual(simulationFor(s));
  });

  it('flattens resistance to zero grade while paused', () => {
    const s = createSession(DEFAULT_RIDER);
    advance(s, 1 / 60);
    s.paused = true;
    expect(effectiveSimulation(s)).toEqual(FLAT_SIMULATION);
  });

  it('flattens resistance to zero grade once caught', () => {
    const s = createSession(DEFAULT_RIDER);
    s.dogs = 4;
    s.caught = true;
    expect(effectiveSimulation(s)).toEqual(FLAT_SIMULATION);
  });
});

describe('toRunResult', () => {
  it('summarises the ride', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 200);
    for (let i = 0; i < 1200; i++) advance(s, 1 / 60);
    const r = toRunResult(s);
    expect(r.distanceM).toBeGreaterThan(0);
    expect(r.durationMs).toBeGreaterThan(0);
    expect(r.avgPower).toBeGreaterThan(100);
  });

  it('reports zero average power for a zero-length ride', () => {
    expect(toRunResult(createSession(DEFAULT_RIDER)).avgPower).toBe(0);
  });
});

describe('smoke run', () => {
  it('plays a full run to being caught without breaking', () => {
    const s = createSession(DEFAULT_RIDER);
    setPower(s, 230);
    for (let i = 0; i < 60 * 60 * 20 && !s.caught; i++) {
      // Oscillate power so shaking sometimes succeeds, sometimes fails.
      setPower(s, Math.sin(i / 400) > 0 ? 400 : 150);
      advance(s, 1 / 60);
      expect(Number.isFinite(s.distance)).toBe(true);
      expect(s.dogs).toBeGreaterThanOrEqual(0);
    }
    expect(s.caught).toBe(true);
    expect(s.distance).toBeGreaterThan(50);
  });
});
