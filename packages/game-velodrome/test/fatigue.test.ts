import { describe, expect, it } from 'vitest';
import { FADE_FROM_FRACTION, wPrimeCapacity } from '@paperboy/game-core';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import type { RiderProfile } from '@paperboy/game-api';
import {
  FIXED_DT, RACE_DISTANCE_M,
  advance, createRace, draftSavingWatts, setPower, toRaceResult,
} from '../src/race.js';
import type { RaceState } from '../src/race.js';
import { CHAMPION, WHEELSUCKER } from '../src/rivals.js';
import type { RivalSpec } from '../src/rivals.js';

const PROFILE: RiderProfile = { ...DEFAULT_RIDER, ftpWatts: 240 };
const FTP = PROFILE.ftpWatts;
const STORE = wPrimeCapacity(PROFILE);

interface Ridden {
  state: RaceState;
  /** Fraction of the race the RIVAL spent sheltered. */
  rivalDraftShare: number;
  /** Elapsed seconds when the rival crossed the line, or Infinity. */
  rivalFinishS: number;
  /** The rival's speed over the closing 100 m, m/s. */
  rivalClosingSpeed: number;
}

function ride(
  spec: RivalSpec, wattsAt: (s: RaceState) => number, maxSeconds = 400,
  rivalStartsAt = 1,
): Ridden {
  const state = createRace(PROFILE, spec);
  state.rival.wPrime.balanceJ = state.rival.wPrime.capacityJ * rivalStartsAt;
  let sheltered = 0;
  let steps = 0;
  let rivalFinishS = Infinity;
  let at900: { t: number; d: number } | null = null;
  const closing: number[] = [];
  for (let i = 0; i < Math.round(maxSeconds / FIXED_DT) && !state.finished; i++) {
    setPower(state, wattsAt(state));
    advance(state, FIXED_DT);
    if (state.rival.drafting) sheltered += 1;
    steps += 1;
    if (state.rival.distance >= RACE_DISTANCE_M - 100) {
      if (at900 === null) at900 = { t: state.elapsed, d: state.rival.distance };
      closing.push(state.rival.speed);
    }
    if (rivalFinishS === Infinity && state.rival.distance >= RACE_DISTANCE_M) {
      rivalFinishS = state.elapsed;
    }
  }
  return {
    state,
    rivalDraftShare: steps === 0 ? 0 : sheltered / steps,
    rivalFinishS,
    rivalClosingSpeed: closing.length === 0
      ? 0 : closing.reduce((a, b) => a + b, 0) / closing.length,
  };
}

const fraction = (r: { wPrime: { balanceJ: number; capacityJ: number } }): number =>
  r.wPrime.balanceJ / r.wPrime.capacityJ;

// ---------------------------------------------------------------------------
// THE HEADLINE CLAIM
// ---------------------------------------------------------------------------

/**
 * A rival with no tactics and no tells: it simply rides at a pace well above
 * threshold and jumps at the bell, exactly the same way in both races below.
 * Everything that differs between the two races is where it sat.
 */
const PACEMAKER: RivalSpec = {
  id: 'diesel',
  name: 'Pacemaker',
  line: '', tell: '', counter: '',
  baseCurve: [[0, 1.7], [1, 1.7]],
  moves: [],
  recovery: null,
  tactic: 'none',
  jump: { fromProgress: 0.88, fraction: 2.05 },
};

/** The player sits on the rival's wheel, so the rival leads the whole race
 * out in the wind. */
const sitBehind = (s: RaceState): number => {
  if (s.gap > -1.2) return 0.30 * FTP;
  if (s.gap < -3.0) return 1.90 * FTP;
  return 1.10 * FTP;
};

/** The player goes to the front and holds the rival two metres back, so the
 * rival rides exactly the same pace from inside the shelter. */
const leadAt = (base: number) => (s: RaceState): number =>
  Math.max(0, Math.min(2.2 * FTP, base * FTP + 27 + 45 * (2 - s.gap)));

describe('THE HEADLINE — one rival forced to lead, one sheltered', () => {
  const forced = ride(PACEMAKER, sitBehind);
  const sheltered = ride(PACEMAKER, leadAt(1.7));

  it('sets up the two races it says it does', () => {
    // One rival never gets a wheel; the other spends most of the race on one.
    expect(forced.rivalDraftShare).toBeLessThan(0.02);
    expect(sheltered.rivalDraftShare).toBeGreaterThan(0.6);
    // Same rival, same script, same distance, both of them get there.
    expect(forced.rivalFinishS).toBeLessThan(Infinity);
    expect(sheltered.rivalFinishS).toBeLessThan(Infinity);
  });

  it('leaves the forced rival with far less in the tank', () => {
    // This is the property the whole fatigue model exists to create: what a
    // rider spends is decided by where they sat, and it is still gone at the
    // finish rather than only in the moment.
    expect(fraction(forced.state.rival)).toBeLessThan(0.35);
    expect(fraction(sheltered.state.rival))
      .toBeGreaterThan(fraction(forced.state.rival) * 1.5);
  });

  it('and they finish differently', () => {
    // Not "differently in a spreadsheet": seconds over a kilometre, and
    // slower over the last hundred metres, where the race is decided.
    expect(sheltered.rivalFinishS).toBeLessThan(forced.rivalFinishS - 2);
    expect(sheltered.rivalClosingSpeed)
      .toBeGreaterThan(forced.rivalClosingSpeed + 0.2);
  });

  it('and it is the store doing it, not just the air', () => {
    // The two races above differ in two ways at once — one rival spends more
    // AND rides in dirtier air — so on its own the finish above does not
    // prove which. This pair holds the air fixed: the same rival leads the
    // same race in the wind both times, and the only difference is what was
    // in the tank when the gun went.
    const full = ride(PACEMAKER, sitBehind, 400, 1);
    const drained = ride(PACEMAKER, sitBehind, 400, 0.45);
    expect(full.rivalDraftShare).toBeLessThan(0.02);
    expect(drained.rivalDraftShare).toBeLessThan(0.02);
    expect(drained.rivalFinishS).toBeGreaterThan(full.rivalFinishS + 1);
    expect(drained.rivalClosingSpeed)
      .toBeLessThan(full.rivalClosingSpeed - 0.15);
  });

  it('slows the forced rival because it is EMPTY, not because it eased', () => {
    // Its script asks for the same jump in both races. In one of them the
    // legs are not there, and the gap between what it asked for and what it
    // produced is the fatigue model doing its job.
    const r = forced.state.rival;
    expect(r.powerCurrent).toBeGreaterThan(1.7 * FTP);
    expect(r.powerEffective).toBeLessThan(r.powerCurrent * 0.75);
    // The sheltered one gets what it asked for.
    const w = sheltered.state.rival;
    expect(w.powerEffective).toBeGreaterThan(w.powerCurrent * 0.9);
  });
});

// ---------------------------------------------------------------------------
// The player is not exempt
// ---------------------------------------------------------------------------

describe('the player, spent', () => {
  it('cannot sprint on an empty store', () => {
    // Burn the store on the first lap, then ask for the sprint at the bell.
    const s = createRace(PROFILE, PACEMAKER);
    for (let i = 0; i < Math.round(60 / FIXED_DT); i++) {
      setPower(s, 4 * FTP);
      advance(s, FIXED_DT);
    }
    expect(fraction(s.player)).toBeLessThan(0.05);
    const spentSprint = s.player.powerEffective;

    const fresh = createRace(PROFILE, PACEMAKER);
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
      setPower(fresh, 4 * FTP);
      advance(fresh, FIXED_DT);
    }
    expect(fresh.player.powerEffective).toBeCloseTo(fresh.player.powerCurrent, 6);
    expect(spentSprint).toBeLessThan(fresh.player.powerEffective * 0.4);
    // But tempo is still there. The aerobic supply does not run out.
    expect(spentSprint).toBeGreaterThanOrEqual(s.criticalPowerW);
  });

  it('pays about a third of the store for a full-gas last 200 m', () => {
    const s = createRace(PROFILE, PACEMAKER);
    for (let i = 0; i < Math.round(15 / FIXED_DT); i++) {
      setPower(s, 3.5 * FTP);
      advance(s, FIXED_DT);
    }
    const spent = (STORE - s.player.wPrime.balanceJ) / STORE;
    expect(spent).toBeGreaterThan(0.3);
    expect(spent).toBeLessThan(0.65);
  });

  it('gets some of it back sitting in, but nothing like all of it', () => {
    const s = createRace(PROFILE, WHEELSUCKER);
    for (let i = 0; i < Math.round(20 / FIXED_DT); i++) {
      setPower(s, 2.2 * FTP);
      advance(s, FIXED_DT);
    }
    const low = s.player.wPrime.balanceJ;
    const spent = STORE - low;
    for (let i = 0; i < Math.round(20 / FIXED_DT); i++) {
      setPower(s, 0.4 * FTP);
      advance(s, FIXED_DT);
    }
    const back = s.player.wPrime.balanceJ - low;
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(spent * 0.35);
  });

  it('reports what is left of the store on the results card', () => {
    const s = createRace(PROFILE, PACEMAKER);
    expect(toRaceResult(s).batteryLeft).toBe(1);
    for (let i = 0; i < Math.round(40 / FIXED_DT); i++) {
      setPower(s, 3 * FTP);
      advance(s, FIXED_DT);
    }
    const left = toRaceResult(s).batteryLeft;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// The store as a quantity, over a whole race
// ---------------------------------------------------------------------------

describe('both stores, over a whole race', () => {
  it('never go negative and never exceed the store', () => {
    for (const watts of [0, 0.5, 1, 1.6, 3, 8]) {
      const s = createRace(PROFILE, CHAMPION);
      for (let i = 0; i < Math.round(200 / FIXED_DT) && !s.finished; i++) {
        setPower(s, watts * FTP);
        advance(s, FIXED_DT);
        for (const r of [s.player, s.rival]) {
          expect(r.wPrime.balanceJ).toBeGreaterThanOrEqual(0);
          expect(r.wPrime.balanceJ).toBeLessThanOrEqual(r.wPrime.capacityJ);
        }
      }
    }
  });

  it('are the same size, because both riders race the one profile', () => {
    const s = createRace(PROFILE, CHAMPION);
    expect(s.player.wPrime.capacityJ).toBe(s.rival.wPrime.capacityJ);
    expect(s.player.wPrime.capacityJ).toBe(STORE);
  });

  it('take a figure the rider entered themselves', () => {
    const s = createRace({ ...PROFILE, wPrimeJoules: 30000 }, CHAMPION);
    expect(s.player.wPrime.capacityJ).toBe(30000);
    expect(s.rival.wPrime.capacityJ).toBe(30000);
  });

  it('replays identically for the same input sequence', () => {
    const run = (): string => {
      const s = createRace(PROFILE, CHAMPION);
      const out: number[] = [];
      for (let i = 0; i < Math.round(120 / FIXED_DT) && !s.finished; i++) {
        setPower(s, (1 + Math.sin(i / 700)) * FTP);
        advance(s, FIXED_DT);
        if (i % 600 === 0) {
          out.push(s.player.wPrime.balanceJ, s.rival.wPrime.balanceJ, s.gap);
        }
      }
      return `${s.winner}|${out.join(',')}`;
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// What the shelter is worth
// ---------------------------------------------------------------------------

describe('the shelter, as watts', () => {
  it('is worth nothing at a standstill and about 50 W at track pace', () => {
    expect(draftSavingWatts(PROFILE, 0)).toBe(0);
    expect(draftSavingWatts(PROFILE, 2)).toBeLessThan(3);
    expect(draftSavingWatts(PROFILE, 9.6)).toBeGreaterThan(45);
    expect(draftSavingWatts(PROFILE, 9.6)).toBeLessThan(60);
  });

  it('rises with the cube of speed, because that is what air does', () => {
    const a = draftSavingWatts(PROFILE, 5);
    const b = draftSavingWatts(PROFILE, 10);
    expect(b / a).toBeCloseTo(8, 6);
  });
});

// ---------------------------------------------------------------------------
// Tactics that read their own state
// ---------------------------------------------------------------------------

describe('the Wheelsucker, forced', () => {
  it('is worn down by a rider who forces the pace, and is not by one who sits up', () => {
    const forced = ride(WHEELSUCKER, () => 1.55 * FTP);
    const soft = ride(WHEELSUCKER, () => 0.70 * FTP);
    expect(fraction(forced.state.rival))
      .toBeLessThan(fraction(soft.state.rival) - 0.1);
  });

  it('will not spend what it has left to hold a wheel', () => {
    // The counter says "force the pace". This is the mechanism behind it:
    // once the store is low, keeping station stops being worth it and the
    // wheel goes, which is a thing a rider can actually make happen.
    const forced = ride(WHEELSUCKER, () => 1.75 * FTP);
    expect(fraction(forced.state.rival)).toBeLessThan(0.55);
    expect(forced.state.gap).toBeGreaterThan(3.5);
  });
});

describe('the Champion, watching', () => {
  it('goes when the rider is spent', () => {
    // Same Champion, same moment of the race; the only difference is whether
    // the player has anything left.
    const spend = (s: RaceState, watts: number): void => {
      for (let i = 0; i < Math.round(45 / FIXED_DT) && !s.finished; i++) {
        setPower(s, watts);
        advance(s, FIXED_DT);
      }
    };
    const spent = createRace(PROFILE, CHAMPION);
    spend(spent, 3.2 * FTP);
    const fresh = createRace(PROFILE, CHAMPION);
    spend(fresh, 0.95 * FTP);

    expect(fraction(spent.player)).toBeLessThan(FADE_FROM_FRACTION);
    expect(fraction(fresh.player)).toBe(1);
    expect(spent.rival.powerTarget).toBeGreaterThan(fresh.rival.powerTarget * 1.2);
  });

  it('does not answer an attack she cannot afford', () => {
    // Empty her store first, then attack: she has to let it go.
    const s = createRace(PROFILE, CHAMPION);
    for (let i = 0; i < Math.round(150 / FIXED_DT) && !s.finished; i++) {
      setPower(s, 1.4 * FTP);
      advance(s, FIXED_DT);
    }
    if (!s.finished) {
      expect(s.rival.powerEffective).toBeLessThan(s.rival.powerCurrent + 1);
    }
    expect(fraction(s.rival)).toBeLessThan(0.5);
  });
});
