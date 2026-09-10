import type { RiderProfile, SimulationParams } from '@paperboy/game-api';
import {
  advanceWPrime, createWPrime, criticalPower, sustainablePower, wPrimeFraction,
} from '@paperboy/game-core';
import type { WPrimeState } from '@paperboy/game-core';
import { clampGrade, stepPhysics } from '@paperboy/trainer';

// ---------------------------------------------------------------------------
// TUNABLES — everything that shapes how the loop feels lives here, in one
// place, because these numbers get retuned by feel after actually riding.
// ---------------------------------------------------------------------------

/** Trainers notify at 1-4 Hz; easing (not stepping) keeps the rider from
 * lurching once per notification. Time constant of the exponential ease. */
export const POWER_TAU_S = 0.25;

/** Fixed simulation timestep. Gameplay must not be refresh-rate dependent —
 * see FIXED_DT's twin in apps/canvas/src/session.ts for the 144Hz history. */
export const FIXED_DT = 1 / 120;

/** A single frame is divided into at most this many FIXED_DT substeps. A
 * genuine stall (backgrounded tab, debugger pause) drops its backlog rather
 * than replaying it all at once when the tab wakes back up. */
export const MAX_SUBSTEPS = 30;

/** A trainer reporting more than this is misbehaving; clamp rather than let
 * a glitchy reading fling the physics into nonsense. */
export const MAX_PLAUSIBLE_WATTS = 2000;

/** Distance (m) ahead of the pack at the start of a run. */
export const GAP_INITIAL_M = 20;

/** Pack speed (m/s) at the start of a run — a gentle trot. */
export const PACK_INITIAL_SPEED_MPS = 4.0;

/** The pack's speed creeps upward by this much every second, so every run
 * eventually ends no matter how hard the rider pedals. */
export const PACK_ACCEL_MPS2 = 0.006;

/** Seconds between the first dog latching on and the run start. */
export const DOG_ATTACH_INITIAL_INTERVAL_S = 20;

/** Each subsequent attach interval shrinks by this factor — the pack grows
 * faster than a rider can shed it, on purpose. */
export const DOG_ATTACH_INTERVAL_DECAY = 0.9;

/** Attach interval never drops below this floor. */
export const DOG_ATTACH_MIN_INTERVAL_S = 6;

/** Baseline road grade with zero dogs attached. */
export const BASE_GRADE_PERCENT = 0;

/** Grade (percent) added to the road for every dog currently attached. This
 * is sent to the trainer (clamped to +/-8%, see clampGrade) AND fed into the
 * local physics step, so drag is felt on screen, not just displayed. */
export const GRADE_PER_DOG_PERCENT = 1.2;

/** Rolling resistance (crr) added for every dog currently attached, on top
 * of the rider profile's baseline crr. */
export const CRR_PER_DOG = 0.006;

/** Shake threshold as a fraction of the rider's FTP — demanding but
 * achievable, per the design brief's "~130% of FTP" starting point. */
export const SHAKE_POWER_FRACTION_OF_FTP = 1.3;

/** Seconds of continuous power above the shake threshold needed to throw the
 * most recently attached dog. Breaking the effort resets progress to zero. */
export const SHAKE_HOLD_DURATION_S = 4;

// ---------------------------------------------------------------------------

export interface Session {
  profile: RiderProfile;
  elapsed: number;
  distance: number;
  speed: number;
  gap: number;
  packSpeed: number;
  dogs: number;
  dogsShaken: number;
  /** Seconds since the last dog attached (or since run start). */
  timeSinceLastDog: number;
  /** Interval that must elapse before the *next* dog attaches. Shrinks
   * (down to the floor) each time a dog latches on. */
  dogInterval: number;
  /** Seconds power has been continuously above the shake threshold. */
  shakeHoldS: number;
  powerTarget: number;
  powerCurrent: number;
  /** What the legs actually produced: `powerCurrent` after the anaerobic
   * store has had its say. Drives the physics and the shake test, so an
   * empty rider cannot throw a dog however hard they are pushing. */
  powerEffective: number;
  /** The anaerobic store, and the line it is spent above. */
  wPrime: WPrimeState;
  criticalPowerW: number;
  kilojoules: number;
  paused: boolean;
  /** True once the pack has caught the rider, or the rider has hit the
   * safety stop. The run is over and further advance() calls are inert. */
  caught: boolean;
  /** Carry-over time from the last advanceFixed call, see apps/canvas's
   * twin field for why this is required at high refresh rates. */
  accumulator: number;
}

export function createSession(profile: RiderProfile): Session {
  return {
    profile,
    elapsed: 0,
    distance: 0,
    speed: 0,
    gap: GAP_INITIAL_M,
    packSpeed: PACK_INITIAL_SPEED_MPS,
    dogs: 0,
    dogsShaken: 0,
    timeSinceLastDog: 0,
    dogInterval: DOG_ATTACH_INITIAL_INTERVAL_S,
    shakeHoldS: 0,
    powerTarget: 0,
    powerCurrent: 0,
    powerEffective: 0,
    wPrime: createWPrime(profile),
    criticalPowerW: criticalPower(profile),
    kilojoules: 0,
    paused: false,
    caught: false,
    accumulator: 0,
  };
}

export function setPower(s: Session, watts: number | null): void {
  if (watts === null || !Number.isFinite(watts) || watts < 0) {
    s.powerTarget = 0;
    return;
  }
  s.powerTarget = Math.min(MAX_PLAUSIBLE_WATTS, watts);
}

/** The shake threshold in watts for this rider's FTP. */
export function shakeThreshold(profile: RiderProfile): number {
  return profile.ftpWatts * SHAKE_POWER_FRACTION_OF_FTP;
}

/**
 * WHAT ONE DOG COSTS, in joules out of the anaerobic store.
 *
 * A shake is SHAKE_HOLD_DURATION_S seconds at SHAKE_POWER_FRACTION_OF_FTP,
 * and the part of that above critical power has to be paid for out of the
 * same battery the velodrome runs on. For a 235 W rider that is 282 J a shake
 * against a 22 kJ store — cheap on its own, which is right, because the real
 * cost is the riding between the shakes: every dog on you is another 1.2% of
 * grade, and holding the pack off with four of them attached is well above
 * threshold before you try to throw any of them.
 *
 * That is what turns "about ten shakes" into a budget rather than a habit.
 * The threshold is tested against the power the legs ACTUALLY produce, so a
 * rider who has emptied the store cannot reach it however hard they push:
 * the dogs stay on, the road tilts up, and the run ends.
 */
export function shakeCostJoules(profile: RiderProfile): number {
  return Math.max(0, shakeThreshold(profile) - criticalPower(profile))
    * SHAKE_HOLD_DURATION_S;
}

/** Pure gap update: grows while the rider outpaces the pack, shrinks when
 * the pack is faster. Exposed standalone so the rule is directly testable
 * without going through the full physics stack. */
export function stepGap(
  gap: number, riderSpeed: number, packSpeed: number, dt: number,
): number {
  return gap + (riderSpeed - packSpeed) * dt;
}

/** Unclamped road grade for the given dog count — BASE plus a per-dog
 * penalty. Clamped separately (via clampGrade) at the point of use, so both
 * the trainer write and the local physics step agree on the same number. */
export function gradePercentFor(dogs: number): number {
  return BASE_GRADE_PERCENT + GRADE_PER_DOG_PERCENT * dogs;
}

/** Rolling resistance for the given dog count, on top of the rider's own
 * baseline crr. */
export function crrFor(profile: RiderProfile, dogs: number): number {
  return profile.crr + CRR_PER_DOG * dogs;
}

/** Immediately ends the run — the Escape safety stop. Never writes to the
 * trainer directly; callers must let effectiveSimulation flatten resistance
 * on the next frame's single setSimulation call. */
export function stopRun(s: Session): void {
  s.paused = true;
  s.caught = true;
}

export function advance(s: Session, dt: number): void {
  if (s.paused || s.caught) return;

  // Trainers notify at 1-4 Hz. Easing rather than stepping keeps the rider
  // from lurching once per notification.
  const alpha = 1 - Math.exp(-dt / POWER_TAU_S);
  s.powerCurrent += (s.powerTarget - s.powerCurrent) * alpha;
  // The power meter recorded what the legs did, whatever the store had left
  // to turn it into speed, so the results card reads the honest figure.
  s.kilojoules += (s.powerCurrent * dt) / 1000;

  // What actually reaches the road, and what the store is debited for.
  s.powerEffective = sustainablePower(
    s.powerCurrent, s.criticalPowerW, wPrimeFraction(s.wPrime),
  );
  advanceWPrime(s.wPrime, s.powerEffective, s.criticalPowerW, dt);

  const grade = clampGrade(gradePercentFor(s.dogs));
  const crr = crrFor(s.profile, s.dogs);
  const next = stepPhysics(
    { speed: s.speed, distance: s.distance },
    { powerWatts: s.powerEffective, gradePercent: grade, crr, headwind: 0 },
    s.profile,
    dt,
  );
  s.speed = next.speed;
  s.distance = next.distance;
  s.elapsed += dt;

  s.gap = stepGap(s.gap, s.speed, s.packSpeed, dt);
  s.packSpeed += PACK_ACCEL_MPS2 * dt;

  s.timeSinceLastDog += dt;
  if (s.timeSinceLastDog >= s.dogInterval) {
    s.timeSinceLastDog -= s.dogInterval;
    s.dogs += 1;
    s.dogInterval = Math.max(
      DOG_ATTACH_MIN_INTERVAL_S, s.dogInterval * DOG_ATTACH_INTERVAL_DECAY,
    );
    // A newly-latched dog becomes the "most recent" one — any progress
    // toward shaking the previous most-recent dog no longer applies to it.
    s.shakeHoldS = 0;
  }

  if (s.dogs > 0 && s.powerEffective >= shakeThreshold(s.profile)) {
    s.shakeHoldS += dt;
    if (s.shakeHoldS >= SHAKE_HOLD_DURATION_S) {
      s.dogs -= 1;
      s.dogsShaken += 1;
      s.shakeHoldS = 0;
    }
  } else {
    s.shakeHoldS = 0;
  }

  if (s.gap <= 0) {
    s.gap = 0;
    s.caught = true;
  }
}

export function advanceFixed(s: Session, elapsedS: number): void {
  s.accumulator += elapsedS;

  let steps = 0;
  while (s.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    advance(s, FIXED_DT);
    s.accumulator -= FIXED_DT;
    steps += 1;
  }

  // A genuine stall should drop its backlog of substeps rather than replay
  // them all in one burst once the tab wakes back up.
  if (steps === MAX_SUBSTEPS) s.accumulator = 0;
}

export function simulationFor(s: Session): SimulationParams {
  return {
    grade: clampGrade(gradePercentFor(s.dogs)),
    headwind: 0,
    crr: crrFor(s.profile, s.dogs),
    cw: 0.51,
  };
}

/** The flat, unloaded simulation a resting trainer should see. Used
 * whenever the rider is not actually being asked to push against
 * anything — paused, panicked, or the run is over — so a coalescing
 * writer's next flush always carries this value rather than a stale grade
 * from the moment the state changed. */
export const FLAT_SIMULATION: SimulationParams = {
  grade: 0, headwind: 0, crr: 0.004, cw: 0.51,
};

/** The single simulation value the app should send to the trainer this
 * frame. Callers must make exactly one setSimulation call per frame using
 * this value — never the raw simulationFor result directly and never a
 * second call afterwards — because ControlPointWriter coalesces pending
 * writes and only the last value set before a flush reaches the wire. */
export function effectiveSimulation(s: Session): SimulationParams {
  return s.paused || s.caught ? FLAT_SIMULATION : simulationFor(s);
}

export interface PackRunResult {
  distanceM: number;
  durationMs: number;
  dogsShaken: number;
  avgPower: number;
  /** What was left of the anaerobic store when the pack caught you, 0..1. */
  batteryLeft: number;
}

export function toRunResult(s: Session): PackRunResult {
  const seconds = s.elapsed;
  return {
    distanceM: Math.round(s.distance),
    durationMs: Math.round(seconds * 1000),
    dogsShaken: s.dogsShaken,
    avgPower: seconds > 0 ? Math.round((s.kilojoules * 1000) / seconds) : 0,
    batteryLeft: wPrimeFraction(s.wPrime),
  };
}
