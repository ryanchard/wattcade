import { describe, expect, it } from 'vitest';
import { depthKey } from '../src/iso.js';
import { createWorld, ensureBlocks } from '../src/world.js';
import { throwPaper } from '../src/rules.js';
import { collectDrawables } from '../src/render/drawables.js';

function populated() {
  const w = createWorld(42);
  ensureBlocks(w);
  w.rider.distance = 60;
  throwPaper(w);
  return w;
}

describe('collectDrawables', () => {
  it('returns something for every visible entity family', () => {
    const kinds = new Set(collectDrawables(populated()).map((d) => d.kind));
    expect(kinds.has('house')).toBe(true);
    expect(kinds.has('hazard')).toBe(true);
    expect(kinds.has('rider')).toBe(true);
    expect(kinds.has('paper')).toBe(true);
  });

  it('is sorted back to front', () => {
    const list = collectDrawables(populated());
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.depth).toBeGreaterThanOrEqual(list[i - 1]!.depth);
    }
  });

  it('draws the rider in front of a house at the same distance', () => {
    const w = populated();
    const house = w.houses.find((h) => Math.abs(h.spec.distance - 60) < 20)!;
    w.rider.distance = house.spec.distance;
    w.rider.lateral = 4.0;

    const list = collectDrawables(w);
    const riderAt = list.findIndex((d) => d.kind === 'rider');
    const houseAt = list.findIndex(
      (d) => d.kind === 'house' && d.house === house,
    );
    expect(riderAt).toBeGreaterThan(houseAt);
  });

  it('uses the shared depth key', () => {
    const w = populated();
    const entry = collectDrawables(w).find((d) => d.kind === 'rider')!;
    expect(entry.depth).toBeCloseTo(
      depthKey(w.rider.distance, w.rider.lateral), 6,
    );
  });

  it('culls entities far behind and far ahead of the rider', () => {
    const w = populated();
    const drawn = collectDrawables(w);
    for (const d of drawn) {
      if (d.kind !== 'house') continue;
      expect(d.house.spec.distance).toBeGreaterThan(w.rider.distance - 60);
      expect(d.house.spec.distance).toBeLessThan(w.rider.distance + 260);
    }
  });

  it('does not include a collected paper stack', () => {
    const w = populated();
    w.stacks.forEach((s) => { s.taken = true; });
    expect(collectDrawables(w).some((d) => d.kind === 'stack')).toBe(false);
  });
});
