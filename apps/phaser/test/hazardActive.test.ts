import { describe, expect, it } from 'vitest';
import {
  SPRINKLER_OFF_S, SPRINKLER_ON_S, isHazardActive,
} from '@paperboy/game-core';
import type { HazardSpec } from '@paperboy/game-core';

/**
 * `StreetScene#checkCollisions` (apps/phaser/src/scenes/StreetScene.ts)
 * needs a live `Phaser.Scene` with Arcade Physics booted to actually run.
 * This repo's vitest config (vitest.config.ts) runs everything in a bare
 * `node` environment with no DOM/canvas, and the existing phaser test
 * suite (test/entities.test.ts, test/run.test.ts) never instantiates a
 * real `Phaser.Scene` for exactly that reason — it only exercises the
 * pure-logic modules underneath the scene (`BlockStreamer`, `PaperboyRun`,
 * etc). A live Arcade world genuinely cannot run headlessly here.
 *
 * So this test proves the FINDING 1 fix at the exact point the scene
 * consults it, instead: `#checkCollisions` reads, verbatim,
 *
 *   if (!isHazardActive(v.spec, run.elapsed)) continue;
 *   if (this.physics.world.overlap(this.#riderZone, v.zone)) { run.crash(); ... }
 *
 * i.e. it gates the Arcade overlap query on `isHazardActive` BEFORE ever
 * asking Arcade anything. `wouldCrash` below reproduces that same
 * two-step decision without Arcade: the same `isHazardActive` gate, then
 * an axis-aligned overlap test using the exact box dimensions
 * `#addHazard` gives every hazard zone (depth `spec.kind === 'car' ? 4 : 1`
 * metres, width `spec.width` metres) against the exact rider zone size
 * `create()` gives the rider (1.5m deep, 0.8m wide, both from
 * `PX_PER_M`-scaled metres, so checking in metres rather than the pixel
 * units Arcade actually uses is equivalent — the scaling is linear and
 * uniform). A sprinkler never moves (`moving: false` in
 * packages/game-core/src/route.ts's TEMPLATES), so its zone always sits
 * at `spec.distance`/`spec.lateral`, matching what `#addHazard` gives it.
 */

const RIDER_HALF_LENGTH_M = 0.75;
const RIDER_HALF_WIDTH_M = 0.4;

function hazardHalfDepthM(spec: HazardSpec): number {
  return (spec.kind === 'car' ? 4 : 1) / 2;
}

/** Mirrors `StreetScene#checkCollisions`'s decision for one hazard. */
function wouldCrash(
  spec: HazardSpec,
  elapsed: number,
  riderDistance: number,
  riderLateral: number,
): boolean {
  if (!isHazardActive(spec, elapsed)) return false;
  const dGap = Math.abs(spec.distance - riderDistance);
  if (dGap > RIDER_HALF_LENGTH_M + hazardHalfDepthM(spec)) return false;
  const lGap = Math.abs(spec.lateral - riderLateral);
  if (lGap > RIDER_HALF_WIDTH_M + spec.width / 2) return false;
  return true;
}

function sprinklerSpec(over: Partial<HazardSpec> = {}): HazardSpec {
  return {
    id: 'z-sprinkler-test', kind: 'sprinkler', distance: 100, lateral: 2.2,
    width: 1.2, speed: 0, phase: 0, moving: false, ...over,
  };
}

describe('sprinkler collision respects isHazardActive (StreetScene#checkCollisions gate)', () => {
  it('crashes a rider parked exactly on the sprinkler during its active phase', () => {
    const spec = sprinklerSpec({ phase: 0 });
    expect(wouldCrash(spec, 0, spec.distance, spec.lateral)).toBe(true);
  });

  it('does not crash the same rider during the sprinkler\'s inactive phase', () => {
    const spec = sprinklerSpec({ phase: 0 });
    expect(
      wouldCrash(spec, SPRINKLER_ON_S + 0.5, spec.distance, spec.lateral),
    ).toBe(false);
  });

  it('crashes again once the cycle comes back around to active', () => {
    const spec = sprinklerSpec({ phase: 0 });
    expect(
      wouldCrash(
        spec, SPRINKLER_ON_S + SPRINKLER_OFF_S + 0.5, spec.distance, spec.lateral,
      ),
    ).toBe(true);
  });

  it('still crashes on a non-sprinkler hazard regardless of elapsed time', () => {
    const spec = sprinklerSpec({ id: 'z-dog-test', kind: 'dog', width: 0.6 });
    expect(wouldCrash(spec, 0, spec.distance, spec.lateral)).toBe(true);
    expect(
      wouldCrash(spec, SPRINKLER_ON_S + 1000, spec.distance, spec.lateral),
    ).toBe(true);
  });
});
