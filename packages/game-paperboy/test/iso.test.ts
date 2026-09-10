import { describe, expect, it } from 'vitest';
import { DEFAULT_ISO, depthKey, worldToScreen } from '../src/iso.js';

const cam = { distance: 100 };
const at = (d: number, l: number, h = 0) =>
  worldToScreen(d, l, h, cam, { ...DEFAULT_ISO, originX: 0, originY: 0 });

describe('worldToScreen', () => {
  it('puts a point at the camera distance and zero lateral at the origin', () => {
    expect(at(100, 0)).toEqual({ x: 0, y: 0 });
  });

  it('offsets by the configured screen origin', () => {
    const p = worldToScreen(100, 0, 0, cam, {
      ...DEFAULT_ISO, originX: 400, originY: 300,
    });
    expect(p).toEqual({ x: 400, y: 300 });
  });

  it('moves up and to the right as distance increases', () => {
    const near = at(100, 4);
    const far = at(140, 4);
    expect(far.x).toBeGreaterThan(near.x);
    expect(far.y).toBeLessThan(near.y);
  });

  it('moves down and to the right as lateral increases', () => {
    const inner = at(100, 2);
    const outer = at(100, 8);
    expect(outer.x).toBeGreaterThan(inner.x);
    expect(outer.y).toBeGreaterThan(inner.y);
  });

  it('raises a point on screen as its height grows', () => {
    expect(at(100, 4, 3).y).toBeLessThan(at(100, 4, 0).y);
  });

  it('is linear, so a midpoint projects to the midpoint', () => {
    const a = at(100, 0);
    const b = at(120, 6);
    const mid = at(110, 3);
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(mid.y).toBeCloseTo((a.y + b.y) / 2, 6);
  });

  it('translates with the camera rather than deforming', () => {
    const p1 = worldToScreen(120, 4, 0, { distance: 100 }, DEFAULT_ISO);
    const p2 = worldToScreen(140, 4, 0, { distance: 120 }, DEFAULT_ISO);
    expect(p1).toEqual(p2);
  });
});

describe('depthKey', () => {
  it('sorts a nearer-to-viewer entity after a further one', () => {
    // Same distance: larger lateral is nearer the viewer, so draws later.
    expect(depthKey(100, 8)).toBeGreaterThan(depthKey(100, 1));
  });

  it('sorts an entity further up the street before one behind it', () => {
    expect(depthKey(140, 4)).toBeLessThan(depthKey(100, 4));
  });

  it('gives the same ordering as projected screen y', () => {
    const items = [
      { d: 100, l: 1 }, { d: 130, l: 8 }, { d: 100, l: 8 }, { d: 115, l: 4 },
    ];
    const byDepth = [...items].sort(
      (a, b) => depthKey(a.d, a.l) - depthKey(b.d, b.l),
    );
    const byScreen = [...items].sort(
      (a, b) => at(a.d, a.l).y - at(b.d, b.l).y,
    );
    expect(byDepth).toEqual(byScreen);
  });
});
