/**
 * The contract between the arcade shell and a game.
 *
 * A trainer pairs to ONE application at a time, so there is exactly one
 * application: the shell. It owns the Bluetooth connection, the rider's
 * profile, the frame loop, and — critically — every write to the trainer.
 *
 * A game therefore never touches Bluetooth, `requestAnimationFrame`,
 * `document`, the clock, or the trainer. It advances when it is told to,
 * draws when it is told to, and DECLARES the resistance it would like. The
 * shell decides what is actually sent, because the shell is the only place
 * that knows whether the rider is paused, whether the tab is hidden, or
 * whether anybody is on the bike at all.
 *
 * This package is types only. It has no runtime behaviour to get wrong.
 */
import type {
  RiderProfile as TrainerRider, SimulationParams,
} from '@paperboy/trainer';

export type { SimulationParams };

/**
 * The rider as the shell hands them to a game: everything the trainer's
 * physics needs, plus the numbers the arcade itself keeps.
 *
 * `@paperboy/trainer` owns the physical rider — mass, drag, drivetrain — and
 * nothing in it should have to know that this arcade has a fatigue model. So
 * W-prime is added here, at the layer that actually plays games, and stays
 * optional: a profile without one is seeded from FTP and sprint by
 * `wPrimeCapacity()` in `@paperboy/game-core`.
 */
export interface RiderProfile extends TrainerRider {
  /**
   * The rider's anaerobic store, in joules — how much they have to spend
   * above threshold before there is nothing left to sprint with. Absent
   * means "work it out from my FTP and my sprint".
   */
  wPrimeJoules?: number;
}

/**
 * One row of the status strip the shell draws for every game, so that watts,
 * gap and lap all sit in the same place whichever game is running. Values are
 * pre-formatted strings: a game knows whether its number wants one decimal
 * place, and the shell does not.
 */
export interface HudLine {
  readonly label: string;
  readonly value: string;
}

/**
 * A key the game itself reads while riding, described for the rider. The
 * shell forwards keyboard input to a session ONLY if the game lists at least
 * one of these, which is how The Pack and Velodrome stay legs-only by
 * construction rather than by discipline.
 *
 * Pause and the safety stop are not listed here. They belong to the shell and
 * work identically in every game.
 */
export interface ControlHint {
  /** As the rider would say it: "arrow keys", "space". */
  readonly keys: string;
  /** What it does: "steer", "throw a paper". */
  readonly action: string;
}

/**
 * Three colours lifted from the game's own scene. The hub uses them for that
 * game's swatch so the landing page borrows its identity from its contents
 * rather than imposing one on three games that look nothing like each other.
 */
export interface GamePalette {
  /** The scene's ground colour. */
  readonly base: string;
  /** The colour the eye goes to first. */
  readonly accent: string;
  /** A second colour from the same scene, for the swatch's third band. */
  readonly detail: string;
}

/**
 * A choice the rider makes before starting — a rung of Velodrome's ladder, a
 * course, an opponent. Games with a single ride do not implement `variants`.
 */
export interface GameVariant {
  readonly id: string;
  readonly name: string;
  /** One line, player-facing. */
  readonly detail: string;
  /** Extra line shown under `detail`, e.g. what was learned last time. */
  readonly note?: string;
  /** True when the rider has not earned this one yet. */
  readonly locked?: boolean;
  /** True when the rider has already finished with it. */
  readonly cleared?: boolean;
}

/** Keyboard state for one frame, forwarded to games that ask for it. */
export interface GameKeys {
  /** `KeyboardEvent.key` values currently held down. */
  readonly held: ReadonlySet<string>;
  /**
   * Keys that went down since the last frame. Edge-triggered and free of OS
   * auto-repeat, so a held Space is one throw rather than thirty.
   */
  readonly pressed: ReadonlySet<string>;
}

export interface GameCreateOptions {
  /** The rider's FTP and weight, entered once in the hub and shared by all. */
  readonly profile: RiderProfile;
  /** Only meaningful for a game whose `usesSeed` is true. */
  readonly seed?: number;
  /** The id of the chosen `GameVariant`, when the game offers any. */
  readonly variantId?: string;
  /**
   * Where a game keeps its own records — a route's best score, which ladder
   * rungs are beaten. Passed in rather than reached for, so games stay
   * testable and the shell stays in charge of what persists.
   */
  readonly store: Storage;
}

/** What the shell shows on the results card and folds into its own stats. */
export interface RunResult {
  /** The one thing the rider wants to see, drawn biggest: "1240", "CAUGHT". */
  readonly headline: string;
  /** A single line under it. */
  readonly summary: string;
  /** Everything else, as label/value rows. */
  readonly lines: readonly HudLine[];
  readonly durationS: number;
  readonly distanceM: number;
  readonly avgPower: number;
  /** Comparable across runs of this game, for its best-ever line. Null when
   * the game has no score (Velodrome is won or lost, not scored). */
  readonly score: number | null;
  /** True when the rider hit the safety stop rather than finishing. */
  readonly stopped: boolean;
  /**
   * A `GameVariant` the shell should offer as the obvious next ride — the
   * rung of a ladder that this run just unlocked. Omitted when there is no
   * such thing, which is most of the time.
   */
  readonly nextVariantId?: string;
  /**
   * Seconds over a fixed distance, for a game that is raced rather than
   * scored, so it can still hold a place on the high score table. Lower is
   * better. Set it ONLY when the rider covered the whole distance: a race
   * that ended when somebody else crossed the line is not a time, and
   * ranking it as one would put every defeat above every win.
   */
  readonly rankTimeS?: number;
}

export interface GameSession {
  /**
   * Advance one fixed substep. The shell owns timing and passes power that
   * has ALREADY been eased, so a session must integrate the value it is given
   * rather than filtering it again.
   */
  advance(dtSeconds: number, powerWatts: number): void;

  /**
   * Real elapsed seconds for anything that must not touch the simulation:
   * parallax, camera easing, wheel rotation. Called once per frame, before
   * the substeps. Deterministic gameplay lives in `advance` and nowhere else.
   */
  animate?(dtSeconds: number, width: number, height: number): void;

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void;

  /** Forwarded only when the game declares `controls`. */
  handleKeys?(keys: GameKeys): void;

  /**
   * Cadence in rpm as the trainer last reported it, or null when the trainer
   * reports none. Forwarded once per frame, before the substeps, and — unlike
   * power — NOT eased: cadence is a control axis, and smoothing it would blunt
   * the exact thing a cadence game reads. Null is a state, not an error; a
   * game that steers on cadence is expected to say so on screen rather than
   * sit at zero looking broken. Games that do not implement this never see it.
   */
  setCadence?(rpm: number | null): void;

  /**
   * The resistance this game WANTS right now. The shell decides what is
   * actually sent — it will send flat instead whenever the rider is not being
   * asked to push against anything.
   */
  simulation(): SimulationParams;

  readonly isOver: boolean;

  /**
   * The rider hit the safety stop. End the run. Never touch the trainer here:
   * the shell's next single write is what relaxes it.
   */
  stop(): void;

  /**
   * Called once, when the run ends and before `result()`, so the game can
   * update its own records. The shell never calls this mid-ride.
   */
  onEnd?(store: Storage): void;

  result(): RunResult;

  /** Per-game rows for the status strip the shell draws. May be empty. */
  hud(): readonly HudLine[];
}

export interface GameModule {
  readonly id: string;
  readonly name: string;
  /** One line, player-facing, shown on the game's card. */
  readonly blurb: string;
  /**
   * True when the game is materially worse read-only. The hub warns on this
   * game's card when the trainer cannot take a resistance command, rather
   * than letting the rider find out four minutes into a climb.
   */
  readonly needsResistance: boolean;
  /**
   * True when the game steers on cadence. Some trainers report power and no
   * cadence at all, and a game read on the pedals is unplayable on one — so
   * the hub says so on this game's card once it knows, rather than leaving
   * the rider spinning at a machine that is not listening.
   */
  readonly needsCadence?: boolean;
  /**
   * True when this game's load is part of its design and the shell must send
   * it ungeared.
   *
   * The shell owns a virtual gear — a cassette the rider shifts mid-ride to
   * find a load their legs agree with — and it is applied to whatever
   * `simulation()` returns. That is right for a game about effort and wrong
   * for a game about cadence: Spin Cycle and Fish ask for thin air on purpose
   * so that spinning is cheap and steering does not cost a sprint, and a gear
   * that made spinning expensive would be taking the steering wheel away.
   *
   * Those games are single-speed. Every other game shifts.
   */
  readonly singleSpeed?: boolean;
  /** Empty means legs only, and the shell forwards no keyboard at all. */
  readonly controls: readonly ControlHint[];
  readonly palette: GamePalette;
  /** True when a run is defined by a seed the rider may choose. */
  readonly usesSeed?: boolean;
  /** The pre-run choices, if any. Read from `store` so progress persists. */
  variants?(store: Storage): readonly GameVariant[];
  /**
   * The game's own poster, drawn into the card that offers it.
   *
   * This is deliberately not an image file. A game that draws its own poster
   * with its own palette and its own drawing code cannot advertise something
   * it no longer looks like — re-grade the scene and the poster re-grades
   * with it. It is a still life, not a screenshot: no session, no state, no
   * randomness that is not seeded, and it must draw the same thing every
   * time it is called at the same size.
   *
   * Optional. The hub falls back to a generated panel built from `palette`,
   * so a game can ship without one and still look like it belongs.
   */
  poster?(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  create(opts: GameCreateOptions): GameSession;
}
