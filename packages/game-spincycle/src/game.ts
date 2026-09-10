/**
 * Spin Cycle as an arcade module.
 *
 * The flight rules in `session.ts` are untouched; this adapts them to the
 * shell's contract. The one thing worth pointing at is `simulation()`: it
 * returns a flat road and thin air, always, because cadence is only a usable
 * control axis while spinning is cheap. Put a hill under this game and every
 * steering input becomes a sprint, and there is no game left.
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
import type { SpinSession } from './session.js';

class SpinCycleSession implements GameSession {
  readonly #session: SpinSession;
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
    updateRenderState(
      this.#render, this.#session.speed, this.#session.cadence.rpm, dtSeconds,
    );
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
      headline: `${r.distanceM} m`,
      summary: this.#stopped
        ? 'You stopped the ride.'
        : this.#session.altitude <= 0
          ? 'You ran out of sky and landed in a field.'
          : 'You flew into something English.',
      lines: [
        { label: 'obstacles cleared', value: String(r.cleared) },
        { label: 'time aloft', value: `${r.durationS.toFixed(1)} s` },
      ],
      durationS: r.durationS,
      distanceM: r.distanceM,
      avgPower: r.avgPower,
      score: r.distanceM,
      stopped: this.#stopped,
    };
  }

  hud(): readonly HudLine[] {
    const rpm = this.#session.cadence.rpm;
    return [
      { label: 'cadence', value: rpm === null ? '—' : `${Math.round(rpm)} rpm` },
      { label: 'altitude', value: `${Math.round(this.#session.altitude)} m` },
      { label: 'distance', value: `${Math.round(this.#session.distance)} m` },
    ];
  }
}

export const spincycle: GameModule = {
  id: 'spincycle',
  name: 'Spin Cycle',
  blurb:
    'A pedal-powered flying machine. Spin faster to climb, slower to sink, ' +
    '80 rpm to hold level — and ride harder to go further, faster.',
  // Flat road, thin air, on purpose. Read-only trainers play this in full.
  needsResistance: false,
  // Cadence IS the steering. A trainer that reports watts and no cadence
  // cannot fly this at all, and the hub says so before the rider starts.
  needsCadence: true,
  // Single-speed, and not by accident. Cadence is the steering wheel here;
  // a gear that made spinning expensive would make climbing cost a sprint,
  // which is exactly the trade this game was built to avoid.
  singleSpeed: true,
  controls: [],
  // A sunlit English afternoon: pale sky, brass and canvas, a hedgerow.
  palette: { base: '#bcdff2', accent: '#c98a3c', detail: '#78975b' },
  usesSeed: true,
  poster,
  create(opts: GameCreateOptions): GameSession {
    return new SpinCycleSession(opts.profile, opts.seed ?? 1);
  },
};
