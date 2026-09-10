import { describe, expect, it } from 'vitest';
import {
  CADENCE_MISSING_BODY, CADENCE_MISSING_HEADLINE, CADENCE_TIMEOUT_S,
  MAX_PLAUSIBLE_RPM, cadenceStalled, createCadenceTracker, readCadence,
  steeringRpm, tickCadence,
} from '../src/cadence.js';

const DT = 1 / 120;

function run(c: ReturnType<typeof createCadenceTracker>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) tickCadence(c, DT);
}

describe('createCadenceTracker', () => {
  it('starts with no reading, and not yet declared missing', () => {
    const c = createCadenceTracker();
    expect(c.rpm).toBeNull();
    expect(c.missing).toBe(false);
  });
});

describe('readCadence', () => {
  it('takes a plausible reading as-is', () => {
    const c = createCadenceTracker();
    readCadence(c, 92.5);
    expect(c.rpm).toBe(92.5);
  });

  it('keeps a genuine zero, because not pedalling is a real reading', () => {
    const c = createCadenceTracker();
    readCadence(c, 0);
    expect(c.rpm).toBe(0);
  });

  it('rejects a glitch rather than clamping it into a steering input', () => {
    const c = createCadenceTracker();
    for (const bad of [null, Number.NaN, -1, MAX_PLAUSIBLE_RPM + 1]) {
      readCadence(c, bad);
      expect(c.rpm).toBeNull();
    }
  });
});

describe('the grace period', () => {
  it('rides out a dropped notification without declaring anything', () => {
    const c = createCadenceTracker();
    readCadence(c, 80);
    readCadence(c, null);
    run(c, CADENCE_TIMEOUT_S * 0.6);
    expect(c.missing).toBe(false);
  });

  it('declares the reading missing once the timeout passes', () => {
    const c = createCadenceTracker();
    readCadence(c, null);
    run(c, CADENCE_TIMEOUT_S + 0.1);
    expect(c.missing).toBe(true);
  });

  it('recovers the instant a reading comes back', () => {
    const c = createCadenceTracker();
    run(c, CADENCE_TIMEOUT_S + 1);
    expect(c.missing).toBe(true);
    readCadence(c, 78);
    expect(c.missing).toBe(false);
    expect(c.sinceReading).toBe(0);
  });

  it('does not let the silence counter run away', () => {
    const c = createCadenceTracker();
    run(c, 600);
    expect(c.sinceReading).toBeLessThanOrEqual(CADENCE_TIMEOUT_S * 2);
  });
});

describe('cadenceStalled', () => {
  it('is true before the first reading has ever arrived', () => {
    const c = createCadenceTracker();
    expect(c.everRead).toBe(false);
    expect(cadenceStalled(c)).toBe(true);
    // ...even though there is nothing to put on screen yet.
    expect(c.missing).toBe(false);
  });

  it('is false through a dropped notification after a real reading', () => {
    const c = createCadenceTracker();
    readCadence(c, 84);
    readCadence(c, null);
    run(c, CADENCE_TIMEOUT_S * 0.6);
    expect(cadenceStalled(c)).toBe(false);
  });

  it('is true again once the silence outlasts the grace period', () => {
    const c = createCadenceTracker();
    readCadence(c, 84);
    readCadence(c, null);
    run(c, CADENCE_TIMEOUT_S + 0.1);
    expect(cadenceStalled(c)).toBe(true);
  });
});

describe('steeringRpm', () => {
  it('uses the real reading when there is one', () => {
    const c = createCadenceTracker();
    readCadence(c, 96);
    expect(steeringRpm(c, 80)).toBe(96);
  });

  it('falls back while there is not, so a dropped packet holds steady', () => {
    const c = createCadenceTracker();
    expect(steeringRpm(c, 80)).toBe(80);
  });
});

describe('what the rider is told', () => {
  it('names the trainer as the thing that is not reporting', () => {
    expect(CADENCE_MISSING_HEADLINE.toLowerCase()).toContain('cadence');
    expect(CADENCE_MISSING_BODY.toLowerCase()).toContain('trainer');
  });
});
