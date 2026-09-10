import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { START_PAPERS } from '../src/world.js';
import {
  FIXED_DT, FLAT_SIMULATION, MAX_SUBSTEPS, advance, advanceFixed,
  createSession, effectiveSimulation, setPower, simulationFor, toRunResult,
} from '../src/session.js';

const still = { steer: 0, throwPaper: false };

describe('createSession', () => {
  it('starts stopped with no energy spent', () => {
    const s = createSession(42, DEFAULT_RIDER);
    expect(s.world.rider.speed).toBe(0);
    expect(s.kilojoules).toBe(0);
    expect(s.powerCurrent).toBe(0);
  });
});

describe('setPower', () => {
  it('records a target rather than snapping the current value', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 250);
    expect(s.powerTarget).toBe(250);
    expect(s.powerCurrent).toBe(0);
  });

  it('treats a null reading as zero rather than throwing', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, null);
    expect(s.powerTarget).toBe(0);
  });

  it('ignores an implausible reading', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 99_999);
    expect(s.powerTarget).toBeLessThanOrEqual(2000);
  });
});

describe('advance', () => {
  it('eases power toward the target instead of stepping to it', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 300);
    advance(s, still, 1 / 60);
    expect(s.powerCurrent).toBeGreaterThan(0);
    expect(s.powerCurrent).toBeLessThan(300);
  });

  it('converges on the target when it is held', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 300);
    for (let i = 0; i < 300; i++) advance(s, still, 1 / 60);
    expect(s.powerCurrent).toBeCloseTo(300, 0);
  });

  it('accumulates energy as power times time', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 200);
    for (let i = 0; i < 600; i++) advance(s, still, 1 / 60);
    // Roughly 200 W for 10 s, minus the easing ramp: about 2 kJ.
    expect(s.kilojoules).toBeGreaterThan(1.5);
    expect(s.kilojoules).toBeLessThan(2.1);
  });

  it('does nothing at all while paused', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 300);
    s.paused = true;
    advance(s, still, 1);
    expect(s.world.rider.distance).toBe(0);
    expect(s.kilojoules).toBe(0);
  });

  it('spends exactly one paper for one throw input', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, { steer: 0, throwPaper: true }, 1 / 60);
    expect(s.world.rider.papers).toBe(START_PAPERS - 1);
  });
});

describe('advanceFixed', () => {
  it('divides a long frame into fixed substeps', () => {
    const a = createSession(42, DEFAULT_RIDER);
    const b = createSession(42, DEFAULT_RIDER);
    setPower(a, 250);
    setPower(b, 250);

    // 0.2 s is 24 substeps — inside MAX_SUBSTEPS, so nothing is clamped away.
    advanceFixed(a, 0.2, still);
    for (let i = 0; i < 24; i++) advance(b, still, FIXED_DT);

    expect(a.world.rider.distance).toBeCloseTo(b.world.rider.distance, 3);
  });

  it('caps substeps so a stalled tab cannot freeze the loop', () => {
    // A wall-clock assertion here cannot fail: even with the cap removed,
    // 600 s worth of substeps still runs to completion in a handful of
    // milliseconds, well under any reasonable timeout. The property that
    // actually matters is how much SIMULATED time advanced: a genuine
    // stall must be capped to MAX_SUBSTEPS worth of game time, not replayed
    // in full.
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 250);
    advanceFixed(s, 600, still);
    expect(s.world.elapsed).toBeCloseTo(MAX_SUBSTEPS * FIXED_DT, 9);
  });

  it('throws only once even when a frame spans many substeps', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advanceFixed(s, 0.5, { steer: 0, throwPaper: true });
    expect(s.world.rider.papers).toBe(START_PAPERS - 1);
  });

  it('carries a pending throw across frames that run zero substeps', () => {
    // At a high refresh rate a single frame can be shorter than FIXED_DT
    // and run zero substeps. The throw pressed on such a frame must not be
    // lost — it should be spent by the first substep that does run.
    const s = createSession(42, DEFAULT_RIDER);
    advanceFixed(s, 0.001, { steer: 0, throwPaper: true });
    expect(s.world.rider.papers).toBe(START_PAPERS);

    for (let i = 0; i < 20; i++) advanceFixed(s, 0.001, still);
    expect(s.world.rider.papers).toBe(START_PAPERS - 1);
  });

  it('never runs zero substeps forever at a high refresh rate', () => {
    // Regression for the 144Hz freeze: dt ~ 6.94ms is smaller than
    // FIXED_DT ~ 8.33ms, so Math.floor(dt / FIXED_DT) is 0 on every single
    // frame without a carried accumulator.
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 250);
    const highRefreshDt = 1 / 144;
    for (let i = 0; i < 1000; i++) advanceFixed(s, highRefreshDt, still);
    expect(s.world.elapsed).toBeGreaterThan(1000 * highRefreshDt * 0.9);
  });
});

describe('simulationFor', () => {
  it('reports the grade of the block the rider is on', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    const sim = simulationFor(s);
    expect(sim.grade).toBe(s.world.blocks[0]!.gradePercent);
  });

  it('reports a higher rolling resistance on the lawn', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    s.world.rider.lateral = 3.8;
    const road = simulationFor(s).crr;
    s.world.rider.lateral = 2.2;
    expect(simulationFor(s).crr).toBeGreaterThan(road);
  });

  it('never asks for a grade beyond the trainer clamp', () => {
    // The generated route tops out at ~6% grade, so walking it never
    // approaches the +/-8 clamp and would pass even if simulationFor did
    // not call clampGrade at all. Force the boundary directly instead.
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    const block = s.world.blocks[0]!;

    block.gradePercent = 99;
    expect(simulationFor(s).grade).toBe(8);

    block.gradePercent = -99;
    expect(simulationFor(s).grade).toBe(-8);

    block.gradePercent = Number.NaN;
    expect(simulationFor(s).grade).toBe(0);
  });
});

describe('effectiveSimulation', () => {
  it('passes through the track simulation while riding normally', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    expect(effectiveSimulation(s)).toEqual(simulationFor(s));
  });

  it('flattens resistance to zero grade while paused, so a panic or pause press relaxes the trainer', () => {
    // The panic key (Escape) and the pause key both work by setting
    // s.paused = true; this is the property that makes both of them
    // actually zero out resistance, since main.ts's frame loop makes
    // exactly one setSimulation call per frame using this function's
    // result, and a coalescing ControlPointWriter only ever flushes the
    // last value set.
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    s.paused = true;
    expect(effectiveSimulation(s)).toEqual(FLAT_SIMULATION);
    expect(effectiveSimulation(s).grade).toBe(0);
  });

  it('flattens resistance to zero grade once the run is over', () => {
    // Regression: previously the frame that flips gameOver still sent the
    // ordinary (possibly steep) grade before the game-over check ran, and
    // nothing ever touched the trainer again afterwards because endRun
    // nulls the session.
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    s.world.blocks[0]!.gradePercent = 6;
    s.world.gameOver = true;
    expect(effectiveSimulation(s)).toEqual(FLAT_SIMULATION);
    expect(effectiveSimulation(s).grade).toBe(0);
  });
});

describe('toRunResult', () => {
  it('summarises the ride', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 200);
    for (let i = 0; i < 1200; i++) advance(s, still, 1 / 60);
    const r = toRunResult(s);
    expect(r.seed).toBe(42);
    expect(r.distanceM).toBeGreaterThan(0);
    expect(r.durationMs).toBeGreaterThan(0);
    expect(r.avgPower).toBeGreaterThan(100);
    expect(r.kilojoules).toBeGreaterThan(0);
  });

  it('reports zero average power for a zero-length ride', () => {
    expect(toRunResult(createSession(42, DEFAULT_RIDER)).avgPower).toBe(0);
  });
});

describe('smoke run', () => {
  it('plays a full run to game over without breaking', () => {
    const s = createSession(1337, DEFAULT_RIDER);
    setPower(s, 240);
    for (let i = 0; i < 60 * 60 * 10; i++) {
      advance(s, { steer: Math.sin(i / 90) > 0 ? -1 : 1, throwPaper: i % 45 === 0 }, 1 / 60);
      if (s.world.gameOver) break;
      expect(Number.isFinite(s.world.rider.distance)).toBe(true);
      expect(s.world.rider.papers).toBeGreaterThanOrEqual(0);
    }
    expect(s.world.rider.distance).toBeGreaterThan(100);
  });
});
