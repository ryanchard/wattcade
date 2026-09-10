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
  const steps = Math.min(MAX_SUBSTEPS, Math.floor(elapsedS / FIXED_DT));
  for (let i = 0; i < steps; i++) {
    // A throw is edge-triggered: only the first substep of a frame may throw.
    advance(s, { steer: input.steer, throwPaper: input.throwPaper && i === 0 }, FIXED_DT);
  }
}

export function simulationFor(s: Session): SimulationParams {
  return {
    grade: clampGrade(gradeAt(s.world, s.world.rider.distance)),
    headwind: 0,
    crr: surfaceCrr(s.world.rider.lateral),
    cw: 0.51,
  };
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
