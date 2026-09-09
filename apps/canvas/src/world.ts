import {
  BLOCK_LENGTH_M, INITIAL_SCORE_STATE, RIDABLE_MAX, RIDABLE_MIN,
  generateBlock,
} from '@paperboy/game-core';
import type {
  BlockSpec, HazardSpec, HouseSpec, ScoreState, StackSpec,
} from '@paperboy/game-core';
import { stepPhysics } from '@paperboy/trainer';
import type { RiderProfile } from '@paperboy/trainer';

export const START_PAPERS = 20;
export const MAX_PAPERS = 30;
export const STACK_PAPERS = 10;
export const START_LIVES = 3;
export const STEER_RATE = 4.5;
export const STREAM_AHEAD_M = 400;
export const STREAM_BEHIND_M = 200;

export interface Rider {
  distance: number;
  lateral: number;
  speed: number;
  papers: number;
  lives: number;
  invulnerableUntil: number;
}

export interface HouseState {
  spec: HouseSpec;
  delivered: boolean;
  windowBroken: boolean;
  resolved: boolean;
}

export interface HazardState {
  spec: HazardSpec;
  distance: number;
  lateral: number;
}

export interface StackState {
  spec: StackSpec;
  taken: boolean;
}

export interface Paper {
  id: number;
  distance: number;
  lateral: number;
  height: number;
  vDistance: number;
  vLateral: number;
  vHeight: number;
}

export interface WorldState {
  seed: number;
  elapsed: number;
  rider: Rider;
  blocks: BlockSpec[];
  houses: HouseState[];
  hazards: HazardState[];
  stacks: StackState[];
  papers: Paper[];
  score: ScoreState;
  blocksCleared: number;
  gameOver: boolean;
  nextPaperId: number;
}

export function createWorld(seed: number): WorldState {
  return {
    seed,
    elapsed: 0,
    rider: {
      distance: 0,
      lateral: 3.8,
      speed: 0,
      papers: START_PAPERS,
      lives: START_LIVES,
      invulnerableUntil: 0,
    },
    blocks: [],
    houses: [],
    hazards: [],
    stacks: [],
    papers: [],
    score: { ...INITIAL_SCORE_STATE },
    blocksCleared: 0,
    gameOver: false,
    nextPaperId: 1,
  };
}

export function ensureBlocks(w: WorldState): void {
  const needUntil = w.rider.distance + STREAM_AHEAD_M;
  let nextIndex = w.blocks.length === 0 ? 0 : w.blocks.at(-1)!.index + 1;

  while (
    w.blocks.length === 0 ||
    w.blocks.at(-1)!.startDistance + BLOCK_LENGTH_M < needUntil
  ) {
    const block = generateBlock(w.seed, nextIndex);
    w.blocks.push(block);
    block.houses.forEach((spec) =>
      w.houses.push({ spec, delivered: false, windowBroken: false, resolved: false }),
    );
    block.hazards.forEach((spec) =>
      w.hazards.push({ spec, distance: spec.distance, lateral: spec.lateral }),
    );
    block.stacks.forEach((spec) => w.stacks.push({ spec, taken: false }));
    nextIndex += 1;
  }

  const cutoff = w.rider.distance - STREAM_BEHIND_M;
  w.blocks = w.blocks.filter((b) => b.startDistance + b.length > cutoff);
  w.houses = w.houses.filter((h) => h.spec.distance > cutoff);
  w.hazards = w.hazards.filter((h) => h.distance > cutoff);
  w.stacks = w.stacks.filter((s) => s.spec.distance > cutoff);
}

export function surfaceCrr(lateral: number): number {
  if (lateral < 3.0) return 0.02;    // lawn
  if (lateral < 4.5) return 0.005;   // sidewalk
  if (lateral < 5.5) return 0.014;   // curb
  return 0.005;                      // road
}

export function gradeAt(w: WorldState, distance: number): number {
  const block = w.blocks.find(
    (b) => distance >= b.startDistance && distance < b.startDistance + b.length,
  );
  return block?.gradePercent ?? 0;
}

export function steer(w: WorldState, direction: number, dt: number): void {
  const next = w.rider.lateral + direction * STEER_RATE * dt;
  w.rider.lateral = Math.max(RIDABLE_MIN, Math.min(RIDABLE_MAX, next));
}

export function advanceRider(
  w: WorldState,
  powerWatts: number,
  profile: RiderProfile,
  dt: number,
): void {
  const next = stepPhysics(
    { speed: w.rider.speed, distance: w.rider.distance },
    {
      powerWatts,
      gradePercent: gradeAt(w, w.rider.distance),
      crr: surfaceCrr(w.rider.lateral),
      headwind: 0,
    },
    profile,
    dt,
  );
  w.rider.speed = next.speed;
  w.rider.distance = next.distance;
  w.elapsed += dt;
}

export function moveHazards(w: WorldState, dt: number): void {
  for (const h of w.hazards) {
    if (!h.spec.moving) continue;

    if (h.spec.kind === 'car') {
      // Traffic runs along the road, oncoming.
      h.distance -= h.spec.speed * dt;
    } else {
      // Everything else weaves across its own band.
      const t = w.elapsed + h.spec.phase * 10;
      const swing = Math.sin(t * 0.8) * 0.8;
      h.lateral = h.spec.lateral + swing;
      h.distance = h.spec.distance + Math.sin(t * 0.4) * 2;
    }
  }
}
