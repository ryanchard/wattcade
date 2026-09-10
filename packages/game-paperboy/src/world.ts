import {
  BLOCK_LENGTH_M, INITIAL_SCORE_STATE, RIDABLE_MAX, RIDABLE_MIN,
  generateBlock, hazardPositionAt,
} from '@paperboy/game-core';
import type {
  BlockSpec, HazardSpec, HouseSpec, ScoreState, StackSpec,
} from '@paperboy/game-core';
import { stepPhysics } from '@paperboy/trainer';
import type { RiderProfile } from '@paperboy/trainer';

export const START_PAPERS = 20;
export const MAX_PAPERS = 30;
export const STACK_PAPERS = 10;
export const START_LIVES = 3;
export const STEER_RATE = 4.5;
export const STREAM_AHEAD_M = 400;
export const STREAM_BEHIND_M = 200;

export interface Rider {
  distance: number;
  lateral: number;
  speed: number;
  papers: number;
  lives: number;
  invulnerableUntil: number;
}

export interface HouseState {
  spec: HouseSpec;
  delivered: boolean;
  windowBroken: boolean;
  resolved: boolean;
}

export interface HazardState {
  spec: HazardSpec;
  distance: number;
  lateral: number;
}

export interface StackState {
  spec: StackSpec;
  taken: boolean;
}

export interface Paper {
  id: number;
  distance: number;
  lateral: number;
  height: number;
  vDistance: number;
  vLateral: number;
  vHeight: number;
}

export interface WorldState {
  seed: number;
  elapsed: number;
  rider: Rider;
  blocks: BlockSpec[];
  houses: HouseState[];
  hazards: HazardState[];
  stacks: StackState[];
  papers: Paper[];
  score: ScoreState;
  blocksCleared: number;
  gameOver: boolean;
  nextPaperId: number;
}

export function createWorld(seed: number): WorldState {
  return {
    seed,
    elapsed: 0,
    rider: {
      distance: 0,
      lateral: 3.8,
      speed: 0,
      papers: START_PAPERS,
      lives: START_LIVES,
      invulnerableUntil: 0,
    },
    blocks: [],
    houses: [],
    hazards: [],
    stacks: [],
    papers: [],
    score: { ...INITIAL_SCORE_STATE },
    blocksCleared: 0,
    gameOver: false,
    nextPaperId: 1,
  };
}

export function ensureBlocks(w: WorldState): void {
  const needUntil = w.rider.distance + STREAM_AHEAD_M;
  let nextIndex = w.blocks.length === 0 ? 0 : w.blocks.at(-1)!.index + 1;

  while (
    w.blocks.length === 0 ||
    w.blocks.at(-1)!.startDistance + BLOCK_LENGTH_M < needUntil
  ) {
    const block = generateBlock(w.seed, nextIndex);
    w.blocks.push(block);
    block.houses.forEach((spec) =>
      w.houses.push({ spec, delivered: false, windowBroken: false, resolved: false }),
    );
    block.hazards.forEach((spec) =>
      w.hazards.push({ spec, distance: spec.distance, lateral: spec.lateral }),
    );
    block.stacks.forEach((spec) => w.stacks.push({ spec, taken: false }));
    nextIndex += 1;
  }

  const cutoff = w.rider.distance - STREAM_BEHIND_M;
  w.blocks = w.blocks.filter((b) => b.startDistance + b.length > cutoff);
  w.houses = w.houses.filter((h) => h.spec.distance > cutoff);
  w.hazards = w.hazards.filter((h) => h.distance > cutoff);
  w.stacks = w.stacks.filter((s) => s.spec.distance > cutoff);
}

/**
 * These band boundaries (3.0/4.5/5.5) are hand-duplicated in
 * apps/phaser/src/logic/entities.ts's surfaceCrr and both apps' ground
 * renderers. `packages/game-core/src/route.ts` used to generate a
 * `SurfaceSpec[]` per block that looked like it should be the shared
 * source of truth for these bands, but it was read by nothing (both apps
 * always hardcoded the boundaries instead) and it only ever modelled two
 * of the four bands here (grass and curb, missing sidewalk and road
 * entirely) — promoting it would have meant rewriting it, not reusing it.
 * It was deleted rather than kept as a stale, misleading abstraction; if
 * these bands ever need to move, update all four call sites together.
 */
export function surfaceCrr(lateral: number): number {
  if (lateral < 3.0) return 0.02;    // lawn
  if (lateral < 4.5) return 0.005;   // sidewalk
  if (lateral < 5.5) return 0.014;   // curb
  return 0.005;                      // road
}

export function gradeAt(w: WorldState, distance: number): number {
  const block = w.blocks.find(
    (b) => distance >= b.startDistance && distance < b.startDistance + b.length,
  );
  return block?.gradePercent ?? 0;
}

export function steer(w: WorldState, direction: number, dt: number): void {
  const next = w.rider.lateral + direction * STEER_RATE * dt;
  w.rider.lateral = Math.max(RIDABLE_MIN, Math.min(RIDABLE_MAX, next));
}

export function advanceRider(
  w: WorldState,
  powerWatts: number,
  profile: RiderProfile,
  dt: number,
): void {
  const next = stepPhysics(
    { speed: w.rider.speed, distance: w.rider.distance },
    {
      powerWatts,
      gradePercent: gradeAt(w, w.rider.distance),
      crr: surfaceCrr(w.rider.lateral),
      headwind: 0,
    },
    profile,
    dt,
  );
  w.rider.speed = next.speed;
  w.rider.distance = next.distance;
  w.elapsed += dt;
}

/**
 * The weave branch below (via the shared `hazardPositionAt`) is a function
 * of absolute `w.elapsed`, not of the `dt` passed in — `dt` only matters to
 * the `car` branch, which integrates a position. `w.elapsed` is advanced
 * solely by `advanceRider`, so callers MUST call `advanceRider` before
 * `moveHazards` each frame for weaving hazards to move at all. The upside
 * of keying off absolute time rather than integrating a per-call delta:
 * calling `moveHazards` more than once within the same frame (same
 * `w.elapsed`) is harmless and idempotent for every non-car hazard, since
 * it always recomputes the same absolute position rather than advancing it
 * further.
 */
export function moveHazards(w: WorldState, dt: number): void {
  for (const h of w.hazards) {
    if (!h.spec.moving) continue;

    if (h.spec.kind === 'car') {
      // Traffic runs along the road, oncoming.
      h.distance -= h.spec.speed * dt;
    } else {
      // Everything else weaves across its own band, using the shared
      // definition (packages/game-core/src/hazard.ts) so Version B's
      // hazard motion cannot drift from this one again.
      const pos = hazardPositionAt(h.spec, w.elapsed);
      h.lateral = pos.lateral;
      h.distance = pos.distance;
    }
  }
}
