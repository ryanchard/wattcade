import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER, stepPhysics } from '@paperboy/trainer';
import {
  BLOCK_LENGTH_M, RIDABLE_MAX, RIDABLE_MIN, generateBlock,
} from '@paperboy/game-core';
import { surfaceCrr } from '../src/logic/entities.js';
import {
  FLAT_SIMULATION, MAX_PAPERS, PaperboyRun, STACK_PAPERS, START_LIVES,
  START_PAPERS,
} from '../src/logic/run.js';

const still = { steer: 0, throwPaper: false };
const make = (seed = 42) => new PaperboyRun(seed, DEFAULT_RIDER);

describe('PaperboyRun setup', () => {
  it('starts stopped with a full bundle and full lives', () => {
    const r = make();
    expect(r.rider.papers).toBe(START_PAPERS);
    expect(r.rider.lives).toBe(START_LIVES);
    expect(r.rider.speed).toBe(0);
  });

  it('streams the first blocks on its first update', () => {
    const r = make();
    expect(r.update(1 / 60, still).stream.added.length).toBeGreaterThan(0);
  });

  it('registers streamed houses as runtime state', () => {
    const r = make();
    r.update(1 / 60, still);
    expect(r.houses.size).toBeGreaterThan(0);
  });
});

describe('riding', () => {
  it('accelerates under power', () => {
    const r = make();
    r.setPower(250);
    for (let i = 0; i < 300; i++) r.update(1 / 60, still);
    expect(r.rider.speed).toBeGreaterThan(3);
  });

  it('eases power rather than stepping to it', () => {
    const r = make();
    r.setPower(300);
    r.update(1 / 60, still);
    expect(r.powerCurrent).toBeLessThan(300);
    expect(r.powerCurrent).toBeGreaterThan(0);
  });

  it('clamps steering to the ridable band', () => {
    const r = make();
    for (let i = 0; i < 200; i++) r.update(1 / 60, { steer: -1, throwPaper: false });
    expect(r.rider.lateral).toBeGreaterThanOrEqual(RIDABLE_MIN);
    for (let i = 0; i < 400; i++) r.update(1 / 60, { steer: 1, throwPaper: false });
    expect(r.rider.lateral).toBeLessThanOrEqual(RIDABLE_MAX);
  });

  it('does nothing while paused', () => {
    const r = make();
    r.setPower(300);
    r.paused = true;
    r.update(1, still);
    expect(r.rider.distance).toBe(0);
  });

  it('feeds physics block 0\'s real grade on the very first update, not a flat fallback', () => {
    // Regression: stepPhysics must read a grade that reflects block 0,
    // which requires the streamer to have generated it before physics
    // runs. If the streamer instead ran after physics (as it briefly did),
    // this very first update would compute gradeAt(0) against an empty
    // block list, silently falling back to 0% for one frame -- a real
    // divergence from Version A, which streams before it moves the rider.
    const seed = 42;
    const grade0 = generateBlock(seed, 0).gradePercent;
    // Sanity: seed 42's block 0 is a genuine, non-flat grade, so a 0%
    // fallback is actually distinguishable from the real value.
    expect(grade0).not.toBe(0);

    const r = new PaperboyRun(seed, DEFAULT_RIDER);
    r.setPower(300);
    r.update(1 / 60, still);

    const expected = stepPhysics(
      { speed: 0, distance: 0 },
      {
        powerWatts: r.powerCurrent,
        gradePercent: grade0,
        crr: surfaceCrr(r.rider.lateral),
        headwind: 0,
      },
      DEFAULT_RIDER,
      1 / 60,
    );

    expect(r.rider.distance).toBe(expected.distance);
    expect(r.rider.speed).toBe(expected.speed);
  });
});

describe('throwing', () => {
  it('spends a paper and launches it toward the houses', () => {
    const r = make();
    r.update(1 / 60, still);
    expect(r.throwPaper()).toBe(true);
    expect(r.rider.papers).toBe(START_PAPERS - 1);
    expect(r.papers[0]!.vLateral).toBeLessThan(0);
  });

  it('refuses to throw an empty bundle', () => {
    const r = make();
    r.rider.papers = 0;
    expect(r.throwPaper()).toBe(false);
  });

  it('scores a mailbox delivery using the shared rule', () => {
    const r = make();
    r.update(1 / 60, still);
    const house = [...r.houses.values()].find((h) => h.spec.subscriber)!;
    r.rider.distance = house.spec.distance;
    r.throwPaper();
    const p = r.papers[0]!;
    p.distance = house.spec.distance;
    p.lateral = house.spec.mailboxLateral;
    p.height = 0.01;
    p.vHeight = -5;
    p.vLateral = 0;
    p.vDistance = 0;

    const { events } = r.update(1 / 30, still);
    expect(events).toContainEqual({ type: 'mailbox' });
    expect(house.delivered).toBe(true);
  });

  it('scores nothing delivering to a mailbox after smashing that house\'s window', () => {
    const r = make();
    r.update(1 / 60, still);
    const house = [...r.houses.values()].find((h) => h.spec.subscriber)!;

    // First throw: smash the window.
    r.rider.distance = house.spec.distance;
    r.throwPaper();
    let p = r.papers[0]!;
    p.distance = house.spec.distance;
    p.lateral = house.spec.windowLateral;
    p.height = 0.01;
    p.vHeight = -5;
    p.vLateral = 0;
    p.vDistance = 0;
    const first = r.update(1 / 30, still);
    expect(first.events).toContainEqual({ type: 'windowSubscriber' });
    expect(house.resolved).toBe(true);

    // Second throw at the same house: a mailbox hit that must NOT score,
    // since the house was already cancelled by the broken window.
    r.throwPaper();
    p = r.papers[0]!;
    p.distance = house.spec.distance;
    p.lateral = house.spec.mailboxLateral;
    p.height = 0.01;
    p.vHeight = -5;
    p.vLateral = 0;
    p.vDistance = 0;
    const second = r.update(1 / 30, still);
    expect(second.events).toEqual([]);
    expect(house.delivered).toBe(false);
  });

  it('collects an untaken stack once, increasing papers, and cannot be collected twice', () => {
    // Regression: the test this replaces set papers to MAX_PAPERS - 1 and
    // asserted papers <= MAX_PAPERS, which holds whether or not the stack
    // was ever actually collected (29 <= 30 either way) -- and it was
    // Version B's only stack test. This one pins the real behaviour:
    // papers genuinely increase, the runtime stack is marked taken, and a
    // second pass over the same spot does not pay out again.
    const r = make();
    r.update(1 / 60, still);
    // Block 0 always spawns a stack (route.ts: `index === 0 || rng() < 0.55`).
    const stackSpec = r.streamer.blocks[0]!.stacks[0]!;
    expect(stackSpec).toBeDefined();

    r.rider.papers = START_PAPERS - 5;
    r.rider.distance = stackSpec.distance;
    r.rider.lateral = stackSpec.lateral;
    r.update(1 / 60, still);

    expect(r.rider.papers).toBe(START_PAPERS - 5 + STACK_PAPERS);
    expect(r.stacks.get(stackSpec.id)!.taken).toBe(true);

    const afterFirst = r.rider.papers;
    r.rider.distance = stackSpec.distance;
    r.rider.lateral = stackSpec.lateral;
    r.update(1 / 60, still);
    expect(r.rider.papers).toBe(afterFirst);
  });

  it('never exceeds the paper cap when collecting a stack', () => {
    const r = make();
    r.update(1 / 60, still);
    const stackSpec = r.streamer.blocks[0]!.stacks[0]!;
    r.rider.papers = MAX_PAPERS - 1;
    r.rider.distance = stackSpec.distance;
    r.rider.lateral = stackSpec.lateral;
    r.update(1 / 60, still);
    expect(r.rider.papers).toBe(MAX_PAPERS);
  });
});

describe('crashing', () => {
  it('is driven from outside, since Arcade owns collision', () => {
    const r = make();
    r.rider.speed = 10;
    r.crash();
    expect(r.rider.lives).toBe(START_LIVES - 1);
    expect(r.rider.speed).toBeLessThan(2);
    expect(r.invulnerable).toBe(true);
  });

  it('breaks the combo', () => {
    const r = make();
    r.score = { ...r.score, multiplier: 5, streak: 4 };
    r.crash();
    expect(r.score.multiplier).toBe(1);
  });

  it('ignores a crash while invulnerable', () => {
    const r = make();
    r.crash();
    r.crash();
    expect(r.rider.lives).toBe(START_LIVES - 1);
  });

  it('costs no life for a paused run with a rider parked on a hazard', () => {
    // The real collision check (StreetScene#checkCollisions) needs a live
    // Phaser Scene and can't run headlessly here (see
    // apps/phaser/test/hazardActive.test.ts), and StreetScene#update
    // already skips calling #checkCollisions at all while paused — so an
    // oncoming car can no longer even reach this method while the rider is
    // panic-stopped. This pins the defence-in-depth layer directly: even
    // if some future caller invoked crash() on a paused run (a rider
    // sitting motionless on top of a still-active hazard, say), it must
    // still cost no life.
    const r = make();
    r.paused = true;
    r.crash();
    expect(r.rider.lives).toBe(START_LIVES);
    expect(r.gameOver).toBe(false);
  });

  it('ends the run when the last life goes', () => {
    const r = make();
    for (let i = 0; i < START_LIVES; i++) {
      r.rider.invulnerableUntil = 0;
      r.crash();
    }
    expect(r.gameOver).toBe(true);
  });
});

describe('progression', () => {
  it('emits a miss for a subscriber ridden past undelivered', () => {
    const r = make();
    r.update(1 / 60, still);
    const house = [...r.houses.values()].find((h) => h.spec.subscriber)!;
    r.rider.distance = house.spec.distance + 20;
    const { events } = r.update(1 / 60, still);
    expect(events).toContainEqual({ type: 'houseMissed' });
  });

  it('awards a block bonus when every subscriber on it was served', () => {
    const r = make();
    r.update(1 / 60, still);
    for (const h of r.houses.values()) h.delivered = true;
    r.rider.distance = BLOCK_LENGTH_M + 1;
    const { events } = r.update(1 / 60, still);
    expect(events).toContainEqual({ type: 'blockCleared' });
  });
});

describe('trainer feedback', () => {
  it('reports the grade of the current block within the trainer clamp', () => {
    const r = make();
    r.update(1 / 60, still);
    const sim = r.simulation();
    expect(sim.grade).toBe(r.streamer.blocks[0]!.gradePercent);
    expect(Math.abs(sim.grade)).toBeLessThanOrEqual(8);
  });

  it('reports a higher rolling resistance on the lawn than the sidewalk', () => {
    const r = make();
    r.update(1 / 60, still);
    r.rider.lateral = 3.8;
    const road = r.simulation().crr;
    r.rider.lateral = 2.2;
    expect(r.simulation().crr).toBeGreaterThan(road);
  });

  it('never asks for a grade beyond the trainer clamp', () => {
    // The generated route tops out at ~6% grade, so walking it never
    // approaches the +/-8 clamp and would pass even if simulation() did
    // not call clampGrade at all (see run.test.ts's own note above the
    // previous test). Force the boundary directly instead, the same way
    // Version A's session.test.ts does.
    const r = make();
    r.update(1 / 60, still);
    const block = r.streamer.blocks[0]!;

    block.gradePercent = 99;
    expect(r.simulation().grade).toBe(8);

    block.gradePercent = -99;
    expect(r.simulation().grade).toBe(-8);

    block.gradePercent = Number.NaN;
    expect(r.simulation().grade).toBe(0);
  });
});

describe('effectiveSimulation', () => {
  // This is the entire panic-key mechanism for Version B: main.ts's 30 Hz
  // interval makes exactly one setSimulation call per tick using this
  // function's result, and ControlPointWriter only ever flushes the last
  // value set before it coalesces. Version A's session.test.ts pins the
  // identical three properties for effectiveSimulation/simulationFor; this
  // is that same coverage for Version B, which previously had none at all.

  it('passes through the track simulation while riding normally', () => {
    const r = make();
    r.update(1 / 60, still);
    expect(r.effectiveSimulation()).toEqual(r.simulation());
  });

  it('flattens resistance to zero grade while paused, so a panic or pause press relaxes the trainer', () => {
    const r = make();
    r.update(1 / 60, still);
    r.paused = true;
    expect(r.effectiveSimulation()).toEqual(FLAT_SIMULATION);
    expect(r.effectiveSimulation().grade).toBe(0);
  });

  it('flattens resistance to zero grade once the run is over', () => {
    // Regression: the frame that flips gameOver must not still send the
    // ordinary (possibly steep) grade before the game-over check runs, and
    // nothing else ever touches the trainer again afterwards once main.ts
    // nulls street.run.
    const r = make();
    r.update(1 / 60, still);
    r.streamer.blocks[0]!.gradePercent = 6;
    r.gameOver = true;
    expect(r.effectiveSimulation()).toEqual(FLAT_SIMULATION);
    expect(r.effectiveSimulation().grade).toBe(0);
  });
});

describe('result', () => {
  it('summarises the ride', () => {
    const r = make();
    r.setPower(210);
    for (let i = 0; i < 1200; i++) r.update(1 / 60, still);
    const out = r.result();
    expect(out.seed).toBe(42);
    expect(out.distanceM).toBeGreaterThan(0);
    expect(out.avgPower).toBeGreaterThan(100);
  });
});

describe('determinism', () => {
  it('replays identically for a fixed input sequence', () => {
    const play = () => {
      const r = make(7);
      r.setPower(220);
      for (let i = 0; i < 1800; i++) {
        r.update(1 / 60, {
          steer: i % 120 < 60 ? -1 : 1,
          throwPaper: i % 30 === 0,
        });
      }
      return { d: r.rider.distance, s: r.score.score };
    };
    expect(play()).toEqual(play());
  });

  it('generates the same street as Version A does for the same seed', () => {
    const r = make(42);
    r.update(1 / 60, still);
    // Both apps call generateBlock(seed, index) from the shared package,
    // so block 0's houses -- ids AND seed-dependent fields -- must match
    // the shared generator's output exactly, not merely share an id prefix
    // that every seed would produce.
    const expected = generateBlock(42, 0);
    expect(expected.houses.length).toBeGreaterThan(0);
    for (const spec of expected.houses) {
      const runtime = r.houses.get(spec.id);
      expect(runtime).toBeDefined();
      expect(runtime!.spec.subscriber).toBe(spec.subscriber);
      expect(runtime!.spec.mailboxLateral).toBe(spec.mailboxLateral);
      expect(runtime!.spec.porchLateral).toBe(spec.porchLateral);
    }
  });
});
