import { describe, expect, it } from 'vitest';
import {
  CP_FRACTION_OF_FTP, FADE_FROM_FRACTION, SPRINT_MULTIPLE_FALLBACK,
  W_PRIME_MAX_J, W_PRIME_MIN_J,
  advanceWPrime, createWPrime, criticalPower, nextWPrimeBalance, recoveryTauS,
  seededWPrimeJoules, sprintPowerOf, sustainablePower, wPrimeCapacity,
  wPrimeFraction,
} from '../src/fatigue.js';
import type { AnaerobicRider } from '../src/fatigue.js';

/** The owner's numbers, which every worked example in the design notes uses. */
const OWNER: AnaerobicRider = { ftpWatts: 235, sprintWatts: 1184 };
/** The shipped default rider. */
const DEFAULT: AnaerobicRider = { ftpWatts: 200, sprintWatts: 700 };

/** Run a battery at a fixed power for `seconds`, at `dt`, and say what is
 * left. The whole model in one helper, so the tests read as arithmetic. */
function hold(
  rider: AnaerobicRider, watts: number, seconds: number,
  dt = 1 / 120, startJ?: number,
): number {
  const s = createWPrime(rider);
  if (startJ !== undefined) s.balanceJ = startJ;
  const cp = criticalPower(rider);
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) advanceWPrime(s, watts, cp, dt);
  return s.balanceJ;
}

describe('critical power', () => {
  it('is FTP, which is the number the rider already knows', () => {
    expect(criticalPower(OWNER)).toBe(235 * CP_FRACTION_OF_FTP);
    expect(criticalPower({ ftpWatts: 0 })).toBeGreaterThan(0);
  });
});

describe('sizing the store', () => {
  it('gives the owner the 22 kJ every worked example assumes', () => {
    // FTP 235, five-second 1184: a 5.0x spread, an elite sprinter's.
    expect(seededWPrimeJoules(OWNER)).toBeCloseTo(22000, -2);
  });

  it('gives the default rider a mid-range 15 kJ', () => {
    expect(seededWPrimeJoules(DEFAULT)).toBeCloseTo(15000, -2);
  });

  it('is bigger for a bigger sprint on the same FTP', () => {
    const diesel = seededWPrimeJoules({ ftpWatts: 300, sprintWatts: 750 });
    const sprinter = seededWPrimeJoules({ ftpWatts: 300, sprintWatts: 1500 });
    expect(sprinter).toBeGreaterThan(diesel * 1.3);
  });

  it('estimates a sprint from FTP when the rider has not entered one', () => {
    expect(sprintPowerOf({ ftpWatts: 200 }))
      .toBe(200 * SPRINT_MULTIPLE_FALLBACK);
    // ...and never believes a sprint weaker than an hour effort.
    expect(sprintPowerOf({ ftpWatts: 300, sprintWatts: 120 })).toBe(300);
  });

  it('prefers the figure the rider entered themselves', () => {
    expect(wPrimeCapacity({ ...OWNER, wPrimeJoules: 18500 })).toBe(18500);
    // ...but not a nonsense one.
    expect(wPrimeCapacity({ ...OWNER, wPrimeJoules: 5_000_000 }))
      .toBe(W_PRIME_MAX_J);
    expect(wPrimeCapacity({ ...OWNER, wPrimeJoules: 12 })).toBe(W_PRIME_MIN_J);
    expect(wPrimeCapacity({ ...OWNER, wPrimeJoules: Number.NaN }))
      .toBeCloseTo(22000, -2);
  });

  it('clamps the seed rather than inventing a battery from a typo', () => {
    const absurd = seededWPrimeJoules({ ftpWatts: 235, sprintWatts: 2500 });
    expect(absurd).toBeLessThan(235 * 131);
  });
});

describe('depletion above threshold', () => {
  // Every row of the table in the design notes, to the second.
  const cases: [watts: number, drainW: number, emptiesInS: number][] = [
    [350, 115, 22000 / 115],
    [500, 265, 22000 / 265],
    [800, 565, 22000 / 565],
    [1184, 949, 22000 / 949],
  ];

  for (const [watts, drainW, emptiesInS] of cases) {
    it(`drains at (P - CP) = ${drainW} W at ${watts} W`, () => {
      const rider = { ...OWNER, wPrimeJoules: 22000 };
      const after10 = hold(rider, watts, 10);
      expect(22000 - after10).toBeCloseTo(drainW * 10, 6);
      // ...and is empty, not negative, at the moment the arithmetic says.
      expect(hold(rider, watts, emptiesInS * 0.99)).toBeGreaterThan(0);
      expect(hold(rider, watts, emptiesInS * 1.01)).toBe(0);
    });
  }

  it('spends nothing at all at or below critical power', () => {
    const rider = { ...OWNER, wPrimeJoules: 22000 };
    expect(hold(rider, 235, 300)).toBe(22000);
    expect(hold(rider, 100, 300)).toBe(22000);
  });

  it('costs about a third of the store for a full-gas 200 m finish', () => {
    // 200 m at track speed is ~13 s. The design notes call this 8.6 kJ.
    const rider = { ...OWNER, wPrimeJoules: 22000 };
    const spent = 22000 - hold(rider, 900, 13);
    expect(spent / 22000).toBeGreaterThan(0.3);
    expect(spent / 22000).toBeLessThan(0.45);
  });
});

describe('recovery below threshold', () => {
  it('is far slower than depletion, which is the whole point', () => {
    const rider = { ...OWNER, wPrimeJoules: 22000 };
    // 20 s at 500 W costs 5.3 kJ.
    const spent = 22000 - hold(rider, 500, 20);
    expect(spent).toBeCloseTo(5300, -2);
    // 20 s of soft pedalling at 120 W does not give it back.
    const back = hold(rider, 120, 20, 1 / 120, 22000 - spent) - (22000 - spent);
    expect(back).toBeLessThan(spent * 0.25);
  });

  it('refills faster the further below CP the rider drops', () => {
    expect(recoveryTauS(0)).toBeGreaterThan(recoveryTauS(100));
    expect(recoveryTauS(100)).toBeGreaterThan(recoveryTauS(235));
    // Skiba's constants, scaled: 546 x e^(-0.01 x DCP) + 316, over three.
    expect(recoveryTauS(0)).toBeCloseTo((546 + 316) / 3, 6);
    expect(recoveryTauS(235)).toBeCloseTo(
      (546 * Math.exp(-2.35) + 316) / 3, 6,
    );
    // Negative "below CP" is meaningless; treat it as sitting on the line.
    expect(recoveryTauS(-50)).toBe(recoveryTauS(0));
  });

  it('is exponential toward full, so it never overfills', () => {
    const rider = { ...OWNER, wPrimeJoules: 22000 };
    expect(hold(rider, 0, 3600, 1 / 10, 0)).toBeCloseTo(22000, 6);
    expect(hold(rider, 0, 3600, 1 / 10, 21999)).toBeLessThanOrEqual(22000);
  });

  it('is one time constant from empty to 63% full', () => {
    const rider = { ...OWNER, wPrimeJoules: 22000 };
    const tau = recoveryTauS(235); // coasting, CP 235
    const after = hold(rider, 0, tau, 1 / 120, 0);
    expect(after / 22000).toBeCloseTo(1 - Math.exp(-1), 3);
  });
});

describe('the store as a quantity', () => {
  it('never goes negative and never exceeds W-prime', () => {
    const rider = { ...OWNER, wPrimeJoules: 22000 };
    const s = createWPrime(rider);
    const cp = criticalPower(rider);
    // A pathological sequence: enormous efforts, long rests, silly timesteps.
    const powers = [2000, 0, 5000, 10, 235, 1500, 60, 0, 900, 3000];
    for (let i = 0; i < 400; i++) {
      const p = powers[i % powers.length]!;
      advanceWPrime(s, p, cp, (i % 7) * 0.5);
      expect(s.balanceJ).toBeGreaterThanOrEqual(0);
      expect(s.balanceJ).toBeLessThanOrEqual(22000);
    }
  });

  it('reports the fraction that is left', () => {
    const s = createWPrime({ ...OWNER, wPrimeJoules: 22000 });
    expect(wPrimeFraction(s)).toBe(1);
    s.balanceJ = 11000;
    expect(wPrimeFraction(s)).toBe(0.5);
    s.balanceJ = 0;
    expect(wPrimeFraction(s)).toBe(0);
  });

  it('ignores nonsense inputs rather than corrupting itself', () => {
    expect(nextWPrimeBalance(1000, 22000, Number.NaN, 235, 1)).toBe(1000);
    expect(nextWPrimeBalance(1000, 22000, 400, 235, 0)).toBe(1000);
    expect(nextWPrimeBalance(-5, 22000, 400, 235, 1)).toBe(0);
    expect(nextWPrimeBalance(99999, 22000, 400, 235, 1))
      .toBeCloseTo(22000 - 165, 6);
  });
});

describe('determinism', () => {
  it('does not depend on the size of the timestep', () => {
    const rider = { ...OWNER, wPrimeJoules: 22000 };
    for (const watts of [0, 90, 200, 235, 400, 900]) {
      const fine = hold(rider, watts, 60, 1 / 240, 6000);
      const coarse = hold(rider, watts, 60, 1 / 2, 6000);
      expect(fine).toBeCloseTo(coarse, 6);
    }
  });

  it('replays identically for the same power sequence', () => {
    const run = (): number[] => {
      const s = createWPrime(OWNER);
      const out: number[] = [];
      for (let i = 0; i < 2000; i++) {
        advanceWPrime(s, 200 + ((i * 37) % 900), criticalPower(OWNER), 1 / 120);
        out.push(s.balanceJ);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('the fade', () => {
  const cp = 235;

  it('does nothing at all while there is plenty left', () => {
    expect(sustainablePower(1184, cp, 1)).toBe(1184);
    expect(sustainablePower(1184, cp, FADE_FROM_FRACTION)).toBe(1184);
    expect(sustainablePower(1184, cp, 0.5)).toBe(1184);
  });

  it('takes the sprint away as the store empties', () => {
    expect(sustainablePower(1184, cp, FADE_FROM_FRACTION / 2))
      .toBeCloseTo(cp + (1184 - cp) / 2, 6);
    expect(sustainablePower(1184, cp, 0)).toBe(cp);
  });

  it('never touches anything at or below critical power', () => {
    // A spent rider can still ride tempo forever. They just cannot kick.
    expect(sustainablePower(cp, cp, 0)).toBe(cp);
    expect(sustainablePower(100, cp, 0)).toBe(100);
    expect(sustainablePower(0, cp, 0)).toBe(0);
  });

  it('turns the last of the store into a tail rather than a cliff', () => {
    // Because the drain is taken from the FADED power, a sprint on a nearly
    // empty store dies away over a few seconds instead of switching off.
    const rider: AnaerobicRider = { ftpWatts: 235, wPrimeJoules: 22000 };
    const s = createWPrime(rider);
    s.balanceJ = 22000 * FADE_FROM_FRACTION;
    const dt = 1 / 120;
    const powers: number[] = [];
    for (let i = 0; i < 120 * 15; i++) {
      const p = sustainablePower(1184, cp, wPrimeFraction(s));
      powers.push(p);
      advanceWPrime(s, p, cp, dt);
    }
    expect(powers[0]).toBe(1184);
    // Still meaningfully above CP after a second...
    expect(powers[120]!).toBeGreaterThan(cp + 300);
    // ...and effectively gone by fifteen.
    expect(powers[powers.length - 1]!).toBeLessThan(cp + 60);
    // Monotonic: the legs go, they do not flicker.
    for (let i = 1; i < powers.length; i++) {
      expect(powers[i]!).toBeLessThanOrEqual(powers[i - 1]!);
    }
  });
});
