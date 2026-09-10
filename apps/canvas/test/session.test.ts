import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { START_PAPERS } from '../src/world.js';
import {
  FIXED_DT, advance, advanceFixed, createSession, setPower,
  simulationFor, toRunResult,
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
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 250);
    const start = Date.now();
    advanceFixed(s, 600, still);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('throws only once even when a frame spans many substeps', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advanceFixed(s, 0.5, { steer: 0, throwPaper: true });
    expect(s.world.rider.papers).toBe(START_PAPERS - 1);
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
    const s = createSession(42, DEFAULT_RIDER);
    for (let i = 0; i < 200; i++) {
      s.world.rider.distance = i * 120;
      advance(s, still, 1 / 60);
      expect(Math.abs(simulationFor(s).grade)).toBeLessThanOrEqual(8);
    }
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
