import { describe, expect, it } from 'vitest';
import {
  PX_PER_M_MAX, PX_PER_M_MIN, pointOnOval, targetScale,
} from '../src/render.js';

/**
 * Only the pure geometry the view is built on. Drawing itself is not tested —
 * but a camera that does not pull back, or an oval that is not a loop, are
 * arithmetic mistakes rather than taste, and they are cheap to catch.
 */

describe('the camera', () => {
  it('stays at full zoom while the riders are together', () => {
    expect(targetScale(0, 1400)).toBe(PX_PER_M_MAX);
    expect(targetScale(2, 1400)).toBe(PX_PER_M_MAX);
  });

  it('pulls back as the gap opens, so nobody leaves the frame', () => {
    const near = targetScale(10, 1400);
    const far = targetScale(60, 1400);
    expect(far).toBeLessThan(near);
    expect(60 * far).toBeLessThan(1400);
  });

  it('never zooms below the floor', () => {
    expect(targetScale(100000, 1400)).toBe(PX_PER_M_MIN);
  });

  it('is symmetric — being 40 m down looks like being 40 m up', () => {
    expect(targetScale(-40, 1400)).toBe(targetScale(40, 1400));
  });
});

describe('the track map', () => {
  it('is a closed loop', () => {
    const start = pointOnOval(0, 100, 100, 60, 24);
    const end = pointOnOval(1, 100, 100, 60, 24);
    expect(end.x).toBeCloseTo(start.x, 6);
    expect(end.y).toBeCloseTo(start.y, 6);
  });

  it('wraps rather than running off, so lap 4 is still on the oval', () => {
    const a = pointOnOval(0.25, 100, 100, 60, 24);
    const b = pointOnOval(3.25, 100, 100, 60, 24);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('keeps every point inside the oval it is drawn in', () => {
    for (let i = 0; i < 200; i++) {
      const p = pointOnOval(i / 200, 100, 100, 60, 24);
      expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(60.0001);
      expect(Math.abs(p.y - 100)).toBeLessThanOrEqual(24.0001);
    }
  });

  it('goes round once without doubling back', () => {
    // A stadium traversed at constant arc length: consecutive samples are
    // evenly spaced. A doubled-back or discontinuous path would not be.
    let previous = pointOnOval(0, 100, 100, 60, 24);
    const steps: number[] = [];
    for (let i = 1; i <= 240; i++) {
      const p = pointOnOval(i / 240, 100, 100, 60, 24);
      steps.push(Math.hypot(p.x - previous.x, p.y - previous.y));
      previous = p;
    }
    const min = Math.min(...steps);
    const max = Math.max(...steps);
    expect(max - min).toBeLessThan(0.02);
  });
});
