/**
 * Fish as an arcade module.
 *
 * As with Spin Cycle, `simulation()` is flat and thin on purpose: cadence is
 * only a control axis while spinning is cheap, and a fish fighting a 6%
 * gradient is not steering, it is climbing.
 */
import type {
  GameCreateOptions, GameModule, GameSession, HudLine, RunResult,
  SimulationParams,
} from '@paperboy/game-api';
import type { RiderProfile } from '@paperboy/trainer';
import { drawHud } from './hud.js';
import { poster } from './poster.js';
import { createRenderState, renderScene, updateRenderState } from './render.js';
import type { RenderState } from './render.js';
import {
  advance, createSession, setCadence, simulationFor, stopRun, toRunSummary,
} from './session.js';
import type { FishSession } from './session.js';

class FishGameSession implements GameSession {
  readonly #session: FishSession;
  readonly #render: RenderState = createRenderState();
  #stopped = false;

  constructor(profile: RiderProfile, seed: number) {
    this.#session = createSession(profile, seed);
  }

  get isOver(): boolean {
    return this.#session.over;
  }

  advance(dtSeconds: number, powerWatts: number): void {
    advance(this.#session, dtSeconds, powerWatts);
  }

  setCadence(rpm: number | null): void {
    setCadence(this.#session, rpm);
  }

  animate(dtSeconds: number): void {
    updateRenderState(this.#render, this.#session.speed, dtSeconds);
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    renderScene(ctx, this.#session, this.#render, width, height);
    drawHud(ctx, this.#session, width, height);
  }

  simulation(): SimulationParams {
    return simulationFor(this.#session);
  }

  stop(): void {
    this.#stopped = true;
    stopRun(this.#session);
  }

  result(): RunResult {
    const r = toRunSummary(this.#session);
    return {
      headline: `${r.eaten} fish`,
      summary: this.#stopped
        ? 'You stopped the ride.'
        : `Something ${r.size.toFixed(1)} m long was not big enough. It was eaten.`,
      lines: [
        { label: 'you grew to', value: `${r.size.toFixed(2)} m` },
        {
          label: 'biggest mouthful',
          value: r.biggestEaten > 0 ? `${r.biggestEaten.toFixed(2)} m` : '—',
        },
        { label: 'swum', value: `${r.distanceM} m` },
      ],
      durationS: r.durationS,
      distanceM: r.distanceM,
      avgPower: r.avgPower,
      score: r.eaten,
      stopped: this.#stopped,
    };
  }

  hud(): readonly HudLine[] {
    const rpm = this.#session.cadence.rpm;
    return [
      { label: 'cadence', value: rpm === null ? '—' : `${Math.round(rpm)} rpm` },
      { label: 'size', value: `${this.#session.size.toFixed(2)} m` },
      { label: 'eaten', value: String(this.#session.eaten) },
    ];
  }
}

export const fish: GameModule = {
  id: 'fish',
  name: 'Fish',
  blurb:
    'You are a fish. Pedal faster to rise, slower to sink. Eat anything ' +
    'smaller than you, and grow until it is no longer a problem.',
  // Flat road, thin air, on purpose. Read-only trainers play this in full.
  needsResistance: false,
  // Cadence is depth. Without it there is no up and no down.
  needsCadence: true,
  // Single-speed, and not by accident. Cadence is the steering wheel here;
  // a gear that made spinning expensive would make swimming up cost a
  // sprint, which is exactly the trade this game was built to avoid.
  singleSpeed: true,
  controls: [],
  // Deep water, one warm fish, and something glowing in the dark.
  palette: { base: '#12657f', accent: '#ff9d4d', detail: '#8ff0c4' },
  usesSeed: true,
  poster,
  create(opts: GameCreateOptions): GameSession {
    return new FishGameSession(opts.profile, opts.seed ?? 1);
  },
};
