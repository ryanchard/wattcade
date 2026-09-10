import { describe, expect, it } from 'vitest';
import { BLOCK_LENGTH_M } from '@paperboy/game-core';
import {
  PX_PER_M, fromBodyX, fromBodyY, project, toBodyX, toBodyY,
} from '../src/iso.js';
import { BlockStreamer, surfaceCrr } from '../src/logic/entities.js';

describe('world-space body coordinates', () => {
  it('round-trips distance through the body x axis', () => {
    expect(fromBodyX(toBodyX(137.5))).toBeCloseTo(137.5, 6);
  });

  it('round-trips lateral through the body y axis', () => {
    expect(fromBodyY(toBodyY(4.25))).toBeCloseTo(4.25, 6);
  });

  it('scales by the documented pixels-per-metre', () => {
    expect(toBodyX(10)).toBe(10 * PX_PER_M);
  });
});

describe('project', () => {
  it('puts the camera point at the origin', () => {
    expect(project(100, 0, 0, 100)).toEqual({ x: 0, y: 0 });
  });

  it('moves up and right as distance increases', () => {
    const near = project(100, 4, 0, 100);
    const far = project(140, 4, 0, 100);
    expect(far.x).toBeGreaterThan(near.x);
    expect(far.y).toBeLessThan(near.y);
  });

  it('raises an object as its height grows', () => {
    expect(project(100, 4, 2, 100).y).toBeLessThan(project(100, 4, 0, 100).y);
  });
});

describe('BlockStreamer', () => {
  it('emits entities for the road ahead on first update', () => {
    const s = new BlockStreamer(42);
    const { added } = s.update(0);
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((e) => e.kind === 'house')).toBe(true);
  });

  it('emits nothing new when the rider has not moved', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    expect(s.update(0).added).toHaveLength(0);
  });

  it('emits more entities as the rider advances', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    expect(s.update(BLOCK_LENGTH_M * 4).added.length).toBeGreaterThan(0);
  });

  it('reports removals for entities left behind', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    const { removed } = s.update(BLOCK_LENGTH_M * 8);
    expect(removed.length).toBeGreaterThan(0);
  });

  it('never emits the same id twice', () => {
    const s = new BlockStreamer(42);
    const seen = new Set<string>();
    for (let d = 0; d < BLOCK_LENGTH_M * 20; d += 40) {
      for (const e of s.update(d).added) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
    }
  });

  it('generates the same route as any other streamer on the same seed', () => {
    const a = new BlockStreamer(42);
    const b = new BlockStreamer(42);
    expect(a.update(500).added.map((e) => e.id))
      .toEqual(b.update(500).added.map((e) => e.id));
  });

  it('reports the grade of the block the rider is on', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    expect(s.gradeAt(10)).toBe(s.blocks[0]!.gradePercent);
    expect(s.gradeAt(BLOCK_LENGTH_M + 10)).toBe(s.blocks[1]!.gradePercent);
  });
});

describe('surfaceCrr', () => {
  it('is slow on the lawn and fast on the sidewalk', () => {
    expect(surfaceCrr(2.2)).toBeGreaterThan(surfaceCrr(3.8));
  });

  it('penalises the curb', () => {
    expect(surfaceCrr(5.0)).toBeGreaterThan(surfaceCrr(7.0));
  });
});
