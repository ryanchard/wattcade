import { RIDABLE_MAX } from './route.js';
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

/** Lower bound of a weaving hazard's lateral swing — the house footprint starts here. */
export const HAZARD_WEAVE_LATERAL_MIN = 1.5;

const WEAVE_PHASE_SCALE_S = 10;
const WEAVE_LATERAL_FREQ = 0.8;
const WEAVE_LATERAL_AMPLITUDE_M = 0.8;
const WEAVE_DISTANCE_FREQ = 0.4;
const WEAVE_DISTANCE_AMPLITUDE_M = 2;

export interface HazardPosition {
  distance: number;
  lateral: number;
}

/**
 * Where a weaving hazard sits at `elapsed`.
 *
 * This covers every hazard EXCEPT `car`: cars run in a straight line along
 * the road and each app integrates that distance from its own frame `dt`
 * (Version A's plain `dt`, Version B's clamped frame `dt`), which is
 * legitimate per-engine variation, not a rule this package owns. Every
 * other moving hazard instead weaves — a bounded, deterministic function of
 * absolute `elapsed` and the hazard's own `spec.phase`, not of any `dt` — so
 * calling it twice at the same `elapsed` is idempotent and safe to call
 * from more than one place in the same frame.
 *
 * This used to be duplicated by hand in both apps, and the lateral clamp
 * below (`HAZARD_WEAVE_LATERAL_MIN`..`RIDABLE_MAX`) was present in one copy
 * and missing from the other — a real, measurable divergence between the
 * two engines' hazard positions. It now lives here once, and BOTH apps'
 * hazard-movement code must call this rather than re-deriving the formula,
 * or that drift comes back.
 *
 * Pure function of `spec.distance`, `spec.lateral`, `spec.phase`, and
 * `elapsed` only: no wall clock, no `Math.random`, so both engines agree on
 * the exact same position at the same elapsed time.
 */
export function hazardPositionAt(
  spec: HazardSpec,
  elapsed: number,
): HazardPosition {
  const t = elapsed + spec.phase * WEAVE_PHASE_SCALE_S;
  const swing = Math.sin(t * WEAVE_LATERAL_FREQ) * WEAVE_LATERAL_AMPLITUDE_M;
  const lateral = Math.max(
    HAZARD_WEAVE_LATERAL_MIN,
    Math.min(RIDABLE_MAX, spec.lateral + swing),
  );
  const distance =
    spec.distance + Math.sin(t * WEAVE_DISTANCE_FREQ) * WEAVE_DISTANCE_AMPLITUDE_M;
  return { distance, lateral };
}
