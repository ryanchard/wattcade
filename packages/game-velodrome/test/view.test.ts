import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { createRace } from '../src/race.js';
import type { RaceState } from '../src/race.js';
import { CHAMPION } from '../src/rivals.js';
import {
  PX_PER_M_MAX, PX_PER_M_MIN, SCROLL_PX_PER_M, ZOOM_KNEE_M,
  createRenderState, farTopAt, leanFor, pointOnOval, targetScale,
  updateRenderState,
} from '../src/render.js';

/**
 * Only the pure geometry the view is built on. Drawing itself is not tested —
 * but a camera that pulls the world's speed around with it, an oval that is
 * not a loop, or a far side that does not bend away, are arithmetic mistakes
 * rather than taste, and they are cheap to catch.
 */

const WIDTH = 1400;
const HEIGHT = 800;

function raceAt(gap: number, speed: number): RaceState {
  const s = createRace({ ...DEFAULT_RIDER, ftpWatts: 240 }, CHAMPION);
  s.gap = gap;
  s.player.speed = speed;
  s.player.powerCurrent = 300;
  return s;
}

describe('the camera', () => {
  it('stays at full zoom while the riders are racing each other', () => {
    expect(targetScale(0, WIDTH)).toBe(PX_PER_M_MAX);
    expect(targetScale(2, WIDTH)).toBe(PX_PER_M_MAX);
    expect(targetScale(15, WIDTH)).toBe(PX_PER_M_MAX);
  });

  it('eases back once the gap is properly open', () => {
    const near = targetScale(ZOOM_KNEE_M, WIDTH);
    const far = targetScale(60, WIDTH);
    expect(far).toBeLessThan(near);
  });

  it('never pulls back past two thirds of full scale', () => {
    expect(targetScale(100, WIDTH)).toBe(PX_PER_M_MIN);
    expect(targetScale(100000, WIDTH)).toBe(PX_PER_M_MIN);
    // The whole point: the world stays close to life size, and a rival past
    // what the frame holds is handled by the edge marker instead.
    expect(PX_PER_M_MIN / PX_PER_M_MAX).toBeGreaterThanOrEqual(2 / 3);
  });

  it('never zooms back in as the gap grows', () => {
    let previous = targetScale(0, WIDTH);
    for (let gap = 0; gap <= 400; gap += 5) {
      const scale = targetScale(gap, WIDTH);
      expect(scale).toBeLessThanOrEqual(previous + 1e-9);
      previous = scale;
    }
  });

  it('is symmetric — being 40 m down looks like being 40 m up', () => {
    expect(targetScale(-40, WIDTH)).toBe(targetScale(40, WIDTH));
  });
});

describe('the ground', () => {
  /**
   * THE REGRESSION GUARD. The boards used to scroll at `speed * scale`, so
   * opening a gap zoomed the camera out and slowed the whole world down: the
   * better you rode, the slower it looked. Ground scroll is now a function of
   * metres ridden and nothing else.
   */
  it('scrolls at the same rate per metre ridden whatever the gap', () => {
    const speed = 16;
    const dt = 0.1;
    const scrolls = [0, 50, 100, 200, 400].map((gap) => {
      const r = createRenderState();
      const s = raceAt(gap, speed);
      let scrolled = 0;
      let previous = r.scroll;
      for (let i = 0; i < 20; i++) {
        updateRenderState(r, s, WIDTH, HEIGHT, dt);
        scrolled += r.scroll - previous;
        previous = r.scroll;
      }
      return scrolled;
    });

    const together = scrolls[0]!;
    // Twenty steps at 16 m/s is 32 m of track, at the fixed reference.
    expect(together).toBeCloseTo(32 * SCROLL_PX_PER_M, 6);
    for (const scrolled of scrolls) expect(scrolled).toBeCloseTo(together, 6);
  });

  it('scrolls in proportion to speed', () => {
    const step = (speed: number): number => {
      const r = createRenderState();
      updateRenderState(r, raceAt(0, speed), WIDTH, HEIGHT, 0.1);
      return r.scroll;
    };
    expect(step(20)).toBeCloseTo(step(10) * 2, 6);
  });
});

describe('the bowl', () => {
  it('bends the far side away at both ends of the frame', () => {
    const middle = farTopAt(WIDTH / 2, WIDTH, HEIGHT);
    const left = farTopAt(0, WIDTH, HEIGHT);
    const right = farTopAt(WIDTH, WIDTH, HEIGHT);
    // Further away is higher up the screen.
    expect(left).toBeLessThan(middle);
    expect(right).toBeLessThan(middle);
    expect(left).toBeCloseTo(right, 6);
    // And the bend is worth seeing, not a couple of pixels.
    expect(middle - left).toBeGreaterThan(HEIGHT * 0.15);
  });

  it('keeps the far straight flat through the middle of the frame', () => {
    const middle = farTopAt(WIDTH / 2, WIDTH, HEIGHT);
    const nearMiddle = farTopAt(WIDTH * 0.42, WIDTH, HEIGHT);
    expect(Math.abs(nearMiddle - middle)).toBeLessThan(HEIGHT * 0.02);
  });
});

describe('the lean', () => {
  it('is upright on both straights', () => {
    expect(leanFor(0)).toBeCloseTo(0, 6);
    expect(leanFor(0.5)).toBeCloseTo(0, 6);
    expect(leanFor(1)).toBeCloseTo(0, 6);
  });

  it('tips fully, and opposite ways, in the two bends', () => {
    expect(leanFor(0.25)).toBeCloseTo(1, 6);
    expect(leanFor(0.75)).toBeCloseTo(-1, 6);
  });

  it('never exceeds full lean', () => {
    for (let i = 0; i <= 200; i++) expect(Math.abs(leanFor(i / 200))).toBeLessThanOrEqual(1);
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
