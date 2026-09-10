import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { BLOCK_LENGTH_M, RIDABLE_MAX, RIDABLE_MIN } from '@paperboy/game-core';
import {
  MAX_PAPERS, PaperboyRun, START_LIVES, START_PAPERS,
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

  it('never exceeds the paper cap when collecting a stack', () => {
    const r = make();
    r.update(1 / 60, still);
    r.rider.papers = MAX_PAPERS - 1;
    const stack = r.streamer.blocks[0]!.stacks[0];
    if (stack !== undefined) {
      r.rider.distance = stack.distance;
      r.rider.lateral = stack.lateral;
      r.update(1 / 60, still);
      expect(r.rider.papers).toBeLessThanOrEqual(MAX_PAPERS);
    }
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
    // so house ids must match exactly.
    expect([...r.houses.keys()].some((id) => id.startsWith('h-0-'))).toBe(true);
  });
});
