import type { HazardSpec } from './route.js';

/** Seconds a sprinkler sprays before it shuts off. */
export const SPRINKLER_ON_S = 3;
/** Seconds a sprinkler stays dormant before it comes back on. */
export const SPRINKLER_OFF_S = 2;
/** Full on-then-off cycle length, in seconds. */
export const SPRINKLER_PERIOD_S = SPRINKLER_ON_S + SPRINKLER_OFF_S;

/**
 * Whether a hazard is actually dangerous to touch right now.
 *
 * Every hazard kind is active on every frame EXCEPT `sprinkler`, which
 * cycles: `SPRINKLER_ON_S` seconds spraying (active), then
 * `SPRINKLER_OFF_S` seconds dormant (harmless), repeating with period
 * `SPRINKLER_PERIOD_S`. `spec.phase` — a value in [0, 1) assigned once at
 * generation — offsets each sprinkler's cycle by up to a full period, so a
 * street full of sprinklers does not pulse in unison.
 *
 * This is the single, shared definition of "is this sprinkler on": both
 * collision (canvas `detectCollision`, phaser `#checkCollisions`) and
 * rendering (canvas `drawSprinkler`, phaser's hazard view) must call this
 * rather than deriving their own on/off signal, or the visuals and the
 * danger can drift apart — which is exactly the fairness bug this function
 * exists to close (a sprinkler drawn OFF must never be able to crash you).
 *
 * Pure function of `spec.phase` and `elapsed` only: no wall clock, no
 * `Math.random`, so both engines agree on the exact same on/off state at
 * the same elapsed time.
 */
export function isHazardActive(spec: HazardSpec, elapsed: number): boolean {
  if (spec.kind !== 'sprinkler') return true;
  const t = elapsed + spec.phase * SPRINKLER_PERIOD_S;
  const cyclePos = t - Math.floor(t / SPRINKLER_PERIOD_S) * SPRINKLER_PERIOD_S;
  return cyclePos < SPRINKLER_ON_S;
}
