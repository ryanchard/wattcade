/**
 * Cadence as a control axis, and the one awkward fact about it.
 *
 * Power is an effort axis: slow, expensive, coarse. Cadence is a steering
 * wheel — it moves in well under a second, costs almost nothing at low
 * resistance, and can be held deliberately at a value. A game can therefore
 * map it straight onto a control, which is what Spin Cycle and Fish do.
 *
 * The awkward fact is that plenty of trainers do not report cadence at all.
 * `TrainerSample.cadence` is `number | null`, and a cadence-steered game that
 * quietly treats null as zero looks broken rather than unsupported: the rider
 * pedals, nothing happens, and there is nothing on screen to explain it. So
 * "no cadence" is tracked here as a first-class state with a short grace
 * period — long enough to ride through a dropped notification, short enough
 * that a trainer which never reports cadence says so almost immediately.
 */

/** Nobody pedals faster than this; a higher reading is a decoding glitch. */
export const MAX_PLAUSIBLE_RPM = 250;

/**
 * How long a game waits with no cadence reading before it stops pretending.
 * Trainers notify at 1-4 Hz, so this rides out several missed notifications
 * without ever leaving the rider staring at a still screen for long.
 */
export const CADENCE_TIMEOUT_S = 2;

export interface CadenceTracker {
  /** The last plausible reading, or null if there has not been one. */
  rpm: number | null;
  /** Seconds since the last plausible reading. Capped, so it cannot drift. */
  sinceReading: number;
  /** True once `sinceReading` has passed `CADENCE_TIMEOUT_S`. This is what a
   * game puts on screen. */
  missing: boolean;
  /** Whether a plausible reading has EVER arrived. Separate from `missing`
   * because the two want different treatment: silence after a reading is
   * something to ride through, whereas silence before the first one means
   * the game has never been given a steering input and must not have started
   * moving the world yet. */
  everRead: boolean;
}

export function createCadenceTracker(): CadenceTracker {
  return { rpm: null, sinceReading: 0, missing: false, everRead: false };
}

/**
 * Takes a reading from the shell. Implausible values — negative, NaN, a
 * decoding glitch above `MAX_PLAUSIBLE_RPM` — are treated as no reading at
 * all rather than clamped, because a clamped glitch would steer.
 */
export function readCadence(c: CadenceTracker, rpm: number | null): void {
  if (rpm === null || !Number.isFinite(rpm) || rpm < 0 || rpm > MAX_PLAUSIBLE_RPM) {
    c.rpm = null;
    return;
  }
  c.rpm = rpm;
  c.sinceReading = 0;
  c.missing = false;
  c.everRead = true;
}

/**
 * Advances the grace period by one simulation step. Called from the game's
 * own `advance`, so the timeout is measured in simulated seconds and a
 * headless test can reach the missing state without a clock.
 */
export function tickCadence(c: CadenceTracker, dt: number): void {
  if (c.rpm !== null) {
    c.sinceReading = 0;
    c.missing = false;
    return;
  }
  c.sinceReading = Math.min(CADENCE_TIMEOUT_S * 2, c.sinceReading + dt);
  c.missing = c.sinceReading >= CADENCE_TIMEOUT_S;
}

/**
 * True while there is nothing safe to steer with — either no reading has ever
 * arrived, or the grace period has run out. Games hold the world still here
 * rather than letting it run on a control the rider does not have. The two
 * cases are folded together on purpose: the difference matters to the tracker
 * and not at all to the fish about to swim into something.
 */
export function cadenceStalled(c: CadenceTracker): boolean {
  return !c.everRead || c.missing;
}

/**
 * The steering value to use this step: the real reading when there is one,
 * and `fallback` during the grace period so a single dropped notification
 * holds the rider steady instead of dropping them out of the sky.
 */
export function steeringRpm(c: CadenceTracker, fallback: number): number {
  return c.rpm ?? fallback;
}

/**
 * What to put on screen when the trainer will not say. Plain, and about the
 * trainer rather than about the rider, who has done nothing wrong.
 */
export const CADENCE_MISSING_HEADLINE = 'No cadence from your trainer';
export const CADENCE_MISSING_BODY =
  'This game is steered by how fast you pedal, and your trainer is not ' +
  'reporting it. The ride is held here until a reading arrives.';
