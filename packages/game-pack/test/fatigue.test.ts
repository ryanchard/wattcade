import { describe, expect, it } from 'vitest';
import { criticalPower, wPrimeCapacity } from '@paperboy/game-core';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import type { RiderProfile } from '@paperboy/game-api';
import {
  FIXED_DT, SHAKE_HOLD_DURATION_S,
  advance, createSession, setPower, shakeCostJoules, shakeThreshold,
  toRunResult,
} from '../src/session.js';
import type { Session } from '../src/session.js';

const RIDER: RiderProfile = { ...DEFAULT_RIDER, ftpWatts: 235, sprintWatts: 1184 };
const STORE = wPrimeCapacity(RIDER);
const CP = criticalPower(RIDER);

/** Hold a power for `seconds`. Returns the session for further poking. */
function hold(s: Session, watts: number, seconds: number): Session {
  for (let i = 0; i < Math.round(seconds / FIXED_DT) && !s.caught; i++) {
    setPower(s, watts);
    s.powerCurrent = watts; // no second ease; the shell owns that one
    advance(s, FIXED_DT);
  }
  return s;
}

describe('what a dog costs', () => {
  it('is the watts above threshold, for as long as the shake takes', () => {
    // 1.3 x 235 = 305.5 W, of which 70.5 W is above critical power, for 4 s.
    expect(shakeThreshold(RIDER)).toBeCloseTo(305.5, 6);
    expect(shakeCostJoules(RIDER)).toBeCloseTo(70.5 * SHAKE_HOLD_DURATION_S, 6);
    expect(shakeCostJoules(RIDER)).toBeCloseTo(282, 0);
  });

  it('is cheap on its own — the ride between them is what empties you', () => {
    // One shake is barely 1% of the store. Ten is a tenth of it. The budget
    // comes from holding the pack off with the dogs still attached.
    expect(shakeCostJoules(RIDER) / STORE).toBeLessThan(0.02);
  });

  it('actually comes out of the store when a dog is thrown', () => {
    const s = createSession(RIDER);
    hold(s, CP, 25); // let one latch on without touching the store
    expect(s.dogs).toBe(1);
    expect(s.wPrime.balanceJ).toBe(STORE);

    hold(s, shakeThreshold(RIDER), SHAKE_HOLD_DURATION_S + 0.1);
    expect(s.dogsShaken).toBe(1);
    // The 0.1 s of overshoot is the test's, not the model's.
    const spent = STORE - s.wPrime.balanceJ;
    expect(spent).toBeGreaterThanOrEqual(shakeCostJoules(RIDER));
    expect(spent).toBeLessThan(shakeCostJoules(RIDER) * 1.05);
  });
});

describe('a rider with nothing left', () => {
  it('cannot reach the threshold however hard they push', () => {
    const s = createSession(RIDER);
    hold(s, CP, 25);
    expect(s.dogs).toBeGreaterThan(0);
    // Empty the store.
    s.wPrime.balanceJ = 0;
    const shaken = s.dogsShaken;
    hold(s, 1200, SHAKE_HOLD_DURATION_S * 3);
    expect(s.powerCurrent).toBe(1200);
    // The legs are asking for 1200 W and producing critical power: the store
    // trickles back in at exactly the rate the fade lets it back out, which
    // is what an empty rider grinding away actually looks like.
    expect(s.powerEffective).toBeCloseTo(CP, 1);
    expect(s.powerEffective).toBeLessThan(shakeThreshold(RIDER));
    expect(s.dogsShaken).toBe(shaken);
    expect(s.shakeHoldS).toBe(0);
  });

  it('is slower on the road, not merely barred from shaking', () => {
    const fresh = hold(createSession(RIDER), 700, 20);
    const spent = createSession(RIDER);
    spent.wPrime.balanceJ = 0;
    hold(spent, 700, 20);
    expect(spent.distance).toBeLessThan(fresh.distance * 0.85);
  });

  it('can still ride tempo, because the aerobic supply does not run out', () => {
    const s = createSession(RIDER);
    s.wPrime.balanceJ = 0;
    hold(s, CP * 0.8, 30);
    expect(s.powerEffective).toBeCloseTo(CP * 0.8, 6);
  });
});

describe('the store over a whole run', () => {
  it('never goes negative and never exceeds the rider store', () => {
    for (const watts of [0, 120, 235, 400, 900, 2000]) {
      const s = createSession(RIDER);
      for (let i = 0; i < Math.round(400 / FIXED_DT) && !s.caught; i++) {
        setPower(s, watts);
        advance(s, FIXED_DT);
        expect(s.wPrime.balanceJ).toBeGreaterThanOrEqual(0);
        expect(s.wPrime.balanceJ).toBeLessThanOrEqual(STORE);
      }
    }
  });

  it('refills below threshold, far more slowly than it drained', () => {
    const s = createSession(RIDER);
    hold(s, 600, 20);
    const low = s.wPrime.balanceJ;
    const spent = STORE - low;
    expect(spent).toBeCloseTo((600 - CP) * 20, 0);
    hold(s, 100, 20);
    expect(s.wPrime.balanceJ - low).toBeLessThan(spent * 0.3);
    expect(s.wPrime.balanceJ - low).toBeGreaterThan(0);
  });

  it('replays identically for the same input sequence', () => {
    const run = (): string => {
      const s = createSession(RIDER);
      const out: number[] = [];
      for (let i = 0; i < Math.round(200 / FIXED_DT) && !s.caught; i++) {
        setPower(s, 150 + ((i * 13) % 800));
        advance(s, FIXED_DT);
        if (i % 600 === 0) out.push(s.wPrime.balanceJ, s.distance);
      }
      return `${s.dogsShaken}|${out.join(',')}`;
    };
    expect(run()).toBe(run());
  });

  it('reports what is left of it on the results card', () => {
    const s = createSession(RIDER);
    expect(toRunResult(s).batteryLeft).toBe(1);
    hold(s, 800, 30);
    const left = toRunResult(s).batteryLeft;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(0.4);
  });

  it('takes a store the rider entered themselves', () => {
    const s = createSession({ ...RIDER, wPrimeJoules: 30000 });
    expect(s.wPrime.capacityJ).toBe(30000);
  });
});
