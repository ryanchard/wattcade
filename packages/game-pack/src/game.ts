/**
 * The Pack as an arcade module.
 *
 * The chase rules in `session.ts` are untouched. This file adapts them to the
 * shell's contract and owns the one piece of presentation state that used to
 * live in the app's `main.ts`: the gap trend behind the HUD's arrow, which is
 * derived from real frame time and never fed back into the simulation.
 */
import type {
  GameCreateOptions, GameModule, GameSession, HudLine, RiderProfile, RunResult,
  SimulationParams,
} from '@paperboy/game-api';
import { drawHud } from './hud.js';
import { poster } from './poster.js';
import { createRenderState, renderScene, updateRenderState } from './render.js';
import type { RenderState } from './render.js';
import {
  advance, createSession, simulationFor, stopRun, toRunResult,
} from './session.js';
import type { Session } from './session.js';

class PackSession implements GameSession {
  readonly #session: Session;
  readonly #render: RenderState = createRenderState();
  /** The gap a moment ago, used only to colour the HUD's arrow. */
  #lastGap: number;
  #gapTrend = 0;
  #stopped = false;

  constructor(profile: RiderProfile) {
    this.#session = createSession(profile);
    this.#lastGap = this.#session.gap;
  }

  get isOver(): boolean {
    return this.#session.caught;
  }

  advance(dtSeconds: number, powerWatts: number): void {
    // The shell eased these watts with this game's own time constant, so the
    // session's internal ease is set to a no-op rather than run twice.
    this.#session.powerTarget = powerWatts;
    this.#session.powerCurrent = powerWatts;
    advance(this.#session, dtSeconds);
  }

  animate(dtSeconds: number): void {
    updateRenderState(this.#render, this.#session.speed, dtSeconds);
    if (dtSeconds > 0) {
      // The dead zone that stops this flickering lives in drawHud; this is
      // deliberately the raw rate.
      this.#gapTrend = (this.#session.gap - this.#lastGap) / dtSeconds;
      this.#lastGap = this.#session.gap;
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    renderScene(ctx, this.#session, this.#render, width, height);
    drawHud(ctx, this.#session, this.#gapTrend, width);
  }

  simulation(): SimulationParams {
    return simulationFor(this.#session);
  }

  stop(): void {
    this.#stopped = true;
    stopRun(this.#session);
  }

  result(): RunResult {
    const r = toRunResult(this.#session);
    const shaken = `${r.dogsShaken} dog${r.dogsShaken === 1 ? '' : 's'} shaken`;
    return {
      headline: `${r.distanceM} m`,
      summary: this.#stopped ? 'You stopped the ride.' : `The pack caught you. ${shaken}.`,
      lines: [
        { label: 'dogs shaken', value: String(r.dogsShaken) },
        { label: 'still on you at the end', value: String(this.#session.dogs) },
        {
          label: 'battery left',
          value: `${Math.round(r.batteryLeft * 100)}% of your store`,
        },
      ],
      durationS: r.durationMs / 1000,
      distanceM: r.distanceM,
      avgPower: r.avgPower,
      score: r.distanceM,
      stopped: this.#stopped,
    };
  }

  hud(): readonly HudLine[] {
    return [
      { label: 'speed', value: `${(this.#session.speed * 3.6).toFixed(1)} km/h` },
      { label: 'distance', value: `${Math.round(this.#session.distance)} m` },
    ];
  }
}

export const pack: GameModule = {
  id: 'pack',
  name: 'The Pack',
  blurb:
    'Dogs latch on and drag you back. Sprint long enough above your FTP to ' +
    'throw one off, or they close the gap.',
  // Every dog is a steeper hill. Read-only, the drag is invisible and there
  // is no game left.
  needsResistance: true,
  controls: [],
  // A night chase: cold sky, one warm rider, the dog that has you.
  palette: { base: '#1b2036', accent: '#c94f3a', detail: '#3c4568' },
  poster,
  create(opts: GameCreateOptions): GameSession {
    return new PackSession(opts.profile);
  },
};
