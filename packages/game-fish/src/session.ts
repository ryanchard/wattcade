/**
 * Fish — the pure rules.
 *
 * You are a fish. You ride no bicycle. This is not explained.
 *
 * No DOM, no clock, no unseeded randomness: a seed plus a sequence of
 * (dt, watts, rpm) reproduces a run exactly.
 *
 * The control is a DIRECT map, unlike Spin Cycle's rate control. A given
 * cadence is a given depth — 50 rpm is the bottom, 110 rpm is just under the
 * surface, and everything between is proportional. Swimming should feel
 * precise, so there is no integration and no gravity to fight; the only
 * filter is a very short ease that takes the stair-step out of a trainer
 * notifying at 1-4 Hz without putting any float into the control.
 *
 * Power is the other axis and sets forward swim speed.
 *
 * The difficulty curve comes from the size ladder rather than from any number
 * going up. Fish sizes are drawn from an ABSOLUTE ladder, so the 2.2 m thing
 * that would have eaten you at the start is lunch once you are 3 m. Nothing
 * scales with you; you scale past it.
 */
import { mulberry32, rangeFloat, rangeInt } from '@paperboy/game-core';
import type { CadenceTracker, Rng } from '@paperboy/game-core';
import {
  cadenceStalled, createCadenceTracker, readCadence, tickCadence,
} from '@paperboy/game-core';
import type { RiderProfile, SimulationParams } from '@paperboy/trainer';

// ---------------------------------------------------------------------------
// TUNABLES
// ---------------------------------------------------------------------------

/** The cadence that puts you on the sea floor. */
export const CADENCE_LOW_RPM = 50;
/** The cadence that puts you just under the surface. */
export const CADENCE_HIGH_RPM = 110;

/** The water column, in metres. 0 is the surface. */
export const TANK_DEPTH_M = 40;
/** How close to the surface and the floor the map lets you get. */
export const SURFACE_MARGIN_M = 2.5;
export const FLOOR_MARGIN_M = 2.5;

/** Time constant of the ease onto the mapped depth. Short on purpose: long
 * enough to take the stair-step out of a 1-4 Hz trainer, short enough that
 * the control still reads as a position rather than as a thruster. */
export const DEPTH_TAU_S = 0.12;

/** Half-length of the fish you start as, in metres. A modest fish. */
export const START_SIZE_M = 1.2;
/** However well you eat, you stop growing here. */
export const MAX_SIZE_M = 12;
/** How much of a mouthful's size carries into yours, in the sum of squares.
 * Squares rather than lengths so growth slows as you get large. */
export const GROWTH_GAIN = 0.6;

/**
 * The absolute ladder every other fish is drawn from. Absolute is the whole
 * point: these do not scale with you, so growing past a rung genuinely
 * changes what is dangerous.
 */
export const FISH_TIERS = [0.45, 0.8, 1.35, 2.2, 3.4, 5.2, 7.8, 11.5] as const;

/** How far either side of your own size counts as too close to call. A
 * spawn is never allowed inside this band, because the entire game is one
 * size comparison and a coin-flip read is not a game. */
export const AMBIGUITY_BAND = 0.16;

/**
 * How much of the sea wants to eat you. Rolled explicitly rather than falling
 * out of a symmetric spread of tiers, because that spread put a predator in
 * every other spawn and the sea became unswimmable — most of what you meet
 * has to be food, or there is no growing and therefore no game.
 */
export const DANGER_FRACTION = 0.28;

/** Rungs below and above your own that food and danger are drawn from. */
export const SPAWN_TIER_BELOW = 3;
export const SPAWN_TIER_ABOVE = 2;

/** Metres of your own travel between spawns, before jitter. */
export const SPAWN_SPACING_M = 18;
/** Clear water before the first fish, so the rider can find their depth. */
export const FIRST_SPAWN_M = 60;
/** How far ahead fish appear, and how far behind they are forgotten. */
export const SPAWN_AHEAD_M = 150;
export const DESPAWN_BEHIND_M = 45;

/** Swim speed with nothing on the pedals, and the gain per FTP. */
export const DRIFT_SPEED_MPS = 2.4;
export const SPEED_PER_FTP_MPS = 7.5;
export const MIN_SPEED_MPS = 1.2;
export const MAX_SPEED_MPS = 13;

/** Fraction of the summed sizes that counts as a touch. Below 1 so a near
 * miss along the silhouette's thin edges is a near miss. */
export const TOUCH_FACTOR = 0.78;

/** Flat road, thin air — see Spin Cycle. Cadence is the steering wheel and
 * steering must not cost a sprint. */
export const LIGHT_SIMULATION: SimulationParams = Object.freeze({
  grade: 0, headwind: 0, crr: 0.004, cw: 0.28,
});

// ---------------------------------------------------------------------------
// The sea
// ---------------------------------------------------------------------------

export interface Fish {
  readonly id: number;
  /** World position, metres. The player swims toward +x. */
  x: number;
  /** Depth this fish holds, before its bob. */
  readonly depth: number;
  readonly size: number;
  /** Metres per second along x. Negative: most fish swim toward you. */
  readonly vx: number;
  readonly bobAmp: number;
  readonly bobRate: number;
  readonly bobPhase: number;
  /** 0..1, decorative variety for the renderer only. */
  readonly look: number;
  eaten: boolean;
}

export interface FishSession {
  readonly profile: RiderProfile;
  readonly rng: Rng;
  readonly cadence: CadenceTracker;
  elapsed: number;
  /** Metres swum. Also the player's world x. */
  distance: number;
  speed: number;
  /** Where the player actually is, eased onto `targetDepth`. */
  depth: number;
  /** Where the current cadence says to be. Held when there is no reading. */
  targetDepth: number;
  size: number;
  eaten: number;
  /** The largest thing eaten so far, for the results card. */
  biggestEaten: number;
  fish: Fish[];
  nextFishId: number;
  nextSpawnX: number;
  kilojoules: number;
  /** True when something bigger got you. */
  swallowed: boolean;
  stopped: boolean;
  over: boolean;
}

export function createSession(profile: RiderProfile, seed: number): FishSession {
  const middle = TANK_DEPTH_M / 2;
  return {
    profile,
    rng: mulberry32(seed),
    cadence: createCadenceTracker(),
    elapsed: 0,
    distance: 0,
    speed: 0,
    depth: middle,
    targetDepth: middle,
    size: START_SIZE_M,
    eaten: 0,
    biggestEaten: 0,
    fish: [],
    nextFishId: 1,
    nextSpawnX: FIRST_SPAWN_M,
    kilojoules: 0,
    swallowed: false,
    stopped: false,
    over: false,
  };
}

// ---------------------------------------------------------------------------
// The two axes
// ---------------------------------------------------------------------------

/** The shallowest and deepest the map will put you. */
export const SHALLOWEST_M = SURFACE_MARGIN_M;
export const DEEPEST_M = TANK_DEPTH_M - FLOOR_MARGIN_M;

/**
 * Cadence to depth, directly. High cadence is high in the water, which is
 * the same direction as Spin Cycle's climb: spin up, go up. Two games that
 * disagreed about that would be actively unkind.
 */
export function depthFor(rpm: number): number {
  const span = CADENCE_HIGH_RPM - CADENCE_LOW_RPM;
  const t = Math.max(0, Math.min(1, (rpm - CADENCE_LOW_RPM) / span));
  return DEEPEST_M - t * (DEEPEST_M - SHALLOWEST_M);
}

/** Forward swim speed for the watts on the pedals. Never zero: fish drift. */
export function speedFor(profile: RiderProfile, watts: number): number {
  const safe = Number.isFinite(watts) && watts > 0 ? watts : 0;
  const ratio = profile.ftpWatts > 0 ? safe / profile.ftpWatts : 0;
  return Math.max(
    MIN_SPEED_MPS,
    Math.min(MAX_SPEED_MPS, DRIFT_SPEED_MPS + ratio * SPEED_PER_FTP_MPS),
  );
}

// ---------------------------------------------------------------------------
// Size — the whole game
// ---------------------------------------------------------------------------

/** Strictly smaller is food. Everything else is not. */
export function isEdible(playerSize: number, fishSize: number): boolean {
  return fishSize < playerSize;
}

/** True when a size is close enough to the player's to be a coin flip. */
export function isAmbiguous(playerSize: number, fishSize: number): boolean {
  return Math.abs(fishSize - playerSize) < playerSize * AMBIGUITY_BAND;
}

/** The rung of the ladder at or just above a size. */
export function tierFor(size: number): number {
  const found = FISH_TIERS.findIndex((t) => t >= size);
  return found === -1 ? FISH_TIERS.length - 1 : found;
}

/**
 * A size for a new fish. First it is decided whether this one is food or
 * danger, then a rung near the player's own is picked from the ABSOLUTE
 * ladder on that side. Finally it is nudged clear of the too-close-to-call
 * band, always in the direction the roll intended, so a fish meant as food
 * cannot become a predator on the way out. When the ladder runs out at either
 * end the size steps off the band directly, so the guarantee holds everywhere
 * rather than nearly everywhere.
 */
export function spawnSize(rng: Rng, playerSize: number): number {
  const last = FISH_TIERS.length - 1;
  const base = tierFor(playerSize);
  const danger = rng() < DANGER_FRACTION;
  let index = danger
    ? Math.min(last, base + rangeInt(rng, 0, SPAWN_TIER_ABOVE))
    : Math.max(0, base - rangeInt(rng, 1, SPAWN_TIER_BELOW));
  let size = FISH_TIERS[index] ?? START_SIZE_M;

  while (isAmbiguous(playerSize, size) || (danger !== !isEdible(playerSize, size))) {
    const next = danger ? index + 1 : index - 1;
    if (next < 0 || next > last) {
      return danger
        ? playerSize * (1 + AMBIGUITY_BAND * 1.5)
        : playerSize * (1 - AMBIGUITY_BAND * 1.5);
    }
    index = next;
    size = FISH_TIERS[index] ?? size;
  }
  return size;
}

/** Eating adds in squares, so the tenth mouthful matters less than the first. */
export function grownBy(size: number, preySize: number): number {
  return Math.min(MAX_SIZE_M, Math.sqrt(size * size + preySize * preySize * GROWTH_GAIN));
}

// ---------------------------------------------------------------------------
// Movement and collision
// ---------------------------------------------------------------------------

/** Where a fish actually is this instant, bob included. */
export function fishDepth(f: Fish, elapsed: number): number {
  const bobbed = f.depth + Math.sin(f.bobPhase + f.bobRate * elapsed) * f.bobAmp;
  return Math.max(f.size, Math.min(TANK_DEPTH_M - f.size, bobbed));
}

/** Touching is measured between centres, against the summed sizes. */
export function touching(
  playerX: number, playerDepth: number, playerSize: number,
  f: Fish, fDepth: number,
): boolean {
  const reach = (playerSize + f.size) * TOUCH_FACTOR;
  const dx = playerX - f.x;
  const dy = playerDepth - fDepth;
  return dx * dx + dy * dy <= reach * reach;
}

export function spawnFish(s: FishSession, x: number): Fish {
  const size = spawnSize(s.rng, s.size);
  const depth = rangeFloat(
    s.rng, Math.min(size + 1, TANK_DEPTH_M / 2), Math.max(size + 1, TANK_DEPTH_M - size - 1),
  );
  return {
    id: s.nextFishId++,
    x,
    depth,
    size,
    // Almost everything swims toward you; the odd one is going the same way.
    vx: s.rng() < 0.85 ? -rangeFloat(s.rng, 0.6, 2.4) : rangeFloat(s.rng, 0.2, 1.1),
    bobAmp: rangeFloat(s.rng, 0.3, 1.6),
    bobRate: rangeFloat(s.rng, 0.5, 1.8),
    bobPhase: s.rng() * Math.PI * 2,
    look: s.rng(),
    eaten: false,
  };
}

/** Stocks the sea ahead. Driven by position, so the same swim always meets
 * the same fish. */
export function ensureFish(s: FishSession): void {
  while (s.nextSpawnX < s.distance + SPAWN_AHEAD_M) {
    s.fish.push(spawnFish(s, s.nextSpawnX));
    s.nextSpawnX += SPAWN_SPACING_M * rangeFloat(s.rng, 0.7, 1.5);
  }
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

export function setCadence(s: FishSession, rpm: number | null): void {
  readCadence(s.cadence, rpm);
}

export function stopRun(s: FishSession): void {
  s.stopped = true;
  s.over = true;
}

export function advance(s: FishSession, dt: number, watts: number): void {
  if (s.over) return;

  s.elapsed += dt;
  s.kilojoules += (Math.max(0, watts) * dt) / 1000;

  tickCadence(s.cadence, dt);
  if (cadenceStalled(s.cadence)) {
    // Nothing moves and nothing can eat you. The renderer explains why.
    s.speed = 0;
    return;
  }

  // A dropped notification holds the depth you last asked for rather than
  // dumping you to the floor.
  if (s.cadence.rpm !== null) s.targetDepth = depthFor(s.cadence.rpm);
  const alpha = 1 - Math.exp(-dt / DEPTH_TAU_S);
  s.depth += (s.targetDepth - s.depth) * alpha;

  s.speed = speedFor(s.profile, watts);
  s.distance += s.speed * dt;

  ensureFish(s);

  for (const f of s.fish) {
    f.x += f.vx * dt;
    if (f.eaten) continue;
    if (!touching(s.distance, s.depth, s.size, f, fishDepth(f, s.elapsed))) continue;

    if (isEdible(s.size, f.size)) {
      f.eaten = true;
      s.eaten += 1;
      s.biggestEaten = Math.max(s.biggestEaten, f.size);
      s.size = grownBy(s.size, f.size);
    } else {
      s.swallowed = true;
      s.over = true;
      return;
    }
  }

  const tail = s.distance - DESPAWN_BEHIND_M;
  if (s.fish.some((f) => f.eaten || f.x < tail)) {
    s.fish = s.fish.filter((f) => !f.eaten && f.x >= tail);
  }
}

export function simulationFor(_s: FishSession): SimulationParams {
  return LIGHT_SIMULATION;
}

export interface FishRunSummary {
  distanceM: number;
  durationS: number;
  eaten: number;
  size: number;
  biggestEaten: number;
  avgPower: number;
}

export function toRunSummary(s: FishSession): FishRunSummary {
  return {
    distanceM: Math.round(s.distance),
    durationS: s.elapsed,
    eaten: s.eaten,
    size: s.size,
    biggestEaten: s.biggestEaten,
    avgPower: s.elapsed > 0 ? Math.round((s.kilojoules * 1000) / s.elapsed) : 0,
  };
}
