/**
 * The virtual gear: a cassette the shell owns, applied to whatever load a
 * game asks for on its way to the trainer.
 *
 * The problem it solves, in the rider's words: "I can't get watts up without
 * more resistance." In FTMS simulation mode the trainer works out its own
 * load from the parameters we send and its own wheel speed. On a flat track
 * at grade 0 there is very little to push against, so making a big number
 * means spinning absurdly fast rather than pressing hard — and a rider on a
 * Zwift Cog or a fixed sprocket has no gear to change. This is that gear.
 *
 * It lives here, in the shell, for the same reason every write to the trainer
 * does: a game declares the road it wants, and one place decides what the
 * trainer is actually told. A game cannot see the gear and cannot set it.
 *
 * Two levers, because one is not enough:
 *
 *   - `cw`, the wind resistance coefficient, is multiplied by the gear ratio.
 *     This is the honest one — it is exactly what a taller gear does to a
 *     rider on the road — but its force goes as v², so at the speeds Paperboy
 *     runs at it is worth almost nothing and at a standstill it is worth
 *     nothing at all.
 *   - a small grade contribution, which is speed-independent, so a tall gear
 *     bites the moment the cranks turn. It is ONE-SIDED on purpose: a tall
 *     gear tilts the road up, a low gear only thins the air. The game chose
 *     its road, and gearing may make it harder to turn the pedals without
 *     ever turning one of Paperboy's climbs into a descent.
 *
 * `crr` is deliberately untouched. It is the surface the game picked —
 * Paperboy's lawns against its tarmac, The Pack's dogs — and a gear that
 * quietly turned grass into road would be changing the game, not the load.
 *
 * The ±8% clamp is absolute and stays the last word: `applyGear` runs the
 * geared grade through `clampGrade` itself, and `encodeSimulationParams`
 * clamps it again on the way out. No gear can reach past it.
 */
import { clampGrade } from '@paperboy/trainer';
import type { SimulationParams } from '@paperboy/trainer';

/** The bottom of the block: everything the game asked for, and less. */
export const GEAR_MIN = 1;
/** The top. Twelve is a cassette, and it is enough range that a rider who
 * cannot reach their FTP in gear 4 can reach it in gear 9. */
export const GEAR_MAX = 12;
/**
 * The gear that changes nothing. A rider who never touches a shifter gets
 * exactly the load the game's author tuned, which is the only default that
 * cannot be a regression.
 */
export const NEUTRAL_GEAR = 4;

/**
 * How much taller each gear is than the one below it. 18% per shift is about
 * one sprocket on a real cassette: a one-tooth step is roughly 7% of ratio,
 * and at a fixed cadence that is very close to 20% of power once the air is
 * doing the work.
 */
export const GEAR_STEP = 1.18;

/**
 * Percent of grade added per unit of ratio above neutral. 1.3 puts the top
 * gear at +3.6%, which is felt at any speed and still leaves 4.4% of the
 * clamp for a game that wants a hill of its own.
 */
export const GRADE_PER_RATIO = 1.3;

/**
 * The largest `cw` worth sending. FTMS encodes it in one byte at 0.01 kg/m,
 * so 2.55 is the ceiling the wire has; clamping here rather than letting the
 * encoder truncate means a tall gear on an already-draggy game stops being
 * taller instead of silently wrapping into something else.
 */
export const MAX_CW = 2.55;

/** The rider's chosen gear, snapped into the block and to a whole number. */
export function clampGear(gear: number): number {
  if (!Number.isFinite(gear)) return NEUTRAL_GEAR;
  return Math.max(GEAR_MIN, Math.min(GEAR_MAX, Math.round(gear)));
}

/**
 * What this gear multiplies the requested load by. Exactly 1 at neutral, by
 * construction, so `applyGear` in neutral is the identity on a sane input.
 */
export function gearRatio(gear: number): number {
  return GEAR_STEP ** (clampGear(gear) - NEUTRAL_GEAR);
}

/**
 * The grade this gear adds, in percent. Zero at and below neutral — see the
 * note at the top about why the road only ever tilts one way.
 */
export function gearGrade(gear: number): number {
  return GRADE_PER_RATIO * Math.max(0, gearRatio(gear) - 1);
}

/**
 * The load the trainer is told, given the load the game wants and the gear
 * the rider is in.
 */
export function applyGear(
  wanted: SimulationParams, gear: number,
): SimulationParams {
  // Neutral hands back the very object it was given rather than a copy of it.
  // A rider who never touches a shifter is riding what the game's author
  // tuned, and this makes that true of the identity as well as the numbers.
  if (clampGear(gear) === NEUTRAL_GEAR) return wanted;
  const ratio = gearRatio(gear);
  return {
    grade: clampGrade(wanted.grade + gearGrade(gear)),
    headwind: wanted.headwind,
    crr: wanted.crr,
    cw: Math.max(0, Math.min(MAX_CW, wanted.cw * ratio)),
  };
}

export function shiftUp(gear: number): number {
  return clampGear(clampGear(gear) + 1);
}

export function shiftDown(gear: number): number {
  return clampGear(clampGear(gear) - 1);
}

// --- keeping it between rides ---------------------------------------------

/** Same `localStorage` as the rider's profile, because it is the same kind
 * of fact: a setting about this rider's bike, not about this run. */
export const GEAR_KEY = 'arcade.gear.v1';

export function loadGear(store: Storage): number {
  try {
    const raw = store.getItem(GEAR_KEY);
    // `Number('')` is 0, which is finite and would clamp an emptied key down
    // to gear 1 rather than leaving the rider in neutral.
    if (raw === null || raw.trim() === '') return NEUTRAL_GEAR;
    const n = Number(raw);
    // A stored value that is not a number is a corrupted key, not a gear.
    // Neutral is the only safe reading of it.
    return Number.isFinite(n) ? clampGear(n) : NEUTRAL_GEAR;
  } catch {
    return NEUTRAL_GEAR;
  }
}

export function saveGear(store: Storage, gear: number): void {
  try {
    store.setItem(GEAR_KEY, String(clampGear(gear)));
  } catch {
    // Storage off. The ride still runs, which is the part that matters.
  }
}
