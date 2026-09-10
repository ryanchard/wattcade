/**
 * Paperboy as an arcade module.
 *
 * Everything here is adaptation, not gameplay: the rules live in `rules.ts`,
 * the state in `world.ts`, and the run's bookkeeping in `session.ts`, all
 * untouched. This file only translates between those and the shell's
 * contract — and, in particular, it never writes to the trainer.
 */
import type {
  GameCreateOptions, GameKeys, GameModule, GameSession, HudLine, RunResult,
  SimulationParams,
} from '@paperboy/game-api';
import { randomSeed, recordRun } from '@paperboy/game-core';
import type { RiderProfile } from '@paperboy/trainer';
import { drawHud } from './hud.js';
import { poster } from './poster.js';
import { renderFrame } from './render/scene.js';
import { advance, createSession, simulationFor, toRunResult } from './session.js';
import type { Session } from './session.js';

class PaperboySession implements GameSession {
  readonly #session: Session;
  #steer = 0;
  /**
   * A throw is edge-triggered and must survive a frame that runs zero
   * substeps, so it is held here until a substep consumes it — the same
   * carry-forward `session.ts` does for its own fixed-step loop.
   */
  #pendingThrow = false;
  #stopped = false;
  /** Best score ever recorded on this seed, learned when the run ends. */
  #bestOnSeed: number | null = null;

  constructor(seed: number, profile: RiderProfile) {
    this.#session = createSession(seed, profile);
  }

  get isOver(): boolean {
    return this.#session.world.gameOver;
  }

  handleKeys(keys: GameKeys): void {
    this.#steer =
      (keys.held.has('ArrowLeft') ? -1 : 0) +
      (keys.held.has('ArrowRight') ? 1 : 0);
    if (keys.pressed.has(' ')) this.#pendingThrow = true;
  }

  advance(dtSeconds: number, powerWatts: number): void {
    // The shell has already eased these watts with the same time constant
    // this session used to apply itself, so both fields are set to the eased
    // value and `advance`'s own ease becomes a no-op rather than a second
    // filter stacked on the first.
    this.#session.powerTarget = powerWatts;
    this.#session.powerCurrent = powerWatts;

    const throwPaper = this.#pendingThrow;
    this.#pendingThrow = false;
    advance(this.#session, { steer: this.#steer, throwPaper }, dtSeconds);
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    renderFrame(ctx, this.#session.world, width, height);
    drawHud(ctx, this.#session, width);
  }

  simulation(): SimulationParams {
    return simulationFor(this.#session);
  }

  stop(): void {
    this.#stopped = true;
    this.#session.world.gameOver = true;
  }

  onEnd(store: Storage): void {
    const result = toRunResult(this.#session);
    const stats = recordRun(result, store);
    this.#bestOnSeed = stats.perSeedBest[String(result.seed)] ?? null;
  }

  result(): RunResult {
    const r = toRunResult(this.#session);
    const lines: HudLine[] = [
      { label: 'papers', value: String(r.papersDelivered) },
      { label: 'energy', value: `${r.kilojoules} kJ` },
      { label: 'seed', value: String(r.seed) },
    ];
    if (this.#bestOnSeed !== null) {
      lines.push({ label: 'best on this route', value: String(this.#bestOnSeed) });
    }
    return {
      headline: String(r.score),
      summary: this.#stopped
        ? 'You stopped the round early.'
        : `${r.papersDelivered} papers delivered before you ran out of lives.`,
      lines,
      durationS: r.durationMs / 1000,
      distanceM: r.distanceM,
      avgPower: r.avgPower,
      score: r.score,
      stopped: this.#stopped,
    };
  }

  hud(): readonly HudLine[] {
    return [
      { label: 'distance', value: `${Math.round(this.#session.world.rider.distance)} m` },
    ];
  }
}

export const paperboy: GameModule = {
  id: 'paperboy',
  name: 'Paperboy',
  blurb:
    'Ride the round before sunrise. Lit windows are subscribers, and the ' +
    'street is doing its best to stop you.',
  needsResistance: true,
  usesSeed: true,
  controls: [
    { keys: 'left / right', action: 'move across the road' },
    { keys: 'space', action: 'throw a paper' },
  ],
  // Pre-dawn suburbia: cold blue sky, a warm porch light, sunrise on the
  // horizon.
  palette: { base: '#1b1f3b', accent: '#ffd98a', detail: '#e8a166' },
  poster,
  create(opts: GameCreateOptions): GameSession {
    return new PaperboySession(opts.seed ?? randomSeed(), opts.profile);
  },
};
