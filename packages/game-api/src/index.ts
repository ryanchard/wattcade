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
import type { RiderProfile, SimulationParams } from '@paperboy/trainer';

export type { RiderProfile, SimulationParams };

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
  /** Empty means legs only, and the shell forwards no keyboard at all. */
  readonly controls: readonly ControlHint[];
  readonly palette: GamePalette;
  /** True when a run is defined by a seed the rider may choose. */
  readonly usesSeed?: boolean;
  /** The pre-run choices, if any. Read from `store` so progress persists. */
  variants?(store: Storage): readonly GameVariant[];
  create(opts: GameCreateOptions): GameSession;
}
