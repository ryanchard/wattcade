import type { RunResult, ScoreEvent } from '@paperboy/game-core';
import type { RiderProfile, SimulationParams } from '@paperboy/trainer';
import { clampGrade } from '@paperboy/trainer';
import { createWorld, gradeAt, surfaceCrr } from './world.js';
import type { WorldState } from './world.js';
import { stepWorld } from './rules.js';

export const POWER_TAU_S = 0.25;
export const FIXED_DT = 1 / 120;
/**
 * main.ts clamps a frame to 0.25 s, which at FIXED_DT needs exactly 30
 * substeps. A lower cap would silently slow the game down whenever a frame
 * ran long, rather than only when the tab had genuinely stalled.
 */
export const MAX_SUBSTEPS = 30;
export const MAX_PLAUSIBLE_WATTS = 2000;

export interface Session {
  world: WorldState;
  profile: RiderProfile;
  powerTarget: number;
  powerCurrent: number;
  kilojoules: number;
  paused: boolean;
  /**
   * Time left over from the last advanceFixed call that wasn't enough to
   * fill a whole FIXED_DT substep. Without this, any frame shorter than
   * FIXED_DT (e.g. every frame at 144 Hz, where dt ~ 6.9 ms < 8.3 ms)
   * advances zero substeps and the game never moves.
   */
  accumulator: number;
  /**
   * A throw press that arrived on a frame which ran zero substeps. It is
   * carried forward rather than dropped, and is consumed by the first
   * substep that does run.
   */
  pendingThrow: boolean;
}

export interface SessionInput {
  steer: number;
  throwPaper: boolean;
}

export function createSession(seed: number, profile: RiderProfile): Session {
  return {
    world: createWorld(seed),
    profile,
    powerTarget: 0,
    powerCurrent: 0,
    kilojoules: 0,
    paused: false,
    accumulator: 0,
    pendingThrow: false,
  };
}

export function setPower(s: Session, watts: number | null): void {
  if (watts === null || !Number.isFinite(watts) || watts < 0) {
    s.powerTarget = 0;
    return;
  }
  s.powerTarget = Math.min(MAX_PLAUSIBLE_WATTS, watts);
}

export function advance(
  s: Session, input: SessionInput, dt: number,
): ScoreEvent[] {
  if (s.paused || s.world.gameOver) return [];

  // Trainers notify at 1-4 Hz. Easing rather than stepping keeps the rider
  // from lurching once per notification.
  const alpha = 1 - Math.exp(-dt / POWER_TAU_S);
  s.powerCurrent += (s.powerTarget - s.powerCurrent) * alpha;
  s.kilojoules += (s.powerCurrent * dt) / 1000;

  return stepWorld(
    s.world,
    { steer: input.steer, throwPaper: input.throwPaper, powerWatts: s.powerCurrent },
    s.profile,
    dt,
  );
}

export function advanceFixed(
  s: Session, elapsedS: number, input: SessionInput,
): void {
  // A throw is edge-triggered, but it must survive a frame that runs zero
  // substeps (see `pendingThrow` on Session) rather than being dropped.
  if (input.throwPaper) s.pendingThrow = true;

  s.accumulator += elapsedS;

  let steps = 0;
  while (s.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    const throwPaper = s.pendingThrow;
    s.pendingThrow = false;
    advance(s, { steer: input.steer, throwPaper }, FIXED_DT);
    s.accumulator -= FIXED_DT;
    steps += 1;
  }

  // A genuine stall (tab backgrounded, debugger paused, ...) should drop
  // its backlog of substeps rather than replay them all in one burst once
  // the tab wakes back up.
  if (steps === MAX_SUBSTEPS) s.accumulator = 0;
}

export function simulationFor(s: Session): SimulationParams {
  return {
    grade: clampGrade(gradeAt(s.world, s.world.rider.distance)),
    headwind: 0,
    crr: surfaceCrr(s.world.rider.lateral),
    cw: 0.51,
  };
}

/**
 * The flat, unloaded simulation a resting trainer should see: zero grade,
 * zero headwind, a token rolling resistance, and an arbitrary (unused at
 * zero grade) drag coefficient. Used whenever the rider is not actually
 * being asked to push against the road — paused, panicked, or the run is
 * over — so a coalescing writer's next flush always carries this value
 * rather than a stale grade from the moment the state changed.
 */
export const FLAT_SIMULATION: SimulationParams = {
  grade: 0, headwind: 0, crr: 0.004, cw: 0.51,
};

/**
 * The single simulation value the app should send to the trainer this
 * frame. Callers must make exactly one setSimulation call per frame using
 * this value — never the raw `simulationFor` result directly and never a
 * second call afterwards — because ControlPointWriter coalesces pending
 * writes and only the last value set before a flush is the one that
 * reaches the wire.
 */
export function effectiveSimulation(s: Session): SimulationParams {
  return s.paused || s.world.gameOver ? FLAT_SIMULATION : simulationFor(s);
}

export function toRunResult(s: Session): RunResult {
  const seconds = s.world.elapsed;
  return {
    seed: s.world.seed,
    score: s.world.score.score,
    distanceM: Math.round(s.world.rider.distance),
    durationMs: Math.round(seconds * 1000),
    avgPower: seconds > 0 ? Math.round((s.kilojoules * 1000) / seconds) : 0,
    kilojoules: Math.round(s.kilojoules),
    papersDelivered: s.world.score.papersDelivered,
  };
}
