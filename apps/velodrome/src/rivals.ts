/**
 * The six rivals.
 *
 * Punch-Out!! rule: a rival is a PATTERN, not a bigger number. Each one has a
 * power profile, a tactical rule, a visible tell and a counter that a rider
 * can discover by losing to it once. So this module is DATA plus one small
 * behaviour function — rivalPowerFraction() — rather than six copy-pasted
 * branches. Adding a seventh rival should mean adding a RivalSpec, not code.
 *
 * Every number here is a fraction of the PLAYER's FTP, so the ladder is
 * equally competitive for a 160 W rider and a 380 W one.
 *
 * Nothing in this file is random. Given the same player power inputs a race
 * replays identically, which is what makes a tell learnable at all.
 *
 * Pure: no DOM, no browser globals, no clock of its own.
 */

// ---------------------------------------------------------------------------
// Shared tunables
// ---------------------------------------------------------------------------

/** Hard floor/ceiling on any rival's power, as a fraction of player FTP. */
export const RIVAL_MIN_FRACTION = 0;
export const RIVAL_MAX_FRACTION = 2.2;

/** How far past its peak a 'real' move keeps building, as a fraction of the
 * move's own amplitude. This is the Feinter's whole lesson in one number. */
export const REAL_MOVE_BUILD = 0.35;

/** The Wheelsucker's station-keeping controller. */
export const SHELTER_GAP_M = 2.0;
export const SHELTER_GAIN_BEHIND = 0.14;
export const SHELTER_GAIN_CLOSE = 0.38;
export const SHELTER_DAMPING = 0.30;
export const SHELTER_MIN_FRACTION = 0.22;
export const SHELTER_MAX_FRACTION = 1.55;

/** The Champion's adaptation thresholds, as fractions of player FTP. */
export const CHAMPION_COVER_ABOVE = 1.12;
export const CHAMPION_COVER_MATCH = 1.02;
export const CHAMPION_COVER_CEILING = 1.45;
export const CHAMPION_EASE_BELOW = 0.86;
export const CHAMPION_PUNISH = 0.34;
export const CHAMPION_SPRINT_FROM = 0.88;
export const CHAMPION_SPRINT_WITHIN_M = 25;
export const CHAMPION_SPRINT_FRACTION = 1.6;

// ---------------------------------------------------------------------------
// Move shapes
// ---------------------------------------------------------------------------

/**
 * 'surge' rises to its amplitude and holds it, then stops — a plain attack.
 * 'fake'  rises fast and decays away within a second or two — a bluff.
 * 'real'  rises slower and KEEPS BUILDING to the end — the move that counts.
 *
 * The fake/real contrast is the readable difference the Feinter is built on:
 * both look identical for the first second, and only one of them is still
 * there at three.
 */
export type MoveKind = 'surge' | 'fake' | 'real';

export interface RivalMove {
  /** Rival race progress (0..1) at which this move fires. Triggering on
   * progress rather than wall-clock means every rider sees the same number
   * of moves in the same places, whatever their FTP. */
  readonly at: number;
  readonly kind: MoveKind;
  /** Peak power added, as a fraction of the player's FTP. */
  readonly amplitude: number;
  /** Seconds from firing to peak. */
  readonly riseS: number;
  /** Total seconds the move lasts; it contributes nothing after this. */
  readonly durationS: number;
}

/** A move's contribution, in fractions of player FTP, `since` seconds after
 * it fired. Exported because the fake-decays / real-builds contract is the
 * Feinter's tell and deserves a direct test. */
export function moveOutput(move: RivalMove, since: number): number {
  if (since < 0 || since >= move.durationS) return 0;
  if (since < move.riseS) return move.amplitude * (since / move.riseS);

  const tail = Math.max(1e-6, move.durationS - move.riseS);
  const k = (since - move.riseS) / tail; // 0 at peak, 1 at the end
  switch (move.kind) {
    case 'fake':
      // Gone almost as fast as it arrived. Quadratic so the collapse is
      // obvious on screen rather than a slow sag.
      return move.amplitude * (1 - k) * (1 - k);
    case 'real':
      return move.amplitude * (1 + REAL_MOVE_BUILD * k);
    case 'surge':
      return move.amplitude;
  }
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export type RivalTactic = 'none' | 'shelter' | 'adaptive';

/** Base power over the race, as [progress, fraction-of-player-FTP] points,
 * linearly interpolated. A curve is data; a fade is not special-cased code. */
export type PowerCurve = readonly (readonly [progress: number, fraction: number])[];

export interface RivalSpec {
  readonly id: RivalId;
  readonly name: string;
  /** One line of character, shown before the race. */
  readonly line: string;
  /** What to watch for. Revealed only after the rider has lost to them once —
   * finding the tell yourself is the game. */
  readonly tell: string;
  /** What to do about it. */
  readonly counter: string;
  readonly baseCurve: PowerCurve;
  readonly moves: readonly RivalMove[];
  /** Base power is multiplied by `factor` for `seconds` after each move
   * ends — the recovery that makes covering every attack a losing plan. */
  readonly recovery: { readonly seconds: number; readonly factor: number } | null;
  readonly tactic: RivalTactic;
  /** Late jump: past `fromProgress`, power is at least `fraction`. Absolute,
   * not additive, and it overrides the tactic — a wheelsucker who jumps is
   * no longer keeping station. */
  readonly jump: { readonly fromProgress: number; readonly fraction: number } | null;
}

export type RivalId =
  | 'diesel' | 'flyer' | 'attacker' | 'feinter' | 'wheelsucker' | 'champion';

/** Per-rival firing memory: the elapsed time each move fired at, or null.
 * Lives in the race state, not in this module, so a race stays replayable. */
export type MoveMemory = (number | null)[];

export function createMoveMemory(spec: RivalSpec): MoveMemory {
  return spec.moves.map(() => null);
}

export interface RivalContext {
  /** Seconds since the start of the race. */
  readonly t: number;
  /** Rival's own race progress, 0..1. */
  readonly progress: number;
  /** Signed gap in metres: positive when the PLAYER leads. */
  readonly gap: number;
  /** Rate the gap is opening at, m/s (player speed minus rival speed). */
  readonly closingRate: number;
  /** Player's current (eased) power as a fraction of their own FTP. */
  readonly playerEffort: number;
}

function sampleCurve(curve: PowerCurve, x: number): number {
  const first = curve[0];
  if (first === undefined) return 1;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (x <= b[0]) {
      const span = b[0] - a[0];
      const k = span <= 0 ? 0 : (x - a[0]) / span;
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return curve[curve.length - 1]![1];
}

function shelterFraction(base: number, ctx: RivalContext): number {
  // Refuses to lead, full stop. If the player has dropped in behind, the
  // Wheelsucker soft-pedals until the player is forced back to the front.
  if (ctx.gap < 0) return SHELTER_MIN_FRACTION;

  // Sitting at exactly SHELTER_GAP_M behind the player. A hard rule at the
  // near edge — not just a stiffer gain — is what makes "never comes past"
  // true rather than usually true.
  if (ctx.gap < SHELTER_GAP_M * 0.5) return SHELTER_MIN_FRACTION;

  const error = ctx.gap - SHELTER_GAP_M;
  const gain = error > 0 ? SHELTER_GAIN_BEHIND : SHELTER_GAIN_CLOSE;
  const f = base + gain * error + SHELTER_DAMPING * ctx.closingRate;
  return Math.min(SHELTER_MAX_FRACTION, Math.max(SHELTER_MIN_FRACTION, f));
}

function adaptiveFraction(base: number, ctx: RivalContext): number {
  let f = base;

  if (ctx.playerEffort > CHAMPION_COVER_ABOVE) {
    // Covers the attack — but only up to a ceiling. A rider strong enough to
    // hold well above their FTP can still ride away; the exam is passable.
    f = Math.max(f, Math.min(
      CHAMPION_COVER_CEILING, ctx.playerEffort * CHAMPION_COVER_MATCH,
    ));
  } else if (ctx.playerEffort < CHAMPION_EASE_BELOW) {
    // Punishes a lull. Easing off in front of this one is an invitation.
    f += CHAMPION_PUNISH;
  }

  if (
    ctx.progress >= CHAMPION_SPRINT_FROM &&
    Math.abs(ctx.gap) <= CHAMPION_SPRINT_WITHIN_M
  ) {
    f = Math.max(f, CHAMPION_SPRINT_FRACTION);
  }
  return f;
}

/**
 * The one behaviour function. Returns the rival's target power for this
 * instant as a fraction of the player's FTP.
 *
 * Mutates `memory` to record the elapsed time each move fired at — the same
 * shape as advance() mutating its state elsewhere in this codebase. Given the
 * same context sequence and the same starting memory it is deterministic.
 */
export function rivalPowerFraction(
  spec: RivalSpec, ctx: RivalContext, memory: MoveMemory,
): number {
  let base = sampleCurve(spec.baseCurve, ctx.progress);

  let fromMoves = 0;
  let recovering = false;
  for (let i = 0; i < spec.moves.length; i++) {
    const move = spec.moves[i]!;
    if (memory[i] === undefined) memory[i] = null;
    if (memory[i] === null && ctx.progress >= move.at) memory[i] = ctx.t;

    const firedAt = memory[i];
    if (firedAt === null || firedAt === undefined) continue;
    const since = ctx.t - firedAt;
    fromMoves += moveOutput(move, since);
    if (
      spec.recovery !== null &&
      since >= move.durationS &&
      since < move.durationS + spec.recovery.seconds
    ) {
      recovering = true;
    }
  }
  if (recovering && spec.recovery !== null) base *= spec.recovery.factor;

  let f = base + fromMoves;

  switch (spec.tactic) {
    case 'shelter': f = shelterFraction(f, ctx); break;
    case 'adaptive': f = adaptiveFraction(f, ctx); break;
    case 'none': break;
  }

  if (spec.jump !== null && ctx.progress >= spec.jump.fromProgress) {
    f = Math.max(f, spec.jump.fraction);
  }

  return Math.min(RIVAL_MAX_FRACTION, Math.max(RIVAL_MIN_FRACTION, f));
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export const DIESEL: RivalSpec = {
  id: 'diesel',
  name: 'Brendy',
  line: 'Forty years on the boards and not one wasted watt.',
  tell: 'The power never moves. Not once, not for anything.',
  counter: 'Sit on their wheel the whole way and come past in the last 100 m.',
  // Metronomic. Flat is the whole character: it is also the tutorial, because
  // a rider who does not yet trust the draft will burn out beside them and a
  // rider who tucks in will feel the trainer go quiet.
  baseCurve: [[0, 0.92], [1, 0.92]],
  moves: [],
  recovery: null,
  tactic: 'none',
  jump: null,
};

export const FLYER: RivalSpec = {
  id: 'flyer',
  name: 'Tom',
  line: 'Leads every race they have ever ridden. Wins about a third of them.',
  tell: 'An opening lap nobody on earth could hold for four.',
  counter: 'Do not chase. Ride your own tempo and they come back to you.',
  // Average is about 0.93 of the player's FTP, but spent so unevenly that an
  // even effort at the same average covers the kilometre faster. There is no
  // fatigue model in this game on purpose — the rider's own legs are it — so
  // the punishment for panicking is delivered by the trainer, not the code.
  baseCurve: [
    [0, 1.42], [0.12, 1.30], [0.30, 0.95],
    [0.50, 0.80], [0.70, 0.67], [0.85, 0.57], [1, 0.50],
  ],
  moves: [],
  recovery: null,
  tactic: 'none',
  jump: null,
};

export const ATTACKER: RivalSpec = {
  id: 'attacker',
  name: 'Shum',
  line: 'Attacks until something breaks. Usually someone else.',
  tell: 'Five attacks, evenly spaced, each with a soft patch behind it.',
  counter: 'Cover the ones that matter and recover in their draft between.',
  baseCurve: [[0, 0.86], [1, 0.86]],
  moves: [
    { at: 0.12, kind: 'surge', amplitude: 0.55, riseS: 1.4, durationS: 9 },
    { at: 0.30, kind: 'surge', amplitude: 0.55, riseS: 1.4, durationS: 9 },
    { at: 0.48, kind: 'surge', amplitude: 0.58, riseS: 1.4, durationS: 9 },
    { at: 0.66, kind: 'surge', amplitude: 0.58, riseS: 1.4, durationS: 9 },
    { at: 0.83, kind: 'surge', amplitude: 0.62, riseS: 1.4, durationS: 10 },
  ],
  recovery: { seconds: 8, factor: 0.72 },
  tactic: 'none',
  jump: null,
};

export const FEINTER: RivalSpec = {
  id: 'feinter',
  name: 'Caleb',
  line: 'Lies with their shoulders. Twice a lap, sometimes three.',
  tell: 'The bluffs collapse inside two seconds. The real one keeps going.',
  counter: 'Count to three before you answer. Only two of these are real.',
  baseCurve: [[0, 0.89], [0.5, 0.93], [1, 0.99]],
  moves: [
    { at: 0.10, kind: 'fake', amplitude: 0.50, riseS: 0.8, durationS: 2.6 },
    { at: 0.24, kind: 'fake', amplitude: 0.55, riseS: 0.8, durationS: 2.4 },
    { at: 0.40, kind: 'real', amplitude: 0.45, riseS: 2.5, durationS: 14 },
    { at: 0.62, kind: 'fake', amplitude: 0.55, riseS: 0.7, durationS: 2.2 },
    { at: 0.73, kind: 'fake', amplitude: 0.50, riseS: 0.9, durationS: 2.8 },
    { at: 0.86, kind: 'real', amplitude: 0.52, riseS: 2.5, durationS: 16 },
  ],
  recovery: { seconds: 5, factor: 0.84 },
  tactic: 'none',
  jump: null,
};

export const WHEELSUCKER: RivalSpec = {
  id: 'wheelsucker',
  name: 'Fonz',
  line: 'Has not led a lap since 2019. Has not needed to.',
  tell: 'However slowly you ride, they will not come past. They are waiting.',
  counter: 'Force the pace, or play chicken and jump before they do.',
  baseCurve: [[0, 0.80], [1, 0.80]],
  moves: [],
  recovery: null,
  tactic: 'shelter',
  jump: { fromProgress: 0.90, fraction: 1.70 },
};

export const CHAMPION: RivalSpec = {
  id: 'champion',
  name: 'Charlie',
  line: 'World champion. Rides the race you are riding, only better.',
  tell: 'They answer you. Attack and they are there; ease and they are gone.',
  counter: 'Give them nothing to read. Save it all for the last 100 m.',
  baseCurve: [[0, 0.95], [0.5, 0.99], [0.8, 1.03], [1, 1.08]],
  // One genuine mid-race move on top of the adaptation, so the exam tests
  // the Feinter lesson as well as the Wheelsucker one.
  moves: [
    { at: 0.55, kind: 'real', amplitude: 0.42, riseS: 3, durationS: 15 },
  ],
  recovery: { seconds: 6, factor: 0.86 },
  tactic: 'adaptive',
  jump: null,
};

/** The ladder, in order. Each rung teaches the thing the next one assumes. */
export const LADDER: readonly RivalSpec[] = [
  DIESEL, FLYER, ATTACKER, FEINTER, WHEELSUCKER, CHAMPION,
];

export function rivalById(id: string): RivalSpec | null {
  return LADDER.find((r) => r.id === id) ?? null;
}
