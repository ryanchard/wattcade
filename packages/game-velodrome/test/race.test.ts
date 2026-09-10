import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER, steadyStateSpeed } from '@paperboy/trainer';
import type { RiderProfile } from '@paperboy/trainer';
import {
  CW_DRAFT, CW_OPEN, DRAFT_MAX_M, DRAFT_MIN_M, FIXED_DT, FLAT_SIMULATION,
  LAP_LENGTH_M, MAX_PLAUSIBLE_WATTS, RACE_DISTANCE_M, RACE_LAPS,
  advance, advanceFixed, createRace, cwFor, draftedProfile, effectiveSimulation,
  lapNumber, lapPhase, metresRemaining, playerDrafting, rivalDrafting,
  setPower, simulationFor, stopRace, toRaceResult,
} from '../src/race.js';
import type { RaceState } from '../src/race.js';
import {
  ATTACKER, CHAMPION, DIESEL, FEINTER, FLYER, WHEELSUCKER,
} from '../src/rivals.js';
import type { RivalSpec } from '../src/rivals.js';

const PROFILE: RiderProfile = { ...DEFAULT_RIDER, ftpWatts: 240 };

/** Watts needed to hold `speed` on the flat with this profile, by bisection.
 * The honest way to ask "did the draft make this easier?" */
function powerToHold(speed: number, profile: RiderProfile): number {
  let lo = 0;
  let hi = 2000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (steadyStateSpeed(mid, 0, profile) < speed) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface Sample {
  t: number;
  gap: number;
  playerDistance: number;
  rivalDistance: number;
  rivalPower: number;
  playerDrafting: boolean;
  rivalDrafting: boolean;
}

/** Ride a whole race at a scripted player effort. Returns the final state
 * and one sample per simulated second. */
function ride(
  spec: RivalSpec,
  wattsAt: (s: RaceState) => number,
  maxSeconds = 400,
): { state: RaceState; samples: Sample[] } {
  const state = createRace(PROFILE, spec);
  const samples: Sample[] = [];
  let nextSample = 0;
  const steps = Math.round(maxSeconds / FIXED_DT);
  for (let i = 0; i < steps && !state.finished; i++) {
    setPower(state, wattsAt(state));
    advance(state, FIXED_DT);
    if (state.elapsed >= nextSample) {
      samples.push({
        t: state.elapsed,
        gap: state.gap,
        playerDistance: state.player.distance,
        rivalDistance: state.rival.distance,
        rivalPower: state.rival.powerCurrent,
        playerDrafting: state.player.drafting,
        rivalDrafting: state.rival.drafting,
      });
      nextSample += 1;
    }
  }
  return { state, samples };
}

const flat = (watts: number) => () => watts;

// ---------------------------------------------------------------------------

describe('the draft', () => {
  it('applies only between 0.5 m and 3.5 m behind the rival', () => {
    // Sitting in.
    expect(playerDrafting(-DRAFT_MIN_M)).toBe(true);
    expect(playerDrafting(-2)).toBe(true);
    expect(playerDrafting(-DRAFT_MAX_M)).toBe(true);
    // Overlapping wheels / level.
    expect(playerDrafting(-0.4)).toBe(false);
    expect(playerDrafting(0)).toBe(false);
    // Too far back for the hole in the air.
    expect(playerDrafting(-3.6)).toBe(false);
    expect(playerDrafting(-40)).toBe(false);
  });

  it('never shelters the rider who is leading', () => {
    for (const gap of [0.1, 0.5, 2, 3.5, 10, 200]) {
      expect(playerDrafting(gap)).toBe(false);
    }
  });

  it('holds on a little past the edge once you are already in it', () => {
    // Strict on the way in, forgiving on the way out: the trainer must not
    // flutter while a rider hovers at the boundary.
    expect(playerDrafting(-3.7)).toBe(false);
    expect(playerDrafting(-3.7, true)).toBe(true);
    expect(playerDrafting(-4.5, true)).toBe(false);
    expect(rivalDrafting(3.7)).toBe(false);
    expect(rivalDrafting(3.7, true)).toBe(true);
  });

  it('is symmetric — the rival gets exactly the same shelter', () => {
    for (const behind of [0.5, 1, 2, 3.5]) {
      expect(playerDrafting(-behind)).toBe(true);
      expect(rivalDrafting(behind)).toBe(true);
    }
    for (const bad of [0, 0.4, 3.6, 50]) {
      expect(rivalDrafting(bad)).toBe(false);
      expect(rivalDrafting(-bad)).toBe(false);
    }
  });

  it('reduces the power the player needs to hold a given speed', () => {
    const speed = 13; // m/s, about 47 km/h — track pace
    const open = powerToHold(speed, PROFILE);
    const sheltered = powerToHold(speed, draftedProfile(PROFILE));
    expect(sheltered).toBeLessThan(open);
    // Roughly the 26% the whole game is built on.
    const saving = 1 - sheltered / open;
    expect(saving).toBeGreaterThan(0.2);
    expect(saving).toBeLessThan(0.32);
  });

  it('makes the same watts go faster, on screen as well as in the legs', () => {
    const open = steadyStateSpeed(250, 0, PROFILE);
    const sheltered = steadyStateSpeed(250, 0, draftedProfile(PROFILE));
    expect(sheltered).toBeGreaterThan(open);
  });

  it('sends the trainer a lower cw when sheltered and the full one when not', () => {
    expect(cwFor(true)).toBe(CW_DRAFT);
    expect(cwFor(false)).toBe(CW_OPEN);
    expect(CW_DRAFT).toBeLessThan(CW_OPEN);
  });

  it('is actually experienced during a race, not just computable', () => {
    // Sit on the Diesel's wheel: the player should spend real time sheltered.
    const { state } = ride(DIESEL, (s) => (s.gap < -2 ? 300 : 150));
    expect(state.player.draftedS).toBeGreaterThan(5);
  });
});

describe('the track', () => {
  it('is 250 m a lap and 1000 m a race', () => {
    expect(LAP_LENGTH_M).toBe(250);
    expect(RACE_LAPS).toBe(4);
    expect(RACE_DISTANCE_M).toBe(1000);
  });

  it('counts laps from one and stops at four', () => {
    expect(lapNumber(0)).toBe(1);
    expect(lapNumber(249)).toBe(1);
    expect(lapNumber(250)).toBe(2);
    expect(lapNumber(999)).toBe(4);
    expect(lapNumber(1000)).toBe(4);
    expect(lapNumber(5000)).toBe(4);
  });

  it('reports a position around the loop for the track map', () => {
    expect(lapPhase(0)).toBeCloseTo(0, 10);
    expect(lapPhase(125)).toBeCloseTo(0.5, 10);
    expect(lapPhase(375)).toBeCloseTo(0.5, 10);
  });

  it('counts down the metres remaining', () => {
    expect(metresRemaining(0)).toBe(1000);
    expect(metresRemaining(880)).toBe(120);
    expect(metresRemaining(1200)).toBe(0);
  });
});

describe('the race', () => {
  it('ends at 1000 m and is inert afterwards', () => {
    const { state } = ride(DIESEL, flat(280));
    expect(state.finished).toBe(true);
    expect(
      Math.max(state.player.distance, state.rival.distance),
    ).toBeGreaterThanOrEqual(RACE_DISTANCE_M);

    setPower(state, 900);
    const frozen = JSON.stringify(state);
    advance(state, FIXED_DT);
    advanceFixed(state, 1);
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it('names a winner', () => {
    const { state } = ride(DIESEL, flat(280));
    expect(state.winner === 'player' || state.winner === 'rival').toBe(true);
    expect(state.aborted).toBe(false);
  });

  it('gives the win to whoever crossed first', () => {
    const strong = ride(DIESEL, flat(400)).state;
    expect(strong.winner).toBe('player');
    const weak = ride(DIESEL, flat(80)).state;
    expect(weak.winner).toBe('rival');
  });

  it('tracks the gap signed, positive when the player leads', () => {
    const { state } = ride(DIESEL, flat(400));
    expect(state.gap).toBeGreaterThan(0);
    expect(state.gap).toBeCloseTo(state.player.distance - state.rival.distance, 9);
  });

  it('is deterministic for a fixed input sequence', () => {
    const script = (s: RaceState): number =>
      200 + 120 * Math.sin(s.elapsed * 0.7) + (s.gap < -1 ? -40 : 20);
    const a = ride(CHAMPION, script).state;
    const b = ride(CHAMPION, script).state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('is deterministic through advanceFixed as well', () => {
    const run = (): RaceState => {
      const s = createRace(PROFILE, ATTACKER);
      for (let i = 0; i < 4000 && !s.finished; i++) {
        setPower(s, 230 + (i % 500 < 100 ? 160 : 0));
        advanceFixed(s, 1 / 60);
      }
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('clamps a nonsense power reading and treats a dropout as zero', () => {
    const s = createRace(PROFILE, DIESEL);
    setPower(s, 99999);
    expect(s.player.powerTarget).toBe(MAX_PLAUSIBLE_WATTS);
    setPower(s, null);
    expect(s.player.powerTarget).toBe(0);
    setPower(s, Number.NaN);
    expect(s.player.powerTarget).toBe(0);
    setPower(s, -50);
    expect(s.player.powerTarget).toBe(0);
  });

  it('eases power toward the reading rather than stepping to it', () => {
    const s = createRace(PROFILE, DIESEL);
    setPower(s, 300);
    advance(s, FIXED_DT);
    // One 1/120 s step must not deliver the whole 300 W jump.
    expect(s.player.powerCurrent).toBeGreaterThan(0);
    expect(s.player.powerCurrent).toBeLessThan(60);
  });

  it('does not advance while paused', () => {
    const s = createRace(PROFILE, DIESEL);
    setPower(s, 300);
    advance(s, FIXED_DT);
    s.paused = true;
    const frozen = JSON.stringify(s);
    advance(s, FIXED_DT);
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('reports a result', () => {
    const { state } = ride(DIESEL, (s) => (s.gap < -2 ? 300 : 340));
    const result = toRaceResult(state);
    expect(result.timeS).toBeGreaterThan(30);
    expect(result.avgPower).toBeGreaterThan(200);
    expect(result.draftShare).toBeGreaterThanOrEqual(0);
    expect(result.draftShare).toBeLessThanOrEqual(1);
    expect(result.marginM).toBeCloseTo(state.gap, 9);
  });
});

describe('the safety stop', () => {
  it('ends the race without naming a winner and leaves it inert', () => {
    const s = createRace(PROFILE, DIESEL);
    setPower(s, 300);
    for (let i = 0; i < 600; i++) advance(s, FIXED_DT);
    stopRace(s);
    expect(s.finished).toBe(true);
    expect(s.aborted).toBe(true);
    expect(s.winner).toBeNull();

    const frozen = JSON.stringify(s);
    advanceFixed(s, 1);
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('never writes to the trainer itself — it only changes state', () => {
    const s = createRace(PROFILE, DIESEL);
    stopRace(s);
    expect(effectiveSimulation(s)).toEqual(FLAT_SIMULATION);
  });
});

describe('the simulation sent to the trainer', () => {
  it('is flat-grade with the full cw when out in the wind', () => {
    const s = createRace(PROFILE, DIESEL);
    s.player.drafting = false;
    expect(simulationFor(s)).toEqual({
      grade: 0, headwind: 0, crr: PROFILE.crr, cw: CW_OPEN,
    });
  });

  it('drops the cw when the player is sheltered — the trainer eases', () => {
    const s = createRace(PROFILE, DIESEL);
    s.player.drafting = true;
    expect(simulationFor(s).cw).toBe(CW_DRAFT);
    expect(simulationFor(s).grade).toBe(0);
  });

  it('goes flat and full-cw when paused', () => {
    const s = createRace(PROFILE, DIESEL);
    s.player.drafting = true;
    s.paused = true;
    expect(effectiveSimulation(s)).toEqual(FLAT_SIMULATION);
    expect(FLAT_SIMULATION.cw).toBe(CW_OPEN);
    expect(FLAT_SIMULATION.grade).toBe(0);
  });

  it('goes flat once the race is over', () => {
    const { state } = ride(DIESEL, flat(320));
    expect(effectiveSimulation(state)).toEqual(FLAT_SIMULATION);
  });

  it('follows the draft during an actual race', () => {
    const s = createRace(PROFILE, DIESEL);
    const seen = new Set<number>();
    for (let i = 0; i < 20000 && !s.finished; i++) {
      setPower(s, s.gap < -2 ? 300 : 150);
      advance(s, FIXED_DT);
      seen.add(effectiveSimulation(s).cw);
    }
    expect(seen.has(CW_DRAFT)).toBe(true);
    expect(seen.has(CW_OPEN)).toBe(true);
  });
});

describe('the fixed timestep', () => {
  it('carries sub-timestep frames forward instead of dropping them', () => {
    const s = createRace(PROFILE, DIESEL);
    setPower(s, 300);
    // 1/144 s is shorter than FIXED_DT; alone it must advance nothing...
    advanceFixed(s, 1 / 144);
    expect(s.elapsed).toBe(0);
    // ...but two of them are more than one step's worth.
    advanceFixed(s, 1 / 144);
    expect(s.elapsed).toBeCloseTo(FIXED_DT, 9);
  });

  it('drops the backlog after a genuine stall', () => {
    const s = createRace(PROFILE, DIESEL);
    setPower(s, 300);
    advanceFixed(s, 60);
    expect(s.accumulator).toBe(0);
    expect(s.elapsed).toBeCloseTo(30 * FIXED_DT, 9);
  });
});

// ---------------------------------------------------------------------------
// The ladder, ridden
// ---------------------------------------------------------------------------

describe('the Diesel, ridden', () => {
  it('holds one number all race — the tell is that nothing ever changes', () => {
    const { samples } = ride(DIESEL, flat(240));
    // On the front, which is where he rides the race, the number is dead
    // flat. Sitting in somebody's draft he pays less for the same pace (see
    // RIVAL_SHELTER_BANK), and everyone leaves the line level, so the first
    // few seconds of every race are the exception.
    // Two seconds of clearance either side of the sample, because his power
    // is eased with a 0.6 s time constant and pulling out of a wheel is a
    // change of effort like any other.
    const onTheFront = samples.filter((s, i) =>
      i >= 5 && samples.slice(i - 2, i + 1).every((x) => !x.rivalDrafting));
    expect(onTheFront.length).toBeGreaterThan(40);
    const powers = onTheFront.map((s) => s.rivalPower);
    expect(Math.max(...powers) - Math.min(...powers)).toBeLessThan(1);
  });

  it('is beaten by sitting in and coming past at the end', () => {
    // Match his watts out in the wind and, at best, you dead-heat: he is
    // sitting in the hole you are making, which is worth about 50 W at track
    // pace, so his 221 W and your 221 W are not the same ride.
    const inTheWind = ride(DIESEL, flat(0.92 * PROFILE.ftpWatts)).state;
    expect(Math.abs(inTheWind.gap)).toBeLessThan(3);

    // ...sit in on the same watts and jump at the bell, and you win properly.
    const sittingIn = ride(DIESEL, (s) => {
      if (s.player.distance > 880) return 1.5 * PROFILE.ftpWatts;
      return s.gap < -3 ? 0.55 * PROFILE.ftpWatts : 0.9 * PROFILE.ftpWatts;
    }).state;
    expect(sittingIn.winner).toBe('player');
    expect(sittingIn.gap).toBeGreaterThan(3);
  });
});

describe('the Flyer, ridden', () => {
  it('leads early and fades badly', () => {
    const { samples, state } = ride(FLYER, flat(0.95 * PROFILE.ftpWatts));
    const early = samples.find((s) => s.rivalDistance > 150);
    expect(early).toBeDefined();
    // Well up the road in the first lap.
    expect(early!.gap).toBeLessThan(-15);

    // And going backwards by the end: last-lap power far below the first.
    const first = samples[2]!.rivalPower;
    const last = samples[samples.length - 2]!.rivalPower;
    expect(last).toBeLessThan(first * 0.55);
    expect(state.winner).toBe('player');
  });

  it('can be reeled in without ever going near his opening pace', () => {
    // The counter is discipline: an even tempo well under his opening surge
    // still gets there first. (What actually punishes a chase is the rider's
    // own legs — there is deliberately no fatigue model here, because the
    // trainer is the fatigue model.)
    const even = ride(FLYER, flat(0.95 * PROFILE.ftpWatts));
    const openingPace = even.samples[3]!.rivalPower;
    expect(even.state.winner).toBe('player');
    expect(0.95 * PROFILE.ftpWatts).toBeLessThan(openingPace * 0.8);
  });
});

describe('the Attacker, ridden', () => {
  it('surges repeatedly with recovery between', () => {
    const { samples } = ride(ATTACKER, flat(0.95 * PROFILE.ftpWatts));
    const powers = samples.map((s) => s.rivalPower);
    const mean = powers.reduce((a, b) => a + b, 0) / powers.length;
    // Count the excursions above the mean: a surge pattern, not a flat line.
    let bursts = 0;
    let above = false;
    for (const p of powers) {
      if (!above && p > mean * 1.15) { bursts += 1; above = true; }
      if (above && p < mean * 0.95) above = false;
    }
    expect(bursts).toBeGreaterThanOrEqual(3);
    // And it genuinely recovers between them.
    expect(Math.min(...powers.slice(5))).toBeLessThan(mean * 0.9);
  });
});

describe('the Feinter, ridden', () => {
  it('throws bluffs that are gone before you could answer them', () => {
    const { samples } = ride(FEINTER, flat(0.9 * PROFILE.ftpWatts));
    const powers = samples.map((s) => s.rivalPower);
    const base = powers[3]!;

    // Find every excursion and measure how long it lasted.
    const durations: number[] = [];
    let start = -1;
    for (let i = 0; i < powers.length; i++) {
      const hot = powers[i]! > base * 1.25;
      if (hot && start < 0) start = i;
      if (!hot && start >= 0) { durations.push(i - start); start = -1; }
    }
    if (start >= 0) durations.push(powers.length - start);

    // Some die inside a few seconds (the bluffs) and some do not (the real
    // moves). Both kinds must be present or the rival has no tell to read.
    expect(durations.some((d) => d <= 4)).toBe(true);
    expect(durations.some((d) => d >= 8)).toBe(true);
  });
});

describe('the Wheelsucker, ridden', () => {
  it('never comes past, however slowly the player rides', () => {
    const { samples } = ride(WHEELSUCKER, flat(0.45 * PROFILE.ftpWatts));
    const beforeTheJump = samples.filter(
      (s) => s.rivalDistance < 0.88 * RACE_DISTANCE_M,
    );
    expect(beforeTheJump.length).toBeGreaterThan(30);
    for (const s of beforeTheJump) {
      // gap = player - rival; she is behind whenever this is not negative.
      expect(s.gap).toBeGreaterThan(-0.5);
    }
  });

  it('sits in the shelter rather than merely trailing', () => {
    const { samples } = ride(WHEELSUCKER, flat(0.85 * PROFILE.ftpWatts));
    const settled = samples.filter((s) => s.t > 15 && s.rivalDistance < 800);
    const sheltered = settled.filter(
      (s) => s.gap >= DRAFT_MIN_M && s.gap <= DRAFT_MAX_M,
    );
    expect(sheltered.length / settled.length).toBeGreaterThan(0.5);
  });

  it('jumps very late, and beats a rider who leaves it too long', () => {
    const led = ride(WHEELSUCKER, flat(0.85 * PROFILE.ftpWatts)).state;
    expect(led.winner).toBe('rival');
  });

  it('is beaten by jumping first', () => {
    const jumped = ride(WHEELSUCKER, (s) =>
      (s.player.distance > 830 ? 1.85 : 0.8) * PROFILE.ftpWatts).state;
    expect(jumped.winner).toBe('player');
  });
});

describe('the Champion, ridden', () => {
  it('covers the player instead of riding to a script', () => {
    const attacked = ride(CHAMPION, (s) =>
      (s.elapsed % 20 < 8 ? 1.35 : 0.85) * PROFILE.ftpWatts);
    const steady = ride(CHAMPION, flat(1.0 * PROFILE.ftpWatts));
    // The same rival, two different races: her power history must differ.
    const a = attacked.samples.map((s) => Math.round(s.rivalPower));
    const b = steady.samples.map((s) => Math.round(s.rivalPower));
    expect(a.slice(0, 20)).not.toEqual(b.slice(0, 20));
  });

  it('goes when the player eases off', () => {
    const eased = ride(CHAMPION, flat(0.6 * PROFILE.ftpWatts));
    const pushed = ride(CHAMPION, flat(1.0 * PROFILE.ftpWatts));
    const meanPower = (ss: Sample[]): number =>
      ss.reduce((a, s) => a + s.rivalPower, 0) / ss.length;
    expect(meanPower(eased.samples)).toBeGreaterThan(
      meanPower(pushed.samples) * 1.05,
    );
  });

  it('is the hardest rung — she beats what beats the Diesel', () => {
    const dieselPlan = (s: RaceState): number => {
      if (s.player.distance > 880) return 1.5 * PROFILE.ftpWatts;
      return s.gap < -3 ? 0.55 * PROFILE.ftpWatts : 0.9 * PROFILE.ftpWatts;
    };
    expect(ride(DIESEL, dieselPlan).state.winner).toBe('player');
    expect(ride(CHAMPION, dieselPlan).state.winner).toBe('rival');
  });
});
