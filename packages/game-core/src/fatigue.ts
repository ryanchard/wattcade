/**
 * W′ — the anaerobic battery, and the one thing in this arcade that runs out.
 *
 * Every game here already tracks kilojoules and then reads them exactly once,
 * at the end, to print an average. Nothing spent ever ran out, which meant a
 * rival dragged round the track at 400 W for four laps finished as fresh as
 * one that sat in the whole way, and a rider with a big sprint won every race
 * regardless of how they had ridden it. This module is the store that makes
 * spending cost something, for the player and for the rivals alike.
 *
 * THE MODEL is the critical-power model, which is standard sports science
 * rather than something invented here. A rider has two supplies:
 *
 *   - critical power (CP), which is aerobic and effectively unlimited. We
 *     approximate it with FTP; the two are within a few percent of each other
 *     and FTP is the number a rider already knows.
 *   - W′ ("W prime"), a finite store of joules that is the ONLY thing paying
 *     for the watts above CP. Ride at P > CP and it drains at exactly
 *     (P − CP) watts. Ride below CP and it refills.
 *
 * For a 235 W rider with a 22 kJ store that gives, by arithmetic and not by
 * tuning:
 *
 *   |  effort | drains at | empties in |
 *   | ------: | --------: | ---------: |
 *   |   350 W |     115 W |      191 s |
 *   |   500 W |     265 W |       83 s |
 *   |   800 W |     565 W |       39 s |
 *   |  1184 W |     949 W |       23 s |
 *
 * — which is why a full-gas 200 m finish costs about a third of the store and
 * why policing a race and winning the sprint are, at last, two different
 * decisions.
 *
 * RECOVERY IS NOT THE MIRROR OF DEPLETION. Depletion is bookkeeping — the
 * joules above CP have to come from somewhere. Refilling is a physiological
 * process and it is much slower, so a linear "refills at (CP − P) watts" would
 * hand a rider a full 22 kJ back for twenty seconds of soft pedalling. We use
 * Skiba's reconstitution instead: the store refills exponentially toward full
 * with a time constant that depends on how far BELOW CP the rider has dropped,
 *
 *     tau(DCP) = 546 · e^(−0.01 · DCP) + 316    seconds,  DCP = CP − P
 *
 * so soft-pedalling just under threshold barely refills anything and stopping
 * dead refills fastest. See RECOVERY_TAU_SCALE for the one liberty taken with
 * it.
 *
 * Pure and deterministic: no wall clock, no `Math.random`, no DOM. Given the
 * same power sequence and the same timestep it produces the same joules every
 * time, which is what keeps a seeded race replayable.
 */

// ---------------------------------------------------------------------------
// TUNABLES — every number that shapes how the battery feels, in one block,
// because these get retuned by feel after actually riding.
// ---------------------------------------------------------------------------

/**
 * Critical power as a fraction of FTP. FTP is measured as roughly what a
 * rider holds for an hour; CP is the asymptote of the power-duration curve and
 * sits a few percent above it. Approximating one with the other is the
 * standard shortcut and keeps the rider from having to know a second number.
 * Lower this and everything above tempo starts costing.
 */
export const CP_FRACTION_OF_FTP = 1.0;

/**
 * Seeding W′ from the two numbers a rider has already entered.
 *
 * W′ is not derivable from FTP — it is what the FTP number cannot tell you —
 * but sprint-to-FTP ratio is a good proxy for it: a rider who can produce five
 * times their FTP for five seconds has a big anaerobic store, and a diesel who
 * can barely double it has a small one. So the seed is joules-per-watt-of-FTP,
 * pivoting on the ratio.
 *
 * Calibration points, both of which the numbers below hit:
 *   - the default rider (200 W FTP, 700 W sprint, ratio 3.5) gets 15.0 kJ,
 *     mid-range for a trained rider;
 *   - the owner (235 W FTP, 1184 W sprint, ratio 5.04) gets 22.0 kJ, which is
 *     the elite-sprinter end and the number every worked example here uses.
 *
 * Note the CP model's own W′ = (P5 − CP) × 5 s is NOT used: it gives the owner
 * 4.7 kJ, because five seconds is far off the hyperbola the model fits and the
 * short end of the power-duration curve always overshoots it.
 */
export const W_PRIME_REFERENCE_RATIO = 3.5;
export const W_PRIME_BASE_J_PER_W = 75;
export const W_PRIME_RATIO_SLOPE_J_PER_W = 12;
/** Guards on the seed, so a typo in the sprint box cannot invent a battery. */
export const W_PRIME_MIN_J_PER_W = 45;
export const W_PRIME_MAX_J_PER_W = 130;
/** Guards on an explicitly entered store, for the same reason. */
export const W_PRIME_MIN_J = 4000;
export const W_PRIME_MAX_J = 50000;

/** Skiba's reconstitution constants, unchanged. */
const SKIBA_TAU_FLOOR_S = 316;
const SKIBA_TAU_SPAN_S = 546;
const SKIBA_TAU_DECAY_PER_W = 0.01;

/**
 * The one liberty taken with Skiba: his constants are fitted to interval
 * sessions lasting many minutes, and a race here is seventy seconds. At the
 * published tau a rider drafting for twenty seconds recovers about 3% of their
 * deficit, which is physiologically right and makes "recover in their draft
 * between the attacks" — a counter this game prints on the results card —
 * unimplementable. Dividing tau by three keeps the SHAPE (recovery still
 * depends on how far below CP you drop, and is still far slower than
 * depletion) while putting the magnitude on the timescale of a race.
 *
 * At CP = 235 W: coasting recovers with tau ≈ 123 s, sitting in at 0.7 × CP
 * with tau ≈ 196 s, soft-pedalling at CP itself with tau ≈ 287 s. Twenty
 * seconds of shelter is worth about a tenth of the deficit, not all of it.
 *
 * Raise this toward 1 if recovery feels too generous; the store will then only
 * really refill between races.
 */
export const RECOVERY_TAU_SCALE = 1 / 3;

/**
 * Where the legs actually go. Above this fraction of the store the rider makes
 * whatever they ask for; below it, the watts above CP are scaled down toward
 * CP in proportion, reaching CP exactly at an empty store.
 *
 * Making the fade a ramp rather than a cliff matters twice over: a cliff would
 * have a rider feel fine and then stop dead, and — because the drain is
 * computed from the FADED power, not the demanded power — the ramp turns the
 * last of the store into an exponential tail with time constant
 * FADE_FROM_FRACTION x W-prime / (P - CP): a 949 W kick on the last fifth of
 * a 22 kJ store sags away over about fifteen seconds rather than switching off.
 */
export const FADE_FROM_FRACTION = 0.2;

/**
 * Peak five-second power as a multiple of FTP when the rider has not entered
 * one. Deliberately the same number as `DEFAULT_SPRINT_MULTIPLE` in
 * `@paperboy/trainer`, restated rather than imported so that this module stays
 * dependency-free and the whole battery can be exercised with two numbers and
 * no rider profile. `apps/arcade/test/profile.test.ts` asserts the two agree.
 */
export const SPRINT_MULTIPLE_FALLBACK = 3.5;

// ---------------------------------------------------------------------------

/**
 * The bit of a rider profile this model needs. Structural on purpose: the full
 * `RiderProfile` satisfies it, and so does `{ ftpWatts: 235 }`.
 */
export interface AnaerobicRider {
  readonly ftpWatts: number;
  /** Best five seconds, in watts. Sizes the store when `wPrimeJoules` is absent. */
  readonly sprintWatts?: number | undefined;
  /** The rider's own measured W′, in joules, when they know it. */
  readonly wPrimeJoules?: number | undefined;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Critical power for this rider, in watts: the line the store is spent above. */
export function criticalPower(rider: AnaerobicRider): number {
  return Math.max(1, rider.ftpWatts) * CP_FRACTION_OF_FTP;
}

/** Peak five-second power, stated or estimated. Never below FTP: a sprint
 * weaker than an hour effort is a typo, not a rider. */
export function sprintPowerOf(rider: AnaerobicRider): number {
  const ftp = Math.max(1, rider.ftpWatts);
  const stated = rider.sprintWatts;
  if (stated !== undefined && Number.isFinite(stated) && stated > 0) {
    return Math.max(ftp, stated);
  }
  return ftp * SPRINT_MULTIPLE_FALLBACK;
}

/** The store this rider's FTP and sprint imply, in joules, ignoring any
 * explicit figure. Exported so the profile UI can show what it would seed. */
export function seededWPrimeJoules(rider: AnaerobicRider): number {
  const ftp = Math.max(1, rider.ftpWatts);
  const ratio = sprintPowerOf(rider) / ftp;
  const perWatt = clamp(
    W_PRIME_BASE_J_PER_W
      + W_PRIME_RATIO_SLOPE_J_PER_W * (ratio - W_PRIME_REFERENCE_RATIO),
    W_PRIME_MIN_J_PER_W,
    W_PRIME_MAX_J_PER_W,
  );
  return clamp(ftp * perWatt, W_PRIME_MIN_J, W_PRIME_MAX_J);
}

/** The store to race on: the rider's own figure when they have entered one,
 * otherwise the seed from FTP and sprint. */
export function wPrimeCapacity(rider: AnaerobicRider): number {
  const stated = rider.wPrimeJoules;
  if (stated !== undefined && Number.isFinite(stated) && stated > 0) {
    return clamp(stated, W_PRIME_MIN_J, W_PRIME_MAX_J);
  }
  return seededWPrimeJoules(rider);
}

/**
 * Skiba's recovery time constant, in seconds, for a rider sitting `belowCp`
 * watts under critical power. Bigger means slower. Scaled by
 * RECOVERY_TAU_SCALE — see its comment for why.
 */
export function recoveryTauS(belowCp: number): number {
  const dcp = Math.max(0, belowCp);
  return (
    SKIBA_TAU_SPAN_S * Math.exp(-SKIBA_TAU_DECAY_PER_W * dcp) + SKIBA_TAU_FLOOR_S
  ) * RECOVERY_TAU_SCALE;
}

/**
 * The store after `dt` seconds at `powerWatts`, in joules. Clamped to
 * [0, capacityJ] — it can neither go negative nor overfill.
 *
 * Above CP: straight bookkeeping, `(P − CP)` joules a second out of the store.
 * At or below CP: exponential refill toward full, integrated exactly rather
 * than by Euler step, so the answer does not depend on the size of `dt` and a
 * 120 Hz race and a 1 Hz test agree.
 */
export function nextWPrimeBalance(
  balanceJ: number, capacityJ: number, powerWatts: number, cpWatts: number,
  dt: number,
): number {
  const capacity = Math.max(0, capacityJ);
  const balance = clamp(balanceJ, 0, capacity);
  if (!(dt > 0) || !Number.isFinite(powerWatts)) return balance;

  const above = powerWatts - cpWatts;
  if (above > 0) return clamp(balance - above * dt, 0, capacity);

  const tau = recoveryTauS(-above);
  const deficit = capacity - balance;
  return clamp(balance + deficit * (1 - Math.exp(-dt / tau)), 0, capacity);
}

/** One rider's battery. Mutable, like the race state that holds it. */
export interface WPrimeState {
  /** Size of the store, joules. Fixed for the ride. */
  readonly capacityJ: number;
  /** What is left of it, joules. Always in [0, capacityJ]. */
  balanceJ: number;
}

export function createWPrime(rider: AnaerobicRider): WPrimeState {
  const capacityJ = wPrimeCapacity(rider);
  return { capacityJ, balanceJ: capacityJ };
}

/** Advances one battery in place. */
export function advanceWPrime(
  s: WPrimeState, powerWatts: number, cpWatts: number, dt: number,
): void {
  s.balanceJ = nextWPrimeBalance(s.balanceJ, s.capacityJ, powerWatts, cpWatts, dt);
}

/** How much is left, 0..1. This is the number that goes on the HUD. */
export function wPrimeFraction(s: WPrimeState): number {
  if (!(s.capacityJ > 0)) return 0;
  return clamp(s.balanceJ / s.capacityJ, 0, 1);
}

/**
 * The power a rider with this much left can actually put through the pedals,
 * given what they are asking for.
 *
 * This is the half of the model that makes any of it visible. Draining a
 * number changes nothing on its own; a rider — player or rival — whose store
 * is gone has to fade back toward CP, and THAT is the mechanism that makes
 * "force the pace" a real tactic and an empty sprint a real punishment.
 *
 * Never limits anything at or below CP: the aerobic supply does not run out,
 * so a spent rider can still ride tempo forever. They just cannot kick.
 */
export function sustainablePower(
  demandWatts: number, cpWatts: number, fraction: number,
): number {
  if (!Number.isFinite(demandWatts)) return 0;
  if (demandWatts <= cpWatts) return demandWatts;
  const headroom = clamp(fraction, 0, 1) / FADE_FROM_FRACTION;
  return cpWatts + (demandWatts - cpWatts) * Math.min(1, headroom);
}
