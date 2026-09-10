import type { RiderProfile, SimulationParams } from '@paperboy/game-api';
import {
  advanceWPrime, createWPrime, criticalPower, sustainablePower, wPrimeFraction,
} from '@paperboy/game-core';
import type { WPrimeState } from '@paperboy/game-core';
import { AIR_DENSITY, G, clampGrade, stepPhysics } from '@paperboy/trainer';
import type { MoveMemory, RivalContext, RivalSpec } from './rivals.js';
import { createMoveMemory, rivalPowerFraction } from './rivals.js';

/**
 * The race. Both riders, the gap, the draft, the lap count and the finish.
 *
 * Pure: no DOM, no browser globals, no clock of its own. Everything that
 * decides who wins lives here and is headlessly testable; render.ts and
 * main.ts only draw it and feed it watts.
 *
 * WHY THE DRAFT IS THE GAME. On the flat at track speed, 87% of a rider's
 * power is fighting air. Rider weight is nearly irrelevant — 20 kg costs
 * about 12 W. Sitting on a wheel removes roughly 26% of the total power
 * demand, about 100 W at racing speed. There is nothing else on a track with
 * anything like that leverage, so the draft is the only tactic that matters
 * and everything in this module serves it.
 *
 * AND BOTH RIDERS HAVE A BATTERY. Every watt either of them puts above
 * critical power comes out of a finite store (`@paperboy/game-core`'s W-prime),
 * and when a store is gone that rider fades back toward CP and cannot kick.
 * Neither side is exempt: the player's drains from their measured power, the
 * rival's from its scripted power, on the identical implementation. That is
 * what makes "force the pace" a mechanism, what stops one big sprint winning
 * every race on the ladder, and what makes sitting in worth something you
 * still have at the finish rather than only in the moment.
 */

// ---------------------------------------------------------------------------
// TUNABLES — retuned by feel after actually riding, so they live together.
// ---------------------------------------------------------------------------

/** Track geometry. A standard indoor velodrome lap. */
export const LAP_LENGTH_M = 250;
export const RACE_LAPS = 4;
export const RACE_DISTANCE_M = LAP_LENGTH_M * RACE_LAPS;

/** A track is flat. The grade never moves, which is exactly why the wind
 * resistance coefficient carries the whole game here. */
export const TRACK_GRADE_PERCENT = 0;

/**
 * THE KILLER FEATURE. FTMS's Set Indoor Bike Simulation Parameters takes a
 * wind resistance coefficient separately from grade, so the draft can be
 * delivered as REAL RESISTANCE: the trainer physically eases when the rider
 * gets on a wheel and bites when they pull out. This is not a HUD icon and
 * not a numeric modifier — it is the flywheel going quiet in your legs.
 *
 * The same ratio is applied to the local physics step (see draftedProfile),
 * so screen speed and felt resistance agree with each other and with the
 * streaming air the renderer draws.
 */
export const CW_OPEN = 0.51;
export const CW_DRAFT = 0.36;

/** Local drag must be reduced by the same proportion the trainer is told
 * about, or the picture and the legs disagree. stepPhysics takes drag from
 * the rider profile's cdA, so the ratio is applied there. */
export const DRAFT_CDA_RATIO = CW_DRAFT / CW_OPEN;

/**
 * The shelter window, in metres behind the rider in front. Closer than
 * DRAFT_MIN_M and you are overlapping wheels rather than sitting in;
 * further than DRAFT_MAX_M and the hole in the air has closed up again.
 * Leading is never sheltered.
 */
export const DRAFT_MIN_M = 0.5;
export const DRAFT_MAX_M = 3.5;

/**
 * Slack added to both edges of the window for a rider who is ALREADY
 * sheltered. Without it a rider hovering at exactly 3.5 m would flick the
 * cw write on and off at the writer's 4 Hz flush rate, and the flywheel
 * would flutter instead of biting. Getting on a wheel should be a decision
 * you feel once, not a stutter.
 */
export const DRAFT_HYSTERESIS_M = 0.4;

/** Trainers notify at 1-4 Hz. Easing (not stepping) toward the reading keeps
 * the rider from lurching once per notification. */
export const POWER_TAU_S = 0.25;

/** The rival's own ramp. Slower than the player's, because this models a
 * body changing effort rather than a radio packet arriving — it is what
 * makes a surge read as an acceleration rather than a teleport. */
export const RIVAL_POWER_TAU_S = 0.6;

/** Fixed simulation timestep, so gameplay is not refresh-rate dependent. */
export const FIXED_DT = 1 / 120;

/** main.ts clamps a frame to 0.25 s, which at FIXED_DT needs exactly 30
 * substeps. A genuine stall drops its backlog rather than replaying it. */
export const MAX_SUBSTEPS = 30;

/** A trainer reporting more than this is misbehaving. */
export const MAX_PLAUSIBLE_WATTS = 2000;

// ---------------------------------------------------------------------------

export type Winner = 'player' | 'rival' | null;

export interface RaceRider {
  distance: number;
  speed: number;
  powerTarget: number;
  powerCurrent: number;
  /**
   * What actually reached the road: `powerCurrent` after the anaerobic store
   * has had its say. Identical to it until the store runs low, and then it
   * sags toward CP. This — not `powerCurrent` — is what drives the physics
   * and what the store itself is debited for, so an empty rider self-limits
   * instead of hammering a balance that is already at zero.
   */
  powerEffective: number;
  /** The anaerobic store. Capacity comes from the rider profile. */
  wPrime: WPrimeState;
  kilojoules: number;
  /** Whether this rider was sheltered during the most recent step. */
  drafting: boolean;
  /** Total seconds spent sheltered. Kept in state rather than derived, so
   * the post-race "you sat in for X% of it" number is as replayable as the
   * result itself. */
  draftedS: number;
}

export interface RaceState {
  /** The player's profile. The rival races on an identical one, so "% of
   * your FTP" means what it says and the ladder is fair at any fitness. */
  profile: RiderProfile;
  spec: RivalSpec;
  player: RaceRider;
  rival: RaceRider;
  /** Elapsed times at which each of the rival's scripted moves fired. */
  moveMemory: MoveMemory;
  elapsed: number;
  /** Signed, in metres: positive when the PLAYER leads. */
  gap: number;
  paused: boolean;
  finished: boolean;
  winner: Winner;
  /** Critical power in watts, for both riders: they race on one profile, so
   * "a fraction of your FTP" means the same thing on both sides of the gap. */
  criticalPowerW: number;
  /** True when the rider hit the Escape safety stop rather than finishing. */
  aborted: boolean;
  finishTimeS: number;
  /** Carry-over time from the last advanceFixed call. Without it, any frame
   * shorter than FIXED_DT (every frame at 144 Hz) advances zero substeps. */
  accumulator: number;
}

function createRider(profile: RiderProfile): RaceRider {
  return {
    distance: 0, speed: 0, powerTarget: 0,
    powerCurrent: 0, powerEffective: 0, wPrime: createWPrime(profile),
    kilojoules: 0, drafting: false, draftedS: 0,
  };
}

export function createRace(profile: RiderProfile, spec: RivalSpec): RaceState {
  return {
    profile,
    spec,
    player: createRider(profile),
    rival: createRider(profile),
    criticalPowerW: criticalPower(profile),
    moveMemory: createMoveMemory(spec),
    elapsed: 0,
    gap: 0,
    paused: false,
    finished: false,
    winner: null,
    aborted: false,
    finishTimeS: 0,
    accumulator: 0,
  };
}

export function setPower(s: RaceState, watts: number | null): void {
  if (watts === null || !Number.isFinite(watts) || watts < 0) {
    s.player.powerTarget = 0;
    return;
  }
  s.player.powerTarget = Math.min(MAX_PLAUSIBLE_WATTS, watts);
}

// --- the draft ------------------------------------------------------------

function inShelter(behind: number, alreadySheltered: boolean): boolean {
  const slack = alreadySheltered ? DRAFT_HYSTERESIS_M : 0;
  return behind >= DRAFT_MIN_M - slack && behind <= DRAFT_MAX_M + slack;
}

/** True when the player is sitting in the rival's shelter: BEHIND them, by
 * between DRAFT_MIN_M and DRAFT_MAX_M. Leading is never sheltered. Pass the
 * previous frame's answer to get the hysteresis that stops the trainer
 * fluttering at the edge; omit it for the strict window. */
export function playerDrafting(gap: number, alreadySheltered = false): boolean {
  return inShelter(-gap, alreadySheltered);
}

/** The same rule from the other side. The rival gets shelter off the player
 * on identical terms — model it symmetrically or the tactics are dishonest,
 * and half the ladder (the Wheelsucker above all) stops making sense. */
export function rivalDrafting(gap: number, alreadySheltered = false): boolean {
  return inShelter(gap, alreadySheltered);
}

/** The rider profile to integrate a sheltered rider with: the same rider,
 * with the hole in the air taken out of their frontal drag. */
export function draftedProfile(profile: RiderProfile): RiderProfile {
  return { ...profile, cdA: profile.cdA * DRAFT_CDA_RATIO };
}

/**
 * What the hole in the air is WORTH, in watts, to a rider sheltered at
 * `speed`. Zero at a standstill and about 50 W at this game's track pace.
 *
 * Subtracted, not scaled, because that is what a draft physically does: it
 * removes part of one resistive force. Only the air term moves — rolling
 * resistance is unchanged by the wheel in front, and, crucially, so is the
 * power going into ACCELERATION. Scaling the whole demand by a steady-state
 * ratio would have had a sheltered rival accelerating more slowly than the
 * rider it was sitting on, dropping the wheel in the first ten seconds of
 * every race and rediscovering the wind. Both riders leave the line level,
 * so those ten seconds happen every time.
 *
 * For the default rider on the flat:
 *
 *   |    speed | air drag | shelter is worth |
 *   | -------: | -------: | ---------------: |
 *   |    2 m/s |    0.8 N |              1 W |
 *   |    6 m/s |    7.1 N |             13 W |
 *   |  9.6 m/s |   18.1 N |             53 W |
 *   |   13 m/s |   33.1 N |            130 W |
 */
export function draftSavingWatts(profile: RiderProfile, speed: number): number {
  const v = Math.max(0, speed);
  const air = 0.5 * AIR_DENSITY * profile.cdA * v * v;
  return (air * (1 - DRAFT_CDA_RATIO) * v) / profile.drivetrainEfficiency;
}

/** The wind resistance coefficient to send to the trainer for a rider in
 * this state. Pure, and the single source of truth for both the FTMS write
 * and the streaming-air the renderer draws. */
export function cwFor(drafting: boolean): number {
  return drafting ? CW_DRAFT : CW_OPEN;
}

// --- laps -----------------------------------------------------------------

/** Which lap a rider is on, 1..RACE_LAPS. */
export function lapNumber(distance: number): number {
  const lap = Math.floor(distance / LAP_LENGTH_M) + 1;
  return Math.min(RACE_LAPS, Math.max(1, lap));
}

/** Position around the 250 m loop, 0..1. Drives the oval track map. */
export function lapPhase(distance: number): number {
  const p = (distance % LAP_LENGTH_M) / LAP_LENGTH_M;
  return p < 0 ? p + 1 : p;
}

/** Metres still to run. */
export function metresRemaining(distance: number): number {
  return Math.max(0, RACE_DISTANCE_M - distance);
}

// --- the step -------------------------------------------------------------

function easeToward(current: number, target: number, tau: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * Spends one rider's store for this step and says what their legs actually
 * produce. Runs for BOTH riders, on the same function, because a rule that
 * applied to one of them would be a handicap rather than a model.
 */
function spend(r: RaceRider, cp: number, dt: number): void {
  r.powerEffective = sustainablePower(
    r.powerCurrent, cp, wPrimeFraction(r.wPrime),
  );
  // Debited for what the legs produced, not for what was asked of them: the
  // fade is the reason a store can approach empty without ever being asked
  // to go past it.
  advanceWPrime(r.wPrime, r.powerEffective, cp, dt);
}

export function advance(s: RaceState, dt: number): void {
  if (s.paused || s.finished) return;

  // Shelter is decided from the gap at the top of the step. It has to be
  // known before the rival picks its power, because sitting in changes what
  // holding the pace costs it — and it decides the drag both riders are then
  // integrated with.
  s.player.drafting = playerDrafting(s.gap, s.player.drafting);
  s.rival.drafting = rivalDrafting(s.gap, s.rival.drafting);
  if (s.player.drafting) s.player.draftedS += dt;
  if (s.rival.drafting) s.rival.draftedS += dt;

  // The player's watts, eased rather than stepped.
  s.player.powerCurrent = easeToward(
    s.player.powerCurrent, s.player.powerTarget, POWER_TAU_S, dt,
  );
  // Their power meter recorded what their legs did, whatever the store had
  // left to turn it into speed, so the results card reads the honest figure.
  s.player.kilojoules += (s.player.powerCurrent * dt) / 1000;
  spend(s.player, s.criticalPowerW, dt);

  // The rival's watts, from its archetype. Everything the behaviour function
  // can see is in this context; there is no hidden clock and no RNG, so the
  // same player inputs always produce the same race.
  const ctx: RivalContext = {
    t: s.elapsed,
    progress: Math.min(1, s.rival.distance / RACE_DISTANCE_M),
    gap: s.gap,
    closingRate: s.player.speed - s.rival.speed,
    playerEffort: s.player.powerCurrent / Math.max(1, s.profile.ftpWatts),
    shelterSaving: s.rival.drafting
      ? draftSavingWatts(s.profile, s.rival.speed)
        / Math.max(1, s.profile.ftpWatts)
      : 0,
    battery: wPrimeFraction(s.rival.wPrime),
    playerBattery: wPrimeFraction(s.player.wPrime),
  };
  s.rival.powerTarget =
    rivalPowerFraction(s.spec, ctx, s.moveMemory) * s.profile.ftpWatts;
  s.rival.powerCurrent = easeToward(
    s.rival.powerCurrent, s.rival.powerTarget, RIVAL_POWER_TAU_S, dt,
  );
  spend(s.rival, s.criticalPowerW, dt);
  s.rival.kilojoules += (s.rival.powerEffective * dt) / 1000;

  const grade = clampGrade(TRACK_GRADE_PERCENT);
  const stepRider = (r: RaceRider): void => {
    const profile = r.drafting ? draftedProfile(s.profile) : s.profile;
    const next = stepPhysics(
      { speed: r.speed, distance: r.distance },
      {
        powerWatts: r.powerEffective,
        gradePercent: grade,
        crr: s.profile.crr,
        headwind: 0,
      },
      profile,
      dt,
    );
    r.speed = next.speed;
    r.distance = next.distance;
  };
  stepRider(s.player);
  stepRider(s.rival);

  s.gap = s.player.distance - s.rival.distance;
  s.elapsed += dt;

  const playerHome = s.player.distance >= RACE_DISTANCE_M;
  const rivalHome = s.rival.distance >= RACE_DISTANCE_M;
  if (playerHome || rivalHome) {
    s.finished = true;
    s.finishTimeS = s.elapsed;
    // Both across inside one substep: whoever went further past the line got
    // there first. Deterministic, and a dead heat is given to the player.
    s.winner = playerHome && rivalHome
      ? (s.player.distance >= s.rival.distance ? 'player' : 'rival')
      : playerHome ? 'player' : 'rival';
    // Nobody is sheltered on the finish line, and effectiveSimulation() will
    // flatten the trainer on the next frame regardless.
    s.player.drafting = false;
    s.rival.drafting = false;
  }
}

export function advanceFixed(s: RaceState, elapsedS: number): void {
  s.accumulator += elapsedS;

  let steps = 0;
  while (s.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    advance(s, FIXED_DT);
    s.accumulator -= FIXED_DT;
    steps += 1;
  }

  // A genuine stall (backgrounded tab, debugger pause) drops its backlog
  // rather than replaying it in one burst when the tab wakes up.
  if (steps === MAX_SUBSTEPS) s.accumulator = 0;
}

/**
 * The Escape safety stop. Ends the race; never writes to the trainer
 * directly — the next frame's single setSimulation call, fed by
 * effectiveSimulation(), is what relaxes it.
 */
export function stopRace(s: RaceState): void {
  s.paused = true;
  s.finished = true;
  s.aborted = true;
  s.winner = null;
  s.player.drafting = false;
  s.rival.drafting = false;
}

// --- the trainer ----------------------------------------------------------

export function simulationFor(s: RaceState): SimulationParams {
  return {
    // A track is flat. The grade is pinned at zero on purpose: on a climb
    // gravity would be 90% of the load and the draft worth about 1%, and
    // there would be no game here at all.
    grade: clampGrade(TRACK_GRADE_PERCENT),
    headwind: 0,
    crr: s.profile.crr,
    cw: cwFor(s.player.drafting),
  };
}

/** The flat, full-cw simulation a resting trainer should see. */
export const FLAT_SIMULATION: SimulationParams = {
  grade: 0, headwind: 0, crr: 0.004, cw: CW_OPEN,
};

/**
 * The single simulation value the app should send this frame. Callers must
 * make exactly ONE setSimulation call per frame using this value, placed
 * last: ControlPointWriter coalesces pending writes and flushes at most 4x a
 * second, so only the last value set before a flush reaches the device.
 * Pausing and the Escape stop set STATE; this function decides the write.
 */
export function effectiveSimulation(s: RaceState): SimulationParams {
  return s.paused || s.finished ? FLAT_SIMULATION : simulationFor(s);
}

// --- results --------------------------------------------------------------

export interface RaceResult {
  winner: Winner;
  aborted: boolean;
  /** The player's time, seconds. */
  timeS: number;
  /** Signed metres at the line: positive when the player won by that much. */
  marginM: number;
  avgPower: number;
  /** Fraction of the race the player spent sheltered, 0..1. */
  draftShare: number;
  /** What was left of the player's anaerobic store at the line, 0..1. The
   * one number that says whether the ride was paced or merely survived. */
  batteryLeft: number;
}

export function toRaceResult(s: RaceState): RaceResult {
  return {
    winner: s.winner,
    aborted: s.aborted,
    timeS: s.finishTimeS,
    marginM: s.gap,
    avgPower: s.elapsed > 0
      ? Math.round((s.player.kilojoules * 1000) / s.elapsed) : 0,
    draftShare: s.elapsed > 0
      ? Math.min(1, Math.max(0, s.player.draftedS / s.elapsed)) : 0,
    batteryLeft: wPrimeFraction(s.player.wPrime),
  };
}
