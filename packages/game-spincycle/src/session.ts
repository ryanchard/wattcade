/**
 * Spin Cycle — the pure flight rules.
 *
 * No DOM, no clock, no randomness that is not seeded. Everything a player
 * could read as information comes out of `mulberry32`, so a seed and a
 * sequence of (dt, watts, rpm) reproduce a run exactly.
 *
 * The control idea, which is the whole game: cadence sets CLIMB RATE, not
 * altitude. Around 80 rpm the machine holds level; spin up and it climbs,
 * spin down and it sinks, at a rate proportional to how far past a small
 * deadband you are. That deadband is what makes level flight actually
 * holdable — without it, a rider hunting 80 rpm oscillates forever.
 *
 * Power is a separate axis and does something separate: it sets forward
 * speed. Riding harder makes the game faster and the gaps arrive sooner, and
 * scores more, which is a risk the rider chooses rather than one the game
 * imposes.
 */
import { mulberry32, rangeFloat } from '@paperboy/game-core';
import type { CadenceTracker, Rng } from '@paperboy/game-core';
import {
  cadenceStalled, createCadenceTracker, readCadence, steeringRpm, tickCadence,
} from '@paperboy/game-core';
import type { RiderProfile, SimulationParams } from '@paperboy/trainer';

// ---------------------------------------------------------------------------
// TUNABLES — retuned by feel after actually riding, so they live together.
// ---------------------------------------------------------------------------

/** The cadence that holds you level. A comfortable spin, not an effort. */
export const NEUTRAL_CADENCE_RPM = 80;

/** Half-width of the band around neutral that counts as level. Cadence from
 * a real trainer wanders by a couple of rpm; without this the machine would
 * never actually sit still and level flight would be a myth. */
export const CADENCE_DEADBAND_RPM = 4;

/** Metres per second of climb for every rpm past the deadband. */
export const CLIMB_RATE_PER_RPM = 0.62;

/** Ceiling on climb rate. Reached around 110 rpm. */
export const MAX_CLIMB_MPS = 17;

/** Ceiling on sink rate — deliberately larger than the climb ceiling, so
 * stopping pedalling drops you faster than spinning lifts you. That is what
 * makes it read as gravity rather than as a symmetrical joystick. */
export const MAX_SINK_MPS = 21;

/** Time constant of the ease from the climb rate you are asking for to the
 * one you have. This is the machine's mass: it is what stops the control
 * being a teleport and gives the classic helicopter swing. */
export const VERTICAL_TAU_S = 0.34;

/** Height of the flyable sky, in metres. The ground is 0. */
export const SKY_HEIGHT_M = 80;

/** The flying machine's collision box, in world metres. Generous wings. */
export const CRAFT_HALF_W_M = 3.2;
export const CRAFT_HALF_H_M = 1.7;

/** Where the machine starts: halfway up, holding level. */
export const START_ALTITUDE_M = SKY_HEIGHT_M / 2;

/** Forward speed with nothing on the pedals — the machine glides. */
export const GLIDE_SPEED_MPS = 6;
/** Extra forward speed at exactly the rider's FTP. */
export const SPEED_PER_FTP_MPS = 11;
export const MIN_SPEED_MPS = 4;
export const MAX_SPEED_MPS = 26;

/** How far ahead of the machine obstacles are generated and kept. */
export const HORIZON_M = 420;
/** How far behind before an obstacle is forgotten. Well past the left edge. */
export const TAIL_M = 120;

/** Clear sky before the first obstacle, so the rider can find level first. */
export const FIRST_OBSTACLE_M = 240;

/**
 * Difficulty tightens with TIME ALOFT, not with distance flown — and that is
 * the whole reason riding hard is worth anything.
 *
 * Tie it to distance instead (the obvious first guess, and what this had at
 * first) and speed becomes strictly bad: the gaps are exactly as tight at the
 * same metre mark whoever you are, so all the extra speed buys is less time
 * to react to each one. Measured, a hard rider scored roughly half what an
 * easy one did, every seed. Tying it to time makes the trade honest: at any
 * moment both riders face the same gap, and the faster one has covered more
 * ground to get there — but the obstacles arrive at them sooner.
 */

/** Vertical gap through an obstacle, at the start and at its tightest. */
export const GAP_START_M = 30;
export const GAP_MIN_M = 15;
/** Metres of gap lost per minute aloft. */
export const GAP_TIGHTEN_PER_MIN = 3.75;

/** Distance between obstacles, at the start and at its tightest. */
export const SPACING_START_M = 130;
export const SPACING_MIN_M = 60;
export const SPACING_TIGHTEN_PER_MIN = 18;

/** The resistance this game asks for: none worth speaking of. Cadence is the
 * steering wheel, and steering must not cost a sprint, so the road is flat
 * and the air is thin. Both are why `needsResistance` is false — a read-only
 * trainer plays this exactly as well. */
export const LIGHT_SIMULATION: SimulationParams = Object.freeze({
  grade: 0, headwind: 0, crr: 0.004, cw: 0.28,
});

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

/** Comically English, all of it. The kind matters only to the renderer and
 * to the shape of the solid spans; collision reads the spans alone. */
export type ObstacleKind = 'spire' | 'bunting' | 'birds' | 'balloon';

/** A solid band of altitude, in metres above the ground. */
export interface Span {
  readonly lo: number;
  readonly hi: number;
}

export interface Obstacle {
  readonly kind: ObstacleKind;
  /** World position of the obstacle's centre, in metres. */
  readonly x: number;
  readonly halfW: number;
  /** Everything you may not fly through. Empty air is everywhere else. */
  readonly spans: readonly Span[];
  /** Deterministic per-obstacle decoration seed, 0..1. Renderer only. */
  readonly flourish: number;
  /** Counted once, when the machine gets past it. */
  passed: boolean;
}

export interface SpinSession {
  readonly profile: RiderProfile;
  readonly rng: Rng;
  readonly cadence: CadenceTracker;
  /** Simulated seconds, including any spent waiting for cadence. */
  elapsed: number;
  /** Metres flown. Also the machine's world x. This is the score. */
  distance: number;
  speed: number;
  altitude: number;
  /** Current climb rate in m/s, eased toward what cadence is asking for. */
  vertical: number;
  obstacles: Obstacle[];
  /** Where the next obstacle will be generated. */
  nextObstacleX: number;
  cleared: number;
  kilojoules: number;
  crashed: boolean;
  stopped: boolean;
  over: boolean;
}

export function createSession(profile: RiderProfile, seed: number): SpinSession {
  return {
    profile,
    rng: mulberry32(seed),
    cadence: createCadenceTracker(),
    elapsed: 0,
    distance: 0,
    speed: 0,
    altitude: START_ALTITUDE_M,
    vertical: 0,
    obstacles: [],
    nextObstacleX: FIRST_OBSTACLE_M,
    cleared: 0,
    kilojoules: 0,
    crashed: false,
    stopped: false,
    over: false,
  };
}

// ---------------------------------------------------------------------------
// The two axes
// ---------------------------------------------------------------------------

/**
 * The climb rate a given cadence asks for, in metres per second. Positive is
 * up. Inside the deadband this is exactly zero, which is the only reason
 * level flight is holdable.
 */
export function climbRate(rpm: number): number {
  const diff = rpm - NEUTRAL_CADENCE_RPM;
  const past =
    Math.abs(diff) <= CADENCE_DEADBAND_RPM
      ? 0
      : diff - Math.sign(diff) * CADENCE_DEADBAND_RPM;
  return Math.max(-MAX_SINK_MPS, Math.min(MAX_CLIMB_MPS, past * CLIMB_RATE_PER_RPM));
}

/** Forward speed for the watts on the pedals. Never zero: it is a glider. */
export function speedFor(profile: RiderProfile, watts: number): number {
  const safe = Number.isFinite(watts) && watts > 0 ? watts : 0;
  const ratio = profile.ftpWatts > 0 ? safe / profile.ftpWatts : 0;
  return Math.max(
    MIN_SPEED_MPS,
    Math.min(MAX_SPEED_MPS, GLIDE_SPEED_MPS + ratio * SPEED_PER_FTP_MPS),
  );
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function gapAt(elapsedS: number): number {
  return Math.max(GAP_MIN_M, GAP_START_M - (elapsedS / 60) * GAP_TIGHTEN_PER_MIN);
}

export function spacingAt(elapsedS: number): number {
  return Math.max(
    SPACING_MIN_M, SPACING_START_M - (elapsedS / 60) * SPACING_TIGHTEN_PER_MIN,
  );
}

/**
 * One obstacle at `x`, leaving a hole of `gap` metres somewhere in the sky.
 * Every kind is expressed as solid spans so that collision has exactly one
 * rule to apply and cannot disagree with the picture.
 */
export function makeObstacle(rng: Rng, x: number, gap: number): Obstacle {
  const roll = rng();

  // A church spire, or a stand of chimneys: solid from the ground up, so the
  // hole is above it.
  if (roll < 0.36) {
    const lowest = 12;
    const highest = Math.max(lowest, SKY_HEIGHT_M - gap - 4);
    const top = rangeFloat(rng, lowest, highest);
    return {
      kind: 'spire', x, halfW: 5,
      spans: [{ lo: 0, hi: top }],
      flourish: rng(), passed: false,
    };
  }

  // Bunting strung between two poles that carry on up out of the picture:
  // solid from some height to the top of the sky, so the hole is beneath it.
  if (roll < 0.60) {
    const lowest = gap + 6;
    const highest = Math.max(lowest, SKY_HEIGHT_M - 10);
    const swag = rangeFloat(rng, lowest, highest);
    return {
      kind: 'bunting', x, halfW: 9,
      spans: [{ lo: swag, hi: SKY_HEIGHT_M }],
      flourish: rng(), passed: false,
    };
  }

  // A flock of startled birds, or a hot air balloon: floating, so there is
  // air both above and below. One side is the tight one.
  const birds = roll < 0.82;
  const band = birds ? rangeFloat(rng, 6, 11) : rangeFloat(rng, 13, 19);
  const tightBelow = rng() < 0.5;
  const room = Math.max(0, SKY_HEIGHT_M - band);
  const clearance = Math.min(gap, room / 2);
  const lo = tightBelow ? clearance : Math.max(0, room - clearance);
  return {
    kind: birds ? 'birds' : 'balloon',
    x,
    halfW: birds ? 11 : 8,
    spans: [{ lo, hi: lo + band }],
    flourish: rng(), passed: false,
  };
}

/** Fills the sky ahead. Generated by position, never by frame, so the same
 * distance always produces the same landscape. */
export function ensureObstacles(s: SpinSession): void {
  const gap = gapAt(s.elapsed);
  const spacing = spacingAt(s.elapsed);
  while (s.nextObstacleX < s.distance + HORIZON_M) {
    const x = s.nextObstacleX;
    s.obstacles.push(makeObstacle(s.rng, x, gap));
    s.nextObstacleX = x + spacing * rangeFloat(s.rng, 0.86, 1.14);
  }
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

/** True when the machine, at `x` and `altitude`, is inside anything solid. */
export function hits(o: Obstacle, x: number, altitude: number): boolean {
  if (Math.abs(x - o.x) > o.halfW + CRAFT_HALF_W_M) return false;
  const lo = altitude - CRAFT_HALF_H_M;
  const hi = altitude + CRAFT_HALF_H_M;
  return o.spans.some((span) => hi > span.lo && lo < span.hi);
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** The trainer's latest cadence, straight through from the shell. */
export function setCadence(s: SpinSession, rpm: number | null): void {
  readCadence(s.cadence, rpm);
}

/** The safety stop. Sets state; writes nothing anywhere. */
export function stopRun(s: SpinSession): void {
  s.stopped = true;
  s.over = true;
}

/**
 * One fixed substep. Inert once the run is over, so a late frame cannot
 * score, crash, or move anything after the fact.
 */
export function advance(s: SpinSession, dt: number, watts: number): void {
  if (s.over) return;

  s.elapsed += dt;
  s.kilojoules += (Math.max(0, watts) * dt) / 1000;

  tickCadence(s.cadence, dt);
  if (cadenceStalled(s.cadence)) {
    // Nothing moves and nothing can kill you, from the very first frame until
    // a reading arrives. Holding the world still is the honest thing: a rider
    // whose trainer has no cadence sensor has not lost, they have simply not
    // been given a control. The renderer says so once it is more than a
    // dropped notification.
    s.speed = 0;
    s.vertical = 0;
    return;
  }

  // During the short grace period after a dropped notification, hold level
  // rather than dropping out of the sky on a missing packet.
  const target = climbRate(steeringRpm(s.cadence, NEUTRAL_CADENCE_RPM));
  const alpha = 1 - Math.exp(-dt / VERTICAL_TAU_S);
  s.vertical += (target - s.vertical) * alpha;
  s.altitude += s.vertical * dt;

  if (s.altitude >= SKY_HEIGHT_M) {
    // The top of the sky is thin air, not a wall. You bump along it.
    s.altitude = SKY_HEIGHT_M;
    s.vertical = Math.min(0, s.vertical);
  }
  if (s.altitude <= 0) {
    s.altitude = 0;
    s.crashed = true;
    s.over = true;
    return;
  }

  s.speed = speedFor(s.profile, watts);
  s.distance += s.speed * dt;

  ensureObstacles(s);

  for (const o of s.obstacles) {
    if (hits(o, s.distance, s.altitude)) {
      s.crashed = true;
      s.over = true;
      return;
    }
    if (!o.passed && o.x + o.halfW < s.distance - CRAFT_HALF_W_M) {
      o.passed = true;
      s.cleared += 1;
    }
  }

  const tail = s.distance - TAIL_M;
  if (s.obstacles.length > 0 && s.obstacles[0]!.x < tail) {
    s.obstacles = s.obstacles.filter((o) => o.x >= tail);
  }
}

export function simulationFor(_s: SpinSession): SimulationParams {
  return LIGHT_SIMULATION;
}

export interface SpinRunSummary {
  distanceM: number;
  durationS: number;
  cleared: number;
  avgPower: number;
}

export function toRunSummary(s: SpinSession): SpinRunSummary {
  return {
    distanceM: Math.round(s.distance),
    durationS: s.elapsed,
    cleared: s.cleared,
    avgPower: s.elapsed > 0 ? Math.round((s.kilojoules * 1000) / s.elapsed) : 0,
  };
}
