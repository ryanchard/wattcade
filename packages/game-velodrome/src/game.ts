/**
 * Velodrome as an arcade module.
 *
 * The race in `race.ts` and the rivals in `rivals.ts` are untouched. What
 * lives here is the ladder: which rung the rider has earned, which rival they
 * have met, and how that reads on the hub. It used to be inline in the app's
 * `main.ts` against `localStorage` directly; it now goes through the `Storage`
 * the shell hands over, and keeps the same two keys so nobody loses progress.
 */
import type {
  GameCreateOptions, GameModule, GameSession, GameVariant, HudLine, RunResult,
  SimulationParams,
} from '@paperboy/game-api';
import type { RiderProfile } from '@paperboy/trainer';
import { drawHud } from './hud.js';
import { poster } from './poster.js';
import { createRenderState, renderScene, updateRenderState } from './render.js';
import type { RenderState } from './render.js';
import {
  advance, createRace, simulationFor, stopRace, toRaceResult,
} from './race.js';
import type { RaceState } from './race.js';
import { LADDER, rivalById } from './rivals.js';
import type { RivalSpec } from './rivals.js';

/** Rivals the rider has beaten. Unchanged from the standalone app. */
const BEATEN_KEY = 'velodrome.beaten';
/** Rivals the rider has raced at least once, and so knows the tell of. */
const MET_KEY = 'velodrome.met';

function readIds(store: Storage, key: string): Set<string> {
  try {
    const raw = store.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function addId(store: Storage, key: string, id: string): void {
  const ids = readIds(store, key);
  ids.add(id);
  try {
    store.setItem(key, JSON.stringify([...ids]));
  } catch {
    // A private window with storage disabled means no ladder memory. The
    // race still runs, which is the part that matters.
  }
}

/** The ladder as the hub should show it: locked until the rung below is
 * beaten, and the tell withheld until the rider has ridden them once —
 * finding it yourself is the game. */
export function ladderVariants(store: Storage): readonly GameVariant[] {
  const beaten = readIds(store, BEATEN_KEY);
  const met = readIds(store, MET_KEY);
  return LADDER.map((spec, i): GameVariant => {
    const previous = LADDER[i - 1];
    const unlocked = previous === undefined || beaten.has(previous.id);
    return {
      id: spec.id,
      name: spec.name,
      detail: spec.line,
      note: !unlocked
        ? 'Beat the rider above first.'
        : met.has(spec.id)
          ? `Tell: ${spec.tell}`
          : 'Ride them once to learn how they ride.',
      locked: !unlocked,
      cleared: beaten.has(spec.id),
    };
  });
}

class VelodromeSession implements GameSession {
  readonly #race: RaceState;
  readonly #spec: RivalSpec;
  readonly #render: RenderState = createRenderState();
  #stopped = false;

  constructor(profile: RiderProfile, spec: RivalSpec, store: Storage) {
    this.#spec = spec;
    this.#race = createRace(profile, spec);
    // Meeting them is what earns the tell, win or lose.
    addId(store, MET_KEY, spec.id);
  }

  get isOver(): boolean {
    return this.#race.finished;
  }

  advance(dtSeconds: number, powerWatts: number): void {
    // Already eased by the shell with this race's own time constant; setting
    // both fields makes `advance`'s ease a no-op rather than a second filter.
    this.#race.player.powerTarget = powerWatts;
    this.#race.player.powerCurrent = powerWatts;
    advance(this.#race, dtSeconds);
  }

  animate(dtSeconds: number, width: number, height: number): void {
    updateRenderState(this.#render, this.#race, width, height, dtSeconds);
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    renderScene(ctx, this.#race, this.#render, width, height);
    drawHud(ctx, this.#race, width, height);
  }

  simulation(): SimulationParams {
    return simulationFor(this.#race);
  }

  stop(): void {
    this.#stopped = true;
    stopRace(this.#race);
  }

  onEnd(store: Storage): void {
    if (this.#race.winner === 'player') addId(store, BEATEN_KEY, this.#spec.id);
  }

  result(): RunResult {
    const r = toRaceResult(this.#race);
    const won = r.winner === 'player';
    const margin = Math.abs(r.marginM).toFixed(1);
    const lines: HudLine[] = [
      { label: 'sheltered', value: `${Math.round(r.draftShare * 100)}% of the race` },
    ];
    if (!r.aborted) {
      lines.push({ label: 'tell', value: this.#spec.tell });
      lines.push({ label: 'counter', value: this.#spec.counter });
    }

    const index = LADDER.findIndex((s) => s.id === this.#spec.id);
    const next = LADDER[index + 1];

    return {
      headline: r.aborted ? 'Stopped' : won ? 'Won' : 'Lost',
      summary: r.aborted
        ? `You stopped ${margin} m ${r.marginM >= 0 ? 'up' : 'down'} on ${this.#spec.name}.`
        : `${margin} m ${r.marginM >= 0 ? 'ahead of' : 'behind'} ${this.#spec.name}.`,
      lines,
      durationS: r.timeS,
      // Whatever the rider actually covered, which is the full distance if
      // they crossed the line and less if the rival got there first.
      distanceM: Math.round(this.#race.player.distance),
      avgPower: r.avgPower,
      // A race is won or lost. Ranking it by a number would invent a
      // scoreboard the game does not have.
      score: null,
      stopped: this.#stopped,
      // Four laps is four laps whoever you rode it against, so a winning
      // time is comparable with every other winning time and can hold a
      // place on the board. A losing time is the moment somebody ELSE
      // crossed the line, which would rank every defeat above every win.
      ...(won && !r.aborted ? { rankTimeS: r.timeS } : {}),
      ...(won && next !== undefined ? { nextVariantId: next.id } : {}),
    };
  }

  hud(): readonly HudLine[] {
    // Velodrome draws its own full instrument panel — watts, lap, gap, speed
    // and the loop — so there is nothing left for the shell to add.
    return [];
  }
}

export const velodrome: GameModule = {
  id: 'velodrome',
  name: 'Velodrome',
  blurb:
    'Four laps, one rival, and the air between you. Sit in their shelter ' +
    'and the trainer goes quiet; come past too early and it does not.',
  // The whole game is the trainer easing off in the draft. Read-only, there
  // is nothing to feel and nothing to time.
  needsResistance: true,
  controls: [],
  // A lit indoor track: warm pine boards against a cold near-black arena,
  // with the sprinters' line in red.
  palette: { base: '#0E1418', accent: '#C99A5E', detail: '#C2372F' },
  variants: ladderVariants,
  poster,
  create(opts: GameCreateOptions): GameSession {
    const spec = rivalById(opts.variantId ?? '') ?? LADDER[0]!;
    return new VelodromeSession(opts.profile, spec, opts.store);
  },
};
