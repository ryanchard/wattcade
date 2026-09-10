/**
 * The ride loop, and the only place in the arcade that decides what the
 * trainer is told.
 *
 * This file exists because the alternative already failed. When each game
 * owned its own write loop, a panic key shipped whose zero was overwritten
 * before the trainer's next 4 Hz flush, so the emergency stop did nothing.
 * The rule that prevents that is not "remember to write zero" — it is that
 * nothing writes to the trainer except `tickRide`, exactly once per frame,
 * with a value that is a pure function of state.
 *
 * So: Escape, pause, a hidden tab and a finished run all set STATE.
 * `effectiveSimulation` reads that state. `tickRide` performs the single
 * write. Nothing here reaches for Bluetooth, `requestAnimationFrame` or the
 * DOM, which is what lets all of it be tested.
 */
import type { GameKeys, GameModule, GameSession, RunResult } from '@paperboy/game-api';
import type { SimulationParams, TrainerSource } from '@paperboy/trainer';
import {
  NEUTRAL_GEAR, applyGear, clampGear, shiftDown as gearDown,
  shiftUp as gearUp,
} from './gearing.js';

/**
 * Trainers notify at 1-4 Hz. Easing rather than stepping keeps the rider from
 * lurching once per notification. Lifted unchanged from the games, which all
 * agreed on it.
 */
export const POWER_TAU_S = 0.25;

/** Fixed simulation timestep. Gameplay must not be refresh-rate dependent. */
export const FIXED_DT = 1 / 120;

/**
 * A frame is divided into at most this many substeps. MAX_FRAME_S at FIXED_DT
 * needs exactly 30, so a long-but-honest frame is simulated in full and only a
 * genuine stall — a backgrounded tab, a paused debugger — drops its backlog.
 * A lower cap would silently slow the game down whenever a frame ran long.
 */
export const MAX_SUBSTEPS = 30;

/** No single frame may advance the world by more than this. */
export const MAX_FRAME_S = 0.25;

/** A trainer reporting more than this is misbehaving. Clamp it. */
export const MAX_PLAUSIBLE_WATTS = 2000;

/** Likewise for cadence: nobody pedals faster than this, so a reading above
 * it is a decoding glitch rather than a rider, and is treated as no reading
 * at all. Cadence-steered games would otherwise be flung by one bad frame. */
export const MAX_PLAUSIBLE_RPM = 250;

/**
 * The flat, unloaded simulation a resting trainer should see: no grade, no
 * headwind, a token rolling resistance, and a drag coefficient that does not
 * matter at zero grade and zero speed. This is what the rider gets whenever
 * they are not actually being asked to push against a road.
 */
export const FLAT_SIMULATION: SimulationParams = Object.freeze({
  grade: 0, headwind: 0, crr: 0.004, cw: 0.51,
});

export interface Ride {
  game: GameModule | null;
  session: GameSession | null;
  /** The rider pressed pause. Only the rider clears it. */
  paused: boolean;
  /** The tab is hidden or the screen slept. Clears itself on return. */
  hidden: boolean;
  /** The page is going away and the trainer has been let go for good. */
  released: boolean;
  /** Watts as last reported by the trainer, clamped. */
  powerTarget: number;
  /** Watts after easing — what the session actually integrates. */
  powerCurrent: number;
  /** Cadence as last reported, or null when the trainer reports none. Passed
   * through unsmoothed — see `GameSession.setCadence`. */
  cadenceRpm: number | null;
  /** Time left over from the last frame, too small to fill a substep. Without
   * it, every frame at 144 Hz (6.9 ms < 8.3 ms) advances nothing at all. */
  accumulator: number;
  /** Seconds actually simulated this run, for the shell's own clock. */
  elapsedS: number;
  /** True once this run's ending has been dealt with, so it is dealt with
   * once: records written once, results card built once. */
  ended: boolean;
  /**
   * The virtual gear, applied to whatever the game asks for on its way to the
   * trainer. Owned here rather than by a game for the same reason every write
   * is: one place decides what the trainer is told. See `gearing.ts`.
   */
  gear: number;
}

export interface FrameInput {
  readonly dtSeconds: number;
  readonly keys: GameKeys;
  readonly width: number;
  readonly height: number;
}

export const NO_KEYS: GameKeys = {
  held: new Set<string>(), pressed: new Set<string>(),
};

export function createRide(): Ride {
  return {
    game: null,
    session: null,
    paused: false,
    hidden: false,
    released: false,
    powerTarget: 0,
    powerCurrent: 0,
    cadenceRpm: null,
    accumulator: 0,
    elapsedS: 0,
    ended: false,
    gear: NEUTRAL_GEAR,
  };
}

/** Puts a freshly created session on the road. */
export function startRide(r: Ride, game: GameModule, session: GameSession): void {
  r.game = game;
  r.session = session;
  r.paused = false;
  r.accumulator = 0;
  r.elapsedS = 0;
  r.ended = false;
  // Deliberately NOT resetting powerCurrent: the rider is already pedalling
  // when they press start, and snapping their watts to zero would have the
  // game open with a stall it then has to ease out of.
}

/** Back to the hub. No game is running, so the trainer goes flat. */
export function clearRide(r: Ride): void {
  r.game = null;
  r.session = null;
  r.paused = false;
  r.accumulator = 0;
  r.ended = false;
}

export function setPower(r: Ride, watts: number | null): void {
  if (watts === null || !Number.isFinite(watts) || watts < 0) {
    r.powerTarget = 0;
    return;
  }
  r.powerTarget = Math.min(MAX_PLAUSIBLE_WATTS, watts);
}

/**
 * The trainer's latest cadence, or null when it reports none. Null is passed
 * through rather than turned into zero, because "not pedalling" and "this
 * trainer has no cadence sensor" are different facts and a cadence game has
 * to tell the rider which one it is looking at.
 */
export function setCadence(r: Ride, rpm: number | null): void {
  if (rpm === null || !Number.isFinite(rpm) || rpm < 0 || rpm > MAX_PLAUSIBLE_RPM) {
    r.cadenceRpm = null;
    return;
  }
  r.cadenceRpm = rpm;
}

/**
 * The gear the rider is in. Deliberately survives `startRide` and
 * `clearRide`: a gear is a fact about this rider's legs, not about this run,
 * and being dropped back into neutral between games is exactly the thing a
 * single-speed rider is trying to escape.
 */
export function setGear(r: Ride, gear: number): void {
  r.gear = clampGear(gear);
}

/** One gear taller. Returns the gear now in use, so the caller can persist
 * it without having to know how the clamping went. */
export function shiftUp(r: Ride): number {
  r.gear = gearUp(r.gear);
  return r.gear;
}

/** One gear smaller. */
export function shiftDown(r: Ride): number {
  r.gear = gearDown(r.gear);
  return r.gear;
}

/**
 * Whether the gear applies to what is on screen. A single-speed game gets the
 * load its author tuned and nothing else — and the hub and the band both read
 * this, so the rider is never shown a gear that is not doing anything.
 */
export function isGeared(r: Ride): boolean {
  return r.game !== null && r.game.singleSpeed !== true;
}

export function setPaused(r: Ride, paused: boolean): void {
  r.paused = paused;
}

export function togglePaused(r: Ride): void {
  r.paused = !r.paused;
}

/**
 * The tab went away or came back. Hidden is kept separate from paused because
 * they are undone by different people: the browser lifts this one, the rider
 * lifts the other.
 */
export function setHidden(r: Ride, hidden: boolean): void {
  r.hidden = hidden;
}

/**
 * The page is unloading. After this the trainer is flat for good as far as
 * this session is concerned, whether or not another frame ever runs.
 */
export function releaseRide(r: Ride): void {
  r.released = true;
}

/**
 * The safety stop. Ends the run through the game's own `stop`, which sets
 * state and writes nothing. The relaxing of the trainer happens on the next
 * frame's single write — or, if no frame ever comes, through the direct flat
 * write the caller makes alongside `releaseRide`.
 */
export function stopRide(r: Ride): void {
  const s = r.session;
  if (s === null || s.isOver) return;
  s.stop();
}

/**
 * Whether the rider is being asked to push against a road right now. Every
 * reason to relax the trainer is one of these, in one place.
 */
export function isUnderLoad(r: Ride): boolean {
  return (
    r.session !== null &&
    !r.session.isOver &&
    !r.paused &&
    !r.hidden &&
    !r.released
  );
}

/**
 * The single simulation value to send this frame. The game says what it
 * wants; this decides what it gets.
 *
 * The gear is applied here and only here, INSIDE the under-load test, so
 * there is no path by which a gear can survive a pause, a hidden tab or the
 * safety stop: every one of those returns the flat value untouched, whatever
 * the rider last shifted to. `applyGear` clamps the grade it produces, so the
 * ±8% limit is not reachable through gearing either.
 */
export function effectiveSimulation(r: Ride): SimulationParams {
  if (!isUnderLoad(r)) return FLAT_SIMULATION;
  const wanted = r.session!.simulation();
  return isGeared(r) ? applyGear(wanted, r.gear) : wanted;
}

/**
 * Advances the active session. Does not touch the trainer — see `tickRide`,
 * which is the only thing that does.
 */
export function advanceRide(r: Ride, frame: FrameInput): void {
  if (!isUnderLoad(r)) return;
  const s = r.session!;
  const dt = Math.min(MAX_FRAME_S, Math.max(0, frame.dtSeconds));

  // Keyboard reaches a session only if its game asked for any. That is what
  // keeps The Pack and Velodrome legs-only by construction.
  if (r.game !== null && r.game.controls.length > 0 && s.handleKeys !== undefined) {
    s.handleKeys(frame.keys);
  }

  // Cadence is handed over whole, once per frame, ahead of the substeps. It
  // is not eased and not divided across them: it is a position on a dial the
  // rider is holding, not a quantity being integrated.
  s.setCadence?.(r.cadenceRpm);

  // Presentation that must not affect the simulation gets real frame time.
  s.animate?.(dt, frame.width, frame.height);

  r.accumulator += dt;
  let steps = 0;
  while (r.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    const alpha = 1 - Math.exp(-FIXED_DT / POWER_TAU_S);
    r.powerCurrent += (r.powerTarget - r.powerCurrent) * alpha;
    s.advance(FIXED_DT, r.powerCurrent);
    r.accumulator -= FIXED_DT;
    r.elapsedS += FIXED_DT;
    steps += 1;
    if (s.isOver) break;
  }

  // A genuine stall drops its backlog rather than replaying it in one burst
  // the moment the tab wakes up.
  if (steps === MAX_SUBSTEPS) r.accumulator = 0;
}

/**
 * One frame: advance, then say one thing to the trainer.
 *
 * The write is last and unconditional. Last, because `ControlPointWriter`
 * coalesces pending simulation writes and only the newest one survives to the
 * wire — anything written after this would be what the trainer actually got.
 * Unconditional, because a rider sitting on the hub with a trainer still
 * paired should be getting flat, repeatedly, rather than the last grade of
 * whatever they were riding a minute ago.
 */
export function tickRide(
  r: Ride, source: TrainerSource | null, frame: FrameInput,
): void {
  advanceRide(r, frame);
  source?.setSimulation(effectiveSimulation(r));
}

/**
 * Deals with a finished run exactly once: lets the game write its own records
 * and hands back the card to show. Returns null while the run is still going,
 * and on every call after the first.
 */
export function finishRide(r: Ride, store: Storage): RunResult | null {
  const s = r.session;
  if (s === null || !s.isOver || r.ended) return null;
  r.ended = true;
  s.onEnd?.(store);
  return s.result();
}
