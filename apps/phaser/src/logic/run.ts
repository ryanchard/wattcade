import {
  BLOCK_LENGTH_M, INITIAL_SCORE_STATE, RIDABLE_MAX, RIDABLE_MIN,
  applyScoreEvent, classifyLanding,
} from '@paperboy/game-core';
import type {
  HouseSpec, RunResult, ScoreEvent, ScoreState, StackSpec,
} from '@paperboy/game-core';
import { clampGrade, stepPhysics } from '@paperboy/trainer';
import type { RiderProfile, SimulationParams } from '@paperboy/trainer';
import { BlockStreamer, surfaceCrr } from './entities.js';
import type { StreamResult } from './entities.js';

export const START_PAPERS = 20;
export const MAX_PAPERS = 30;
export const STACK_PAPERS = 10;
export const START_LIVES = 3;
export const STEER_RATE = 4.5;
export const INVULNERABLE_S = 1.5;
export const POWER_TAU_S = 0.25;
export const MAX_PLAUSIBLE_WATTS = 2000;
export const HOUSE_RESOLVE_MARGIN_M = 8;
export const THROW_HEIGHT = 1.1;
export const THROW_V_LATERAL = -7;
export const THROW_V_UP = 3.2;
export const GRAVITY = 9.8;
export const STACK_PICKUP_DISTANCE_M = 1.5;
export const STACK_PICKUP_LATERAL_M = 1.0;

export interface RunInput {
  steer: number;
  throwPaper: boolean;
}

/** Flat road: what the trainer gets whenever the rider is not actually riding. */
export const FLAT_SIMULATION: SimulationParams = Object.freeze({
  grade: 0,
  headwind: 0,
  crr: 0.004,
  cw: 0.51,
});

export interface HouseRuntime {
  spec: HouseSpec;
  delivered: boolean;
  windowBroken: boolean;
  resolved: boolean;
}

export interface StackRuntime {
  spec: StackSpec;
  taken: boolean;
}

export interface PaperRuntime {
  id: number;
  distance: number;
  lateral: number;
  height: number;
  vDistance: number;
  vLateral: number;
  vHeight: number;
}

export interface UpdateOutcome {
  events: ScoreEvent[];
  stream: StreamResult;
}

export class PaperboyRun {
  readonly seed: number;
  readonly streamer: BlockStreamer;
  readonly papers: PaperRuntime[] = [];
  readonly houses = new Map<string, HouseRuntime>();
  readonly stacks = new Map<string, StackRuntime>();

  readonly rider = {
    distance: 0,
    lateral: 3.8,
    speed: 0,
    papers: START_PAPERS,
    lives: START_LIVES,
    invulnerableUntil: 0,
  };

  score: ScoreState = { ...INITIAL_SCORE_STATE };
  elapsed = 0;
  kilojoules = 0;
  gameOver = false;
  paused = false;
  powerTarget = 0;
  powerCurrent = 0;

  #profile: RiderProfile;
  #blocksCleared = 0;
  #nextPaperId = 1;

  constructor(seed: number, profile: RiderProfile) {
    this.seed = seed;
    this.streamer = new BlockStreamer(seed);
    this.#profile = profile;
  }

  get invulnerable(): boolean {
    return this.elapsed < this.rider.invulnerableUntil;
  }

  setPower(watts: number | null): void {
    if (watts === null || !Number.isFinite(watts) || watts < 0) {
      this.powerTarget = 0;
      return;
    }
    this.powerTarget = Math.min(MAX_PLAUSIBLE_WATTS, watts);
  }

  throwPaper(): boolean {
    if (this.rider.papers <= 0 || this.gameOver) return false;
    this.rider.papers -= 1;
    this.papers.push({
      id: this.#nextPaperId++,
      distance: this.rider.distance,
      lateral: this.rider.lateral,
      height: THROW_HEIGHT,
      vDistance: this.rider.speed * 0.55,
      vLateral: THROW_V_LATERAL,
      vHeight: THROW_V_UP,
    });
    return true;
  }

  /** Called by the scene when Arcade reports an overlap. */
  crash(): void {
    if (this.gameOver || this.invulnerable) return;
    this.rider.lives -= 1;
    this.rider.speed *= 0.15;
    this.rider.invulnerableUntil = this.elapsed + INVULNERABLE_S;
    this.score = applyScoreEvent(this.score, { type: 'crash' });
    if (this.rider.lives <= 0) {
      this.rider.lives = 0;
      this.gameOver = true;
    }
  }

  update(dt: number, input: RunInput): UpdateOutcome {
    if (this.paused || this.gameOver) {
      return { events: [], stream: { added: [], removed: [] } };
    }

    const alpha = 1 - Math.exp(-dt / POWER_TAU_S);
    this.powerCurrent += (this.powerTarget - this.powerCurrent) * alpha;
    this.kilojoules += (this.powerCurrent * dt) / 1000;

    this.rider.lateral = Math.max(
      RIDABLE_MIN,
      Math.min(RIDABLE_MAX, this.rider.lateral + input.steer * STEER_RATE * dt),
    );

    const next = stepPhysics(
      { speed: this.rider.speed, distance: this.rider.distance },
      {
        powerWatts: this.powerCurrent,
        gradePercent: this.streamer.gradeAt(this.rider.distance),
        crr: surfaceCrr(this.rider.lateral),
        headwind: 0,
      },
      this.#profile,
      dt,
    );
    this.rider.speed = next.speed;
    this.rider.distance = next.distance;
    this.elapsed += dt;

    const stream = this.streamer.update(this.rider.distance);
    this.#absorb(stream);

    if (input.throwPaper) this.throwPaper();

    const events: ScoreEvent[] = [
      ...this.#updatePapers(dt),
      ...this.#resolvePassedHouses(),
      ...this.#resolveBlocks(),
    ];
    this.#collectStacks();

    for (const e of events) this.score = applyScoreEvent(this.score, e);
    return { events, stream };
  }

  simulation(): SimulationParams {
    return {
      grade: clampGrade(this.streamer.gradeAt(this.rider.distance)),
      headwind: 0,
      crr: surfaceCrr(this.rider.lateral),
      cw: 0.51,
    };
  }

  /**
   * The value the caller should actually send to the trainer this tick.
   *
   * `ControlPointWriter.setSimulation` does not write — it stores a pending
   * value and flushes at most 4 Hz, so only the LAST value set before a flush
   * reaches the device. That makes "send zero on the panic key" useless if any
   * later call in the same tick overwrites it. So the panic key, pause and
   * game-over do NOT send anything themselves: they change state, and this
   * function decides the value. Callers make exactly ONE setSimulation call
   * per tick, with this as its argument.
   */
  effectiveSimulation(): SimulationParams {
    if (this.paused || this.gameOver) return FLAT_SIMULATION;
    return this.simulation();
  }

  result(): RunResult {
    const seconds = this.elapsed;
    return {
      seed: this.seed,
      score: this.score.score,
      distanceM: Math.round(this.rider.distance),
      durationMs: Math.round(seconds * 1000),
      avgPower: seconds > 0 ? Math.round((this.kilojoules * 1000) / seconds) : 0,
      kilojoules: Math.round(this.kilojoules),
      papersDelivered: this.score.papersDelivered,
    };
  }

  #absorb(stream: StreamResult): void {
    for (const record of stream.added) {
      if (record.kind === 'house') {
        this.houses.set(record.id, {
          spec: record.spec as HouseSpec,
          delivered: false,
          windowBroken: false,
          resolved: false,
        });
      } else if (record.kind === 'stack') {
        this.stacks.set(record.id, {
          spec: record.spec as StackSpec,
          taken: false,
        });
      }
    }
    for (const id of stream.removed) {
      this.houses.delete(id);
      this.stacks.delete(id);
    }
  }

  #updatePapers(dt: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    let specs: HouseSpec[] | null = null;

    for (let i = this.papers.length - 1; i >= 0; i--) {
      const p = this.papers[i]!;
      p.vHeight -= GRAVITY * dt;
      p.distance += p.vDistance * dt;
      p.lateral += p.vLateral * dt;
      p.height += p.vHeight * dt;
      if (p.height > 0) continue;

      this.papers.splice(i, 1);
      specs ??= [...this.houses.values()].map((h) => h.spec);
      const outcome = classifyLanding(
        { distance: p.distance, lateral: p.lateral },
        specs,
      );

      if (outcome.band === 'street') continue;
      if (outcome.house === null || outcome.band === 'lawn') {
        events.push({ type: 'lawn' });
        continue;
      }

      const house = [...this.houses.values()].find(
        (h) => h.spec === outcome.house,
      );
      if (house === undefined) {
        events.push({ type: 'lawn' });
        continue;
      }

      if (outcome.band === 'window') {
        if (house.windowBroken) continue;
        house.windowBroken = true;
        if (house.spec.subscriber) {
          house.resolved = true;
          events.push({ type: 'windowSubscriber' });
        } else {
          events.push({ type: 'windowNonSubscriber' });
        }
        continue;
      }

      if (!house.spec.subscriber || house.delivered || house.resolved) continue;
      house.delivered = true;
      house.resolved = true;
      events.push({ type: outcome.band === 'mailbox' ? 'mailbox' : 'porch' });
    }
    return events;
  }

  #resolvePassedHouses(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    for (const house of this.houses.values()) {
      if (house.resolved) continue;
      if (house.spec.distance > this.rider.distance - HOUSE_RESOLVE_MARGIN_M) {
        continue;
      }
      house.resolved = true;
      if (house.spec.subscriber && !house.delivered) {
        events.push({ type: 'houseMissed' });
      }
    }
    return events;
  }

  #resolveBlocks(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    while (this.rider.distance > (this.#blocksCleared + 1) * BLOCK_LENGTH_M) {
      const index = this.#blocksCleared;
      const subs = [...this.houses.values()].filter(
        (h) =>
          h.spec.subscriber &&
          Math.floor(h.spec.distance / BLOCK_LENGTH_M) === index,
      );
      if (subs.length > 0 && subs.every((h) => h.delivered)) {
        events.push({ type: 'blockCleared' });
      }
      this.#blocksCleared += 1;
    }
    return events;
  }

  #collectStacks(): void {
    for (const stack of this.stacks.values()) {
      if (stack.taken) continue;
      if (
        Math.abs(stack.spec.distance - this.rider.distance) >
        STACK_PICKUP_DISTANCE_M
      ) continue;
      if (
        Math.abs(stack.spec.lateral - this.rider.lateral) >
        STACK_PICKUP_LATERAL_M
      ) continue;
      stack.taken = true;
      this.rider.papers = Math.min(MAX_PAPERS, this.rider.papers + STACK_PAPERS);
    }
  }
}
