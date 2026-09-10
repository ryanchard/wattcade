import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { BLOCK_LENGTH_M, RIDABLE_MAX, RIDABLE_MIN } from '@paperboy/game-core';
import {
  START_LIVES, START_PAPERS, STREAM_AHEAD_M,
  advanceRider, createWorld, ensureBlocks, gradeAt, moveHazards,
  steer, surfaceCrr,
} from '../src/world.js';

describe('createWorld', () => {
  it('starts with full papers, full lives and a stopped rider', () => {
    const w = createWorld(42);
    expect(w.rider.papers).toBe(START_PAPERS);
    expect(w.rider.lives).toBe(START_LIVES);
    expect(w.rider.speed).toBe(0);
    expect(w.gameOver).toBe(false);
  });

  it('places the rider on the sidewalk', () => {
    const w = createWorld(42);
    expect(w.rider.lateral).toBeGreaterThanOrEqual(3.0);
    expect(w.rider.lateral).toBeLessThanOrEqual(4.5);
  });

  it('is reproducible from its seed', () => {
    const a = createWorld(42);
    ensureBlocks(a);
    const b = createWorld(42);
    ensureBlocks(b);
    // Compare full house specs, not just ids: house ids are positional
    // (`h-${index}-${i}`) and would match across any two seeds regardless
    // of determinism. subscriber/mailboxLateral/porchLateral/windowLateral
    // are the fields actually drawn from the seeded RNG.
    expect(a.houses).toEqual(b.houses);
  });

  it('produces different houses for a different seed', () => {
    const a = createWorld(42);
    ensureBlocks(a);
    const c = createWorld(43);
    ensureBlocks(c);
    expect(a.houses).not.toEqual(c.houses);
  });
});

describe('ensureBlocks', () => {
  it('streams enough road ahead of the rider', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    const last = w.blocks.at(-1)!;
    expect(last.startDistance + last.length)
      .toBeGreaterThanOrEqual(w.rider.distance + STREAM_AHEAD_M);
  });

  it('keeps streaming as the rider advances', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    w.rider.distance = BLOCK_LENGTH_M * 10;
    ensureBlocks(w);
    const last = w.blocks.at(-1)!;
    expect(last.startDistance + last.length)
      .toBeGreaterThanOrEqual(w.rider.distance + STREAM_AHEAD_M);
  });

  it('prunes entities left far behind so memory stays flat', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    w.rider.distance = BLOCK_LENGTH_M * 40;
    ensureBlocks(w);
    for (const h of w.houses) {
      expect(h.spec.distance).toBeGreaterThan(w.rider.distance - 500);
    }
    expect(w.houses.length).toBeLessThan(120);
  });

  it('never regenerates a block that already exists', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    const idsBefore = w.houses.map((h) => h.spec.id);
    ensureBlocks(w);
    expect(w.houses.map((h) => h.spec.id)).toEqual(idsBefore);
  });
});

describe('steer', () => {
  it('moves the rider toward the houses on a negative direction', () => {
    const w = createWorld(42);
    const before = w.rider.lateral;
    steer(w, -1, 0.5);
    expect(w.rider.lateral).toBeLessThan(before);
  });

  it('clamps the rider inside the ridable band', () => {
    const w = createWorld(42);
    for (let i = 0; i < 100; i++) steer(w, -1, 0.1);
    expect(w.rider.lateral).toBeGreaterThanOrEqual(RIDABLE_MIN);
    for (let i = 0; i < 200; i++) steer(w, 1, 0.1);
    expect(w.rider.lateral).toBeLessThanOrEqual(RIDABLE_MAX);
  });
});

describe('surfaceCrr', () => {
  it('is fast on the sidewalk and on the road', () => {
    expect(surfaceCrr(3.8)).toBeLessThan(0.01);
    expect(surfaceCrr(7.0)).toBeLessThan(0.01);
  });

  it('is slow on the lawn', () => {
    expect(surfaceCrr(2.2)).toBeGreaterThan(0.015);
  });

  it('is slow on the curb', () => {
    expect(surfaceCrr(5.0)).toBeGreaterThan(0.01);
  });
});

describe('gradeAt', () => {
  it('returns the grade of the block the rider is in', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    expect(gradeAt(w, 10)).toBe(w.blocks[0]!.gradePercent);
    expect(gradeAt(w, BLOCK_LENGTH_M + 10)).toBe(w.blocks[1]!.gradePercent);
  });

  it('returns zero beyond the generated road', () => {
    const w = createWorld(42);
    expect(gradeAt(w, 9_999_999)).toBe(0);
  });
});

describe('advanceRider', () => {
  it('accelerates the rider when power is applied', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    for (let i = 0; i < 120; i++) advanceRider(w, 250, DEFAULT_RIDER, 1 / 60);
    expect(w.rider.speed).toBeGreaterThan(2);
    expect(w.rider.distance).toBeGreaterThan(0);
  });

  it('slows the rider on the lawn compared with the sidewalk', () => {
    const road = createWorld(42);
    ensureBlocks(road);
    road.rider.lateral = 3.8;
    const lawn = createWorld(42);
    ensureBlocks(lawn);
    lawn.rider.lateral = 2.2;
    for (let i = 0; i < 600; i++) {
      advanceRider(road, 200, DEFAULT_RIDER, 1 / 60);
      advanceRider(lawn, 200, DEFAULT_RIDER, 1 / 60);
    }
    expect(lawn.rider.speed).toBeLessThan(road.rider.speed);
  });

  it('advances elapsed time', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    advanceRider(w, 100, DEFAULT_RIDER, 0.5);
    expect(w.elapsed).toBeCloseTo(0.5, 6);
  });
});

describe('moveHazards', () => {
  // NOTE: the weave branch is a function of absolute w.elapsed, which only
  // advanceRider mutates. Every test below that needs real elapsed time to
  // pass calls advanceRider alongside moveHazards each iteration, exactly
  // as the real game loop must. A test that calls moveHazards alone with
  // w.elapsed pinned at 0 cannot observe genuine motion in the weave
  // branch — see the dedicated regression test below for why that matters.

  it('moves hazards marked as moving and leaves static ones alone', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    const moving = w.hazards.find((h) => h.spec.moving);
    const still = w.hazards.find((h) => !h.spec.moving);
    const movingBefore = moving ? { ...moving } : null;
    const stillBefore = still ? { ...still } : null;

    for (let i = 0; i < 60; i++) {
      advanceRider(w, 150, DEFAULT_RIDER, 1 / 60);
      moveHazards(w, 1 / 60);
    }

    if (movingBefore && moving) {
      const moved =
        Math.abs(moving.distance - movingBefore.distance) > 0.01 ||
        Math.abs(moving.lateral - movingBefore.lateral) > 0.01;
      expect(moved).toBe(true);
    }
    if (stillBefore && still) {
      expect(still.distance).toBeCloseTo(stillBefore.distance, 6);
      expect(still.lateral).toBeCloseTo(stillBefore.lateral, 6);
    }
  });

  it('genuinely oscillates a non-car moving hazard over time, rather than jumping once and freezing', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    // Pick a non-car moving hazard explicitly: taking "whichever is first"
    // moving hazard could silently pick a car (whose motion is a plain
    // distance integration, not a weave) if the seed or templates change,
    // and a car passing this test would prove nothing about the weave path.
    const hazard = w.hazards.find((h) => h.spec.kind !== 'car' && h.spec.moving);
    expect(hazard).toBeDefined();

    const laterals = new Set<number>();
    for (let i = 0; i < 300; i++) {
      advanceRider(w, 150, DEFAULT_RIDER, 1 / 60);
      moveHazards(w, 1 / 60);
      laterals.add(Number(hazard!.lateral.toFixed(3)));
    }
    // A hazard that only jumps once off its spawn point and then freezes
    // (the historical bug: absolute assignment with elapsed pinned at 0)
    // would produce exactly one distinct value here. Genuine periodic
    // motion produces many.
    expect(laterals.size).toBeGreaterThan(5);
  });

  it('keeps woven hazards clear of the house footprint and the far verge', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    for (let i = 0; i < 3000; i++) {
      advanceRider(w, 150, DEFAULT_RIDER, 1 / 60);
      moveHazards(w, 1 / 60);
      for (const h of w.hazards) {
        if (h.spec.moving && h.spec.kind !== 'car') {
          expect(h.lateral).toBeGreaterThanOrEqual(1.5);
          expect(h.lateral).toBeLessThanOrEqual(RIDABLE_MAX);
        }
      }
    }
  });

  it('keeps cars on the road', () => {
    const w = createWorld(7);
    ensureBlocks(w);
    for (let i = 0; i < 600; i++) moveHazards(w, 1 / 60);
    for (const h of w.hazards) {
      if (h.spec.kind === 'car') expect(h.lateral).toBeGreaterThanOrEqual(5.5);
    }
  });
});
