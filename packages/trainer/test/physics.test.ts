import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RIDER,
  stepPhysics,
  steadyStateSpeed,
} from '../src/physics.js';
import type { PhysicsState } from '../src/physics.js';

const flat = (powerWatts: number, crr = DEFAULT_RIDER.crr) => ({
  powerWatts, gradePercent: 0, crr, headwind: 0,
});

/** Integrate for `seconds` and return the resulting state. */
function settle(power: number, gradePercent: number, seconds = 400): PhysicsState {
  let s: PhysicsState = { speed: 0.5, distance: 0 };
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    s = stepPhysics(
      s,
      { powerWatts: power, gradePercent, crr: DEFAULT_RIDER.crr, headwind: 0 },
      DEFAULT_RIDER,
      dt,
    );
  }
  return s;
}

describe('stepPhysics', () => {
  it('settles 200 W on the flat in the low 30s km/h', () => {
    // Hand check: 194 W at the wheel against
    //   Crr*m*g = 0.005*85*9.80665 = 4.168 N
    //   0.5*rho*CdA = 0.196 kg/m
    // solves near 9.26 m/s = 33.3 km/h, which matches real-world road riding.
    const v = settle(200, 0).speed;
    expect(v).toBeGreaterThan(9.0);
    expect(v).toBeLessThan(9.5);
  });

  it('agrees with the closed-form steady state', () => {
    const integrated = settle(250, 0).speed;
    const closed = steadyStateSpeed(250, 0, DEFAULT_RIDER);
    expect(integrated).toBeCloseTo(closed, 1);
  });

  it('goes slower uphill than on the flat for the same power', () => {
    expect(settle(200, 4).speed).toBeLessThan(settle(200, 0).speed);
  });

  it('goes faster downhill than on the flat for the same power', () => {
    expect(settle(200, -4).speed).toBeGreaterThan(settle(200, 0).speed);
  });

  it('is monotonic in power', () => {
    const speeds = [100, 200, 300, 400].map((p) => settle(p, 0).speed);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    }
  });

  it('decays to a crawl when power stops', () => {
    // Coasting from 12 m/s on the flat, rolling resistance alone takes
    // about 113 s to bring the rider to a stop -- at 60 s they are still
    // doing nearly 3 m/s. Two minutes is the honest duration here.
    let s: PhysicsState = { speed: 12, distance: 0 };
    for (let i = 0; i < 60 * 120; i++) {
      s = stepPhysics(s, flat(0), DEFAULT_RIDER, 1 / 60);
    }
    expect(s.speed).toBeLessThan(1);
    expect(s.speed).toBeGreaterThanOrEqual(0);
  });

  it('never produces a negative speed', () => {
    let s: PhysicsState = { speed: 0.2, distance: 0 };
    for (let i = 0; i < 600; i++) {
      s = stepPhysics(s, { powerWatts: 0, gradePercent: 8, crr: 0.02, headwind: 5 },
        DEFAULT_RIDER, 1 / 60);
    }
    expect(s.speed).toBeGreaterThanOrEqual(0);
  });

  it('slows the rider when rolling resistance spikes, as on grass', () => {
    const road = settle(200, 0).speed;
    let s: PhysicsState = { speed: road, distance: 0 };
    for (let i = 0; i < 120; i++) {
      s = stepPhysics(s, flat(200, 0.02), DEFAULT_RIDER, 1 / 60);
    }
    expect(s.speed).toBeLessThan(road);
  });

  it('accumulates distance as the integral of speed', () => {
    let s: PhysicsState = { speed: 10, distance: 0 };
    for (let i = 0; i < 60; i++) {
      s = stepPhysics(s, flat(0), DEFAULT_RIDER, 1 / 60);
    }
    // One second at roughly 10 m/s, decaying slightly.
    expect(s.distance).toBeGreaterThan(9);
    expect(s.distance).toBeLessThan(10);
  });

  it('is stable at a large timestep', () => {
    let s: PhysicsState = { speed: 0.5, distance: 0 };
    for (let i = 0; i < 200; i++) {
      s = stepPhysics(s, flat(400), DEFAULT_RIDER, 0.25);
    }
    expect(Number.isFinite(s.speed)).toBe(true);
    expect(s.speed).toBeLessThan(30);
  });
});
