import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { BLOCK_LENGTH_M, classifyLanding } from '@paperboy/game-core';
import {
  MAX_PAPERS, START_PAPERS, createWorld, ensureBlocks,
} from '../src/world.js';
import type { HouseState, WorldState } from '../src/world.js';
import {
  applyCrash, collectStacks, detectCollision,
  resolveBlocks, resolvePassedHouses, stepWorld, throwPaper, updatePapers,
} from '../src/rules.js';

function house(over: Partial<HouseState['spec']> = {}): HouseState {
  return {
    spec: {
      id: 'h-test', distance: 100, subscriber: true,
      mailboxLateral: 3.1, porchLateral: 1.9, windowLateral: 0.9, ...over,
    },
    delivered: false, windowBroken: false, resolved: false,
  };
}

function ready(seed = 42): WorldState {
  const w = createWorld(seed);
  ensureBlocks(w);
  return w;
}

describe('throwPaper', () => {
  it('spends a paper and creates a projectile', () => {
    const w = ready();
    expect(throwPaper(w)).toBe(true);
    expect(w.rider.papers).toBe(START_PAPERS - 1);
    expect(w.papers).toHaveLength(1);
  });

  it('throws toward the houses', () => {
    const w = ready();
    throwPaper(w);
    expect(w.papers[0]!.vLateral).toBeLessThan(0);
  });

  it('refuses to throw with an empty bundle', () => {
    const w = ready();
    w.rider.papers = 0;
    expect(throwPaper(w)).toBe(false);
    expect(w.papers).toHaveLength(0);
  });
});

describe('classifyLanding through the shared rules', () => {
  const specs = [house().spec];

  it('recognises a mailbox hit', () => {
    const o = classifyLanding({ distance: 100, lateral: 3.1 }, specs);
    expect(o.band).toBe('mailbox');
    expect(o.house).toBe(specs[0]);
  });

  it('recognises a porch hit', () => {
    expect(classifyLanding({ distance: 100, lateral: 1.9 }, specs).band)
      .toBe('porch');
  });

  it('recognises a window hit', () => {
    expect(classifyLanding({ distance: 100, lateral: 0.9 }, specs).band)
      .toBe('window');
  });

  it('calls a near miss on the lawn', () => {
    expect(classifyLanding({ distance: 100, lateral: 2.7 }, specs).band)
      .toBe('lawn');
  });

  it('calls anything thrown into the road a street landing', () => {
    expect(classifyLanding({ distance: 100, lateral: 6.0 }, specs).band)
      .toBe('street');
  });

  it('finds no house when the landing is far along the street', () => {
    expect(classifyLanding({ distance: 300, lateral: 3.1 }, specs).house)
      .toBeNull();
  });

  it('picks the nearest house when two are close', () => {
    const two = [house({ id: 'a', distance: 100 }).spec,
                 house({ id: 'b', distance: 104 }).spec];
    expect(classifyLanding({ distance: 103.5, lateral: 3.1 }, two).house!.id)
      .toBe('b');
  });
});

describe('updatePapers', () => {
  function thrownAt(w: WorldState, h: HouseState, lateral: number): void {
    w.houses = [h];
    w.rider.distance = h.spec.distance;
    throwPaper(w);
    const p = w.papers[0]!;
    // Place the paper on its landing line directly, so the test is about
    // resolution rather than about ballistics.
    p.lateral = lateral;
    p.distance = h.spec.distance;
    p.height = 0.01;
    p.vHeight = -5;
    p.vLateral = 0;
    p.vDistance = 0;
  }

  it('scores a mailbox delivery to a subscriber', () => {
    const w = ready();
    const h = house();
    thrownAt(w, h, 3.1);
    const events = updatePapers(w, 1 / 30);
    expect(events).toEqual([{ type: 'mailbox' }]);
    expect(h.delivered).toBe(true);
    expect(w.papers).toHaveLength(0);
  });

  it('scores a porch delivery to a subscriber', () => {
    const w = ready();
    const h = house();
    thrownAt(w, h, 1.9);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'porch' }]);
  });

  it('wastes a paper delivered to a non-subscriber without penalty', () => {
    const w = ready();
    const h = house({ subscriber: false });
    thrownAt(w, h, 3.1);
    expect(updatePapers(w, 1 / 30)).toEqual([]);
    expect(h.delivered).toBe(false);
  });

  it('scores a smashed non-subscriber window', () => {
    const w = ready();
    const h = house({ subscriber: false });
    thrownAt(w, h, 0.9);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'windowNonSubscriber' }]);
    expect(h.windowBroken).toBe(true);
  });

  it('penalises smashing a subscriber window and loses the subscriber', () => {
    const w = ready();
    const h = house({ subscriber: true });
    thrownAt(w, h, 0.9);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'windowSubscriber' }]);
    expect(h.resolved).toBe(true);   // no later "missed" event for this house
  });

  it('scores nothing delivering to a mailbox after smashing that house\'s window', () => {
    const w = ready();
    const h = house({ subscriber: true });
    thrownAt(w, h, 0.9);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'windowSubscriber' }]);

    thrownAt(w, h, 3.1);
    expect(updatePapers(w, 1 / 30)).toEqual([]);
    expect(h.delivered).toBe(false);
  });

  it('scores nothing for smashing an already-broken window', () => {
    const w = ready();
    const h = house({ subscriber: false });
    h.windowBroken = true;
    thrownAt(w, h, 0.9);
    expect(updatePapers(w, 1 / 30)).toEqual([]);
  });

  it('breaks the combo when a paper lands on the lawn', () => {
    const w = ready();
    thrownAt(w, house(), 2.7);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'lawn' }]);
  });

  it('emits nothing for a paper thrown into the road', () => {
    const w = ready();
    thrownAt(w, house(), 6.5);
    expect(updatePapers(w, 1 / 30)).toEqual([]);
  });

  it('flies on a falling arc while still in the air', () => {
    const w = ready();
    w.houses = [];
    throwPaper(w);
    const before = w.papers[0]!.vHeight;
    updatePapers(w, 1 / 60);
    expect(w.papers[0]!.vHeight).toBeLessThan(before);
    expect(w.papers).toHaveLength(1);
  });
});

describe('resolvePassedHouses', () => {
  it('emits a miss for a subscriber left undelivered', () => {
    const w = ready();
    const h = house({ distance: 50 });
    w.houses = [h];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toEqual([{ type: 'houseMissed' }]);
    expect(h.resolved).toBe(true);
  });

  it('emits nothing for a delivered subscriber', () => {
    const w = ready();
    const h = house({ distance: 50 });
    h.delivered = true;
    w.houses = [h];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toEqual([]);
  });

  it('emits nothing for a non-subscriber', () => {
    const w = ready();
    w.houses = [house({ distance: 50, subscriber: false })];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toEqual([]);
  });

  it('emits nothing for a house not yet passed', () => {
    const w = ready();
    w.houses = [house({ distance: 100 })];
    w.rider.distance = 99;
    expect(resolvePassedHouses(w)).toEqual([]);
  });

  it('emits a miss only once per house', () => {
    const w = ready();
    w.houses = [house({ distance: 50 })];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toHaveLength(1);
    expect(resolvePassedHouses(w)).toHaveLength(0);
  });
});

describe('resolveBlocks', () => {
  it('awards a block bonus when every subscriber on it was served', () => {
    const w = ready();
    w.houses.forEach((h) => { h.delivered = true; });
    w.rider.distance = BLOCK_LENGTH_M + 1;
    expect(resolveBlocks(w)).toEqual([{ type: 'blockCleared' }]);
    expect(w.blocksCleared).toBe(1);
  });

  it('awards nothing when a subscriber was missed', () => {
    const w = ready();
    const first = w.houses.find(
      (h) => h.spec.subscriber && h.spec.distance < BLOCK_LENGTH_M,
    );
    w.houses.forEach((h) => { h.delivered = true; });
    if (first) first.delivered = false;
    w.rider.distance = BLOCK_LENGTH_M + 1;
    expect(resolveBlocks(w)).toEqual(first ? [] : [{ type: 'blockCleared' }]);
  });

  it('awards each block at most once', () => {
    const w = ready();
    w.houses.forEach((h) => { h.delivered = true; });
    w.rider.distance = BLOCK_LENGTH_M + 1;
    resolveBlocks(w);
    expect(resolveBlocks(w)).toEqual([]);
  });
});

describe('collectStacks', () => {
  it('restores papers when the rider rides over a stack', () => {
    const w = ready();
    w.rider.papers = 5;
    const s = w.stacks[0]!;
    w.rider.distance = s.spec.distance;
    w.rider.lateral = s.spec.lateral;
    collectStacks(w);
    expect(w.rider.papers).toBe(15);
    expect(s.taken).toBe(true);
  });

  it('never exceeds the paper cap', () => {
    const w = ready();
    w.rider.papers = MAX_PAPERS - 2;
    const s = w.stacks[0]!;
    w.rider.distance = s.spec.distance;
    w.rider.lateral = s.spec.lateral;
    collectStacks(w);
    expect(w.rider.papers).toBe(MAX_PAPERS);
  });

  it('cannot be collected twice', () => {
    const w = ready();
    w.rider.papers = 5;
    const s = w.stacks[0]!;
    w.rider.distance = s.spec.distance;
    w.rider.lateral = s.spec.lateral;
    collectStacks(w);
    collectStacks(w);
    expect(w.rider.papers).toBe(15);
  });
});

describe('collisions', () => {
  it('detects an overlapping hazard', () => {
    const w = ready();
    const h = w.hazards[0]!;
    w.rider.distance = h.distance;
    w.rider.lateral = h.lateral;
    expect(detectCollision(w)).toBe(h);
  });

  it('ignores a hazard the rider is clear of', () => {
    const w = ready();
    const h = w.hazards[0]!;
    w.rider.distance = h.distance + 50;
    expect(detectCollision(w)).toBeNull();
  });

  it('ignores hazards while the rider is invulnerable', () => {
    const w = ready();
    const h = w.hazards[0]!;
    w.rider.distance = h.distance;
    w.rider.lateral = h.lateral;
    w.rider.invulnerableUntil = w.elapsed + 1;
    expect(detectCollision(w)).toBeNull();
  });
});

describe('applyCrash', () => {
  it('costs a life, kills the speed and grants invulnerability', () => {
    const w = ready();
    w.rider.speed = 10;
    const events = applyCrash(w);
    expect(events).toEqual([{ type: 'crash' }]);
    expect(w.rider.lives).toBe(2);
    expect(w.rider.speed).toBeLessThan(2);
    expect(w.rider.invulnerableUntil).toBeGreaterThan(w.elapsed);
  });

  it('ends the run when the last life goes', () => {
    const w = ready();
    w.rider.lives = 1;
    applyCrash(w);
    expect(w.gameOver).toBe(true);
  });
});

describe('stepWorld', () => {
  const input = { steer: 0, throwPaper: false, powerWatts: 220 };

  it('advances the rider and keeps the world consistent', () => {
    const w = ready();
    for (let i = 0; i < 600; i++) stepWorld(w, input, DEFAULT_RIDER, 1 / 60);
    expect(w.rider.distance).toBeGreaterThan(10);
    expect(Number.isFinite(w.rider.speed)).toBe(true);
  });

  it('accumulates score through the shared scoring rules', () => {
    const w = ready();
    for (let i = 0; i < 3600; i++) {
      stepWorld(w, { ...input, throwPaper: i % 40 === 0 }, DEFAULT_RIDER, 1 / 60);
      if (w.gameOver) break;
    }
    expect(w.score.score).toBeGreaterThanOrEqual(0);
  });

  it('throws at most one paper per frame even if the key is held', () => {
    const w = ready();
    stepWorld(w, { ...input, throwPaper: true }, DEFAULT_RIDER, 1 / 60);
    expect(w.rider.papers).toBe(START_PAPERS - 1);
  });

  it('stops changing the world once the run is over', () => {
    const w = ready();
    w.rider.lives = 1;
    applyCrash(w);
    const snapshot = w.rider.distance;
    stepWorld(w, { ...input, powerWatts: 400 }, DEFAULT_RIDER, 1);
    expect(w.rider.distance).toBe(snapshot);
  });

  it('is deterministic for a fixed input sequence', () => {
    const run = () => {
      const w = ready(7);
      for (let i = 0; i < 1800; i++) {
        stepWorld(
          w,
          { steer: i % 120 < 60 ? -1 : 1, throwPaper: i % 30 === 0, powerWatts: 210 },
          DEFAULT_RIDER,
          1 / 60,
        );
      }
      return { d: w.rider.distance, s: w.score.score, l: w.rider.lives };
    };
    expect(run()).toEqual(run());
  });
});
