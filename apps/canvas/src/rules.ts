import {
  BLOCK_LENGTH_M, RIDER_WIDTH_M, applyScoreEvent, classifyLanding,
  isHazardActive,
} from '@paperboy/game-core';
import type { HazardKind, LandingOutcome, ScoreEvent } from '@paperboy/game-core';
import type { RiderProfile } from '@paperboy/trainer';
import {
  MAX_PAPERS, STACK_PAPERS,
  advanceRider, ensureBlocks, moveHazards, steer,
} from './world.js';
import type { HouseState, HazardState, WorldState } from './world.js';

export const THROW_HEIGHT = 1.1;
export const THROW_V_LATERAL = -7;
export const THROW_V_UP = 3.2;
export const GRAVITY = 9.8;

// The single shared rider width, RIDER_WIDTH_M (packages/game-core/src/
// route.ts), was previously exported and unused while this file
// independently hardcoded 0.4 as a half-width and Version B independently
// hardcoded 0.8 as a full width in StreetScene.ts. Both now derive from
// this one constant.
export const RIDER_HALF_WIDTH = RIDER_WIDTH_M / 2;
export const RIDER_HALF_LENGTH = 0.75;
export const INVULNERABLE_S = 1.5;

/**
 * Collision half-depth along the road, per hazard kind. These numbers are
 * HALF of the extent the renderer actually draws — render/entities.ts's
 * `hazardDrawDepth`, `kind === 'car' ? 4 : 1` — so the hitbox agrees with
 * the sprite instead of being an independently guessed constant. Every
 * per-hazard draw function in that file is built to stay inside its own
 * `hazardDrawDepth` along the street for exactly this reason.
 * Version B (apps/phaser/src/scenes/StreetScene.ts and views.ts) derives its
 * hazard zone from the identical `kind === 'car' ? 4 : 1` expression: if one
 * side's drawn depth changes, both this function and that expression must
 * change together, or the two engines' collision thresholds will diverge
 * again.
 */
export function hazardHalfDepth(kind: HazardKind): number {
  return kind === 'car' ? 2.0 : 0.5;
}
export const HOUSE_RESOLVE_MARGIN_M = 8;
export const STACK_PICKUP_DISTANCE_M = 1.5;
export const STACK_PICKUP_LATERAL_M = 1.0;

export interface FrameInput {
  steer: number;
  throwPaper: boolean;
  powerWatts: number;
}

export function throwPaper(w: WorldState): boolean {
  if (w.rider.papers <= 0 || w.gameOver) return false;
  w.rider.papers -= 1;
  w.papers.push({
    id: w.nextPaperId++,
    distance: w.rider.distance,
    lateral: w.rider.lateral,
    height: THROW_HEIGHT,
    // A little forward carry so the throw inherits the rider's momentum.
    vDistance: w.rider.speed * 0.55,
    vLateral: THROW_V_LATERAL,
    vHeight: THROW_V_UP,
  });
  return true;
}

export function updatePapers(w: WorldState, dt: number): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  const survivors: typeof w.papers = [];
  // Built once per call rather than per paper: the shared rule works on
  // specs, while the app owns the mutable per-house state.
  let specs: ReturnType<typeof toSpecs> | null = null;

  for (const p of w.papers) {
    p.vHeight -= GRAVITY * dt;
    p.distance += p.vDistance * dt;
    p.lateral += p.vLateral * dt;
    p.height += p.vHeight * dt;

    if (p.height > 0) {
      survivors.push(p);
      continue;
    }

    specs ??= toSpecs(w);
    const outcome = classifyLanding(
      { distance: p.distance, lateral: p.lateral },
      specs,
    );
    const event = resolveLanding(w, outcome);
    if (event !== null) events.push(event);
  }

  w.papers = survivors;
  return events;
}

function toSpecs(w: WorldState) {
  return w.houses.map((h) => h.spec);
}

function resolveLanding(
  w: WorldState, outcome: LandingOutcome,
): ScoreEvent | null {
  const { band } = outcome;

  if (band === 'street') return null;
  if (outcome.house === null) return { type: 'lawn' };
  if (band === 'lawn') return { type: 'lawn' };

  const house = w.houses.find((h) => h.spec === outcome.house);
  if (house === undefined) return { type: 'lawn' };

  if (band === 'window') {
    if (house.windowBroken) return null;
    house.windowBroken = true;
    if (house.spec.subscriber) {
      // They cancel: no delivery is expected from here on.
      house.resolved = true;
      return { type: 'windowSubscriber' };
    }
    return { type: 'windowNonSubscriber' };
  }

  // mailbox or porch
  if (!house.spec.subscriber || house.delivered || house.resolved) return null;
  house.delivered = true;
  house.resolved = true;
  return band === 'mailbox' ? { type: 'mailbox' } : { type: 'porch' };
}

export function resolvePassedHouses(w: WorldState): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  for (const h of w.houses) {
    if (h.resolved) continue;
    if (h.spec.distance > w.rider.distance - HOUSE_RESOLVE_MARGIN_M) continue;
    h.resolved = true;
    if (h.spec.subscriber && !h.delivered) events.push({ type: 'houseMissed' });
  }
  return events;
}

export function resolveBlocks(w: WorldState): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  while (w.rider.distance > (w.blocksCleared + 1) * BLOCK_LENGTH_M) {
    const index = w.blocksCleared;
    const subscribers = w.houses.filter(
      (h) =>
        h.spec.subscriber &&
        Math.floor(h.spec.distance / BLOCK_LENGTH_M) === index,
    );
    if (subscribers.length > 0 && subscribers.every((h) => h.delivered)) {
      events.push({ type: 'blockCleared' });
    }
    w.blocksCleared += 1;
  }
  return events;
}

export function collectStacks(w: WorldState): void {
  for (const s of w.stacks) {
    if (s.taken) continue;
    if (Math.abs(s.spec.distance - w.rider.distance) > STACK_PICKUP_DISTANCE_M) continue;
    if (Math.abs(s.spec.lateral - w.rider.lateral) > STACK_PICKUP_LATERAL_M) continue;
    s.taken = true;
    w.rider.papers = Math.min(MAX_PAPERS, w.rider.papers + STACK_PAPERS);
  }
}

export function detectCollision(w: WorldState): HazardState | null {
  if (w.elapsed < w.rider.invulnerableUntil) return null;
  for (const h of w.hazards) {
    // A sprinkler in its off phase is drawn safe (see `drawSprinkler` in
    // render/entities.ts, which consults the same `isHazardActive`) and
    // must genuinely be safe — otherwise the game shows a harmless state
    // and then punishes the player for trusting it.
    if (!isHazardActive(h.spec, w.elapsed)) continue;
    const dGap = Math.abs(h.distance - w.rider.distance);
    if (dGap > RIDER_HALF_LENGTH + hazardHalfDepth(h.spec.kind)) continue;
    const lGap = Math.abs(h.lateral - w.rider.lateral);
    if (lGap > RIDER_HALF_WIDTH + h.spec.width / 2) continue;
    return h;
  }
  return null;
}

export function applyCrash(w: WorldState): ScoreEvent[] {
  w.rider.lives -= 1;
  w.rider.speed *= 0.15;
  w.rider.invulnerableUntil = w.elapsed + INVULNERABLE_S;
  if (w.rider.lives <= 0) {
    w.rider.lives = 0;
    w.gameOver = true;
  }
  return [{ type: 'crash' }];
}

export function stepWorld(
  w: WorldState,
  input: FrameInput,
  profile: RiderProfile,
  dt: number,
): ScoreEvent[] {
  if (w.gameOver) return [];

  ensureBlocks(w);
  steer(w, input.steer, dt);
  advanceRider(w, input.powerWatts, profile, dt);
  moveHazards(w, dt);

  if (input.throwPaper) throwPaper(w);

  const events: ScoreEvent[] = [
    ...updatePapers(w, dt),
    ...resolvePassedHouses(w),
    ...resolveBlocks(w),
  ];

  collectStacks(w);

  const hit = detectCollision(w);
  if (hit !== null) events.push(...applyCrash(w));

  for (const e of events) w.score = applyScoreEvent(w.score, e);
  return events;
}
