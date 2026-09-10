/**
 * Proof that the restructure moved the games without changing them.
 *
 * Each game's pure logic still exposes the fixed-step loop it always had.
 * These tests drive that loop directly, drive the same game through the
 * shell's loop instead, and require the two to agree exactly. If the shell's
 * power easing were stacked on top of a game's own — the obvious way to get
 * this wrong — every one of these would drift apart within a second.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@paperboy/game-core';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import type { GameModule } from '@paperboy/game-api';
import * as paperboyLogic from '@paperboy/game-paperboy';
import * as packLogic from '@paperboy/game-pack';
import * as velodromeLogic from '@paperboy/game-velodrome';
import { CATALOG } from '../src/catalog.js';
import {
  NO_KEYS, advanceRide, createRide, setPower, startRide,
} from '../src/ride.js';

const PROFILE = { ...DEFAULT_RIDER, ftpWatts: 250, massKg: 78, sprintWatts: 1200 };
const DT = 1 / 60;
/** Watts held for the whole comparison. Constant is enough: what is being
 * compared is the easing and the stepping, not the rider. */
const WATTS = 260;

/** Runs a game through the shell exactly as `main.ts` does. */
function throughTheShell(game: GameModule, frames: number, opts: {
  seed?: number; variantId?: string;
} = {}) {
  const store = createMemoryStorage();
  const session = game.create({ profile: PROFILE, store, ...opts });
  const ride = createRide();
  startRide(ride, game, session);
  for (let i = 0; i < frames; i++) {
    setPower(ride, WATTS);
    advanceRide(ride, { dtSeconds: DT, keys: NO_KEYS, width: 900, height: 600 });
  }
  return session.result();
}

describe('Paperboy', () => {
  it('rides identically through the shell and through its own loop', () => {
    const frames = 2400;
    const seed = 4242;

    const raw = paperboyLogic.createSession(seed, PROFILE);
    for (let i = 0; i < frames; i++) {
      paperboyLogic.setPower(raw, WATTS);
      paperboyLogic.advanceFixed(raw, DT, { steer: 0, throwPaper: false });
    }
    const expected = paperboyLogic.toRunResult(raw);

    const shell = throughTheShell(CATALOG[0]!, frames, { seed });
    // Non-vacuity: a comparison of two zeroes would prove nothing.
    expect(expected.distanceM).toBeGreaterThan(100);
    expect(shell.distanceM).toBe(expected.distanceM);
    expect(shell.avgPower).toBe(expected.avgPower);
    expect(shell.durationS * 1000).toBeCloseTo(expected.durationMs, 6);
    expect(shell.score).toBe(expected.score);
  });
});

describe('The Pack', () => {
  it('rides identically through the shell and through its own loop', () => {
    const frames = 2400;

    const raw = packLogic.createSession(PROFILE);
    for (let i = 0; i < frames; i++) {
      packLogic.setPower(raw, WATTS);
      packLogic.advanceFixed(raw, DT);
    }
    const expected = packLogic.toRunResult(raw);

    const shell = throughTheShell(CATALOG[1]!, frames);
    expect(expected.distanceM).toBeGreaterThan(100);
    expect(shell.distanceM).toBe(expected.distanceM);
    expect(shell.avgPower).toBe(expected.avgPower);
    expect(shell.durationS * 1000).toBeCloseTo(expected.durationMs, 6);
  });
});

describe('Velodrome', () => {
  it('races identically through the shell and through its own loop', () => {
    const frames = 3600;
    const spec = velodromeLogic.LADDER[0]!;

    const raw = velodromeLogic.createRace(PROFILE, spec);
    for (let i = 0; i < frames; i++) {
      velodromeLogic.setPower(raw, WATTS);
      velodromeLogic.advanceFixed(raw, DT);
    }

    const shell = throughTheShell(CATALOG[2]!, frames, { variantId: spec.id });
    expect(raw.player.distance).toBeGreaterThan(100);
    expect(shell.distanceM).toBe(Math.round(raw.player.distance));
    expect(shell.avgPower).toBe(velodromeLogic.toRaceResult(raw).avgPower);
  });

  it('remembers a rival the rider has met, and does not unlock one they only stopped', () => {
    const store = createMemoryStorage();
    const velodrome = CATALOG[2]!;

    expect(velodrome.variants?.(store)[0]?.note).toContain('Ride them once');
    expect(velodrome.variants?.(store)[1]?.locked).toBe(true);

    const first = velodromeLogic.LADDER[0]!;
    const session = velodrome.create({ profile: PROFILE, variantId: first.id, store });
    expect(velodrome.variants?.(store)[0]?.note).toContain(first.tell);

    // Stopping a race is not beating it: the next rung stays shut.
    session.stop();
    session.onEnd?.(store);
    expect(velodrome.variants?.(store)[0]?.cleared).toBe(false);
    expect(velodrome.variants?.(store)[1]?.locked).toBe(true);
  });
});

describe('every game in the catalog', () => {
  it('produces the same run twice from the same inputs', () => {
    for (const game of CATALOG) {
      const a = throughTheShell(game, 400, { seed: 99 });
      const b = throughTheShell(game, 400, { seed: 99 });
      expect(b).toEqual(a);
    }
  });

  it('asks for a real load while riding and stays honest about it', () => {
    for (const game of CATALOG) {
      const store = createMemoryStorage();
      const session = game.create({ profile: PROFILE, seed: 7, store });
      const sim = session.simulation();
      expect(Number.isFinite(sim.grade)).toBe(true);
      expect(Number.isFinite(sim.cw)).toBe(true);
      expect(sim.cw).toBeGreaterThan(0);
    }
  });

  it('ends when the rider hits the safety stop, without a run result before then', () => {
    for (const game of CATALOG) {
      const store = createMemoryStorage();
      const session = game.create({ profile: PROFILE, seed: 7, store });
      expect(session.isOver).toBe(false);
      session.stop();
      expect(session.isOver).toBe(true);
      expect(session.result().stopped).toBe(true);
    }
  });
});
