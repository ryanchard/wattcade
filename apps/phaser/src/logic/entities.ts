import { BLOCK_LENGTH_M, generateBlock } from '@paperboy/game-core';
import type { BlockSpec } from '@paperboy/game-core';

export const STREAM_AHEAD_M = 400;
export const STREAM_BEHIND_M = 200;

export interface EntityRecord {
  id: string;
  kind: 'house' | 'hazard' | 'stack';
  distance: number;
  lateral: number;
  width: number;
  spec: unknown;
}

export interface StreamResult {
  added: EntityRecord[];
  removed: string[];
}

/**
 * Emits create/destroy deltas rather than a world snapshot, because Phaser
 * wants to own its game objects. Version A pulls a fresh array each frame;
 * this pushes changes. Same route, different shape.
 */
export class BlockStreamer {
  readonly blocks: BlockSpec[] = [];
  #seed: number;
  #nextIndex = 0;
  #live = new Map<string, EntityRecord>();

  constructor(seed: number) {
    this.#seed = seed;
  }

  update(riderDistance: number): StreamResult {
    const added: EntityRecord[] = [];
    const needUntil = riderDistance + STREAM_AHEAD_M;

    while (this.#nextIndex * BLOCK_LENGTH_M < needUntil) {
      const block = generateBlock(this.#seed, this.#nextIndex);
      this.blocks.push(block);
      this.#nextIndex += 1;

      for (const h of block.houses) {
        added.push({
          id: h.id, kind: 'house', distance: h.distance,
          lateral: 0.75, width: 1.4, spec: h,
        });
      }
      for (const z of block.hazards) {
        added.push({
          id: z.id, kind: 'hazard', distance: z.distance,
          lateral: z.lateral, width: z.width, spec: z,
        });
      }
      for (const s of block.stacks) {
        added.push({
          id: s.id, kind: 'stack', distance: s.distance,
          lateral: s.lateral, width: 0.6, spec: s,
        });
      }
    }

    for (const record of added) this.#live.set(record.id, record);

    const cutoff = riderDistance - STREAM_BEHIND_M;
    const removed: string[] = [];
    for (const [id, record] of this.#live) {
      if (record.distance < cutoff) {
        removed.push(id);
        this.#live.delete(id);
      }
    }

    const keepFrom = cutoff - BLOCK_LENGTH_M;
    while (
      this.blocks.length > 0 &&
      this.blocks[0]!.startDistance + BLOCK_LENGTH_M < keepFrom
    ) {
      this.blocks.shift();
    }

    return { added, removed };
  }

  gradeAt(distance: number): number {
    const block = this.blocks.find(
      (b) => distance >= b.startDistance && distance < b.startDistance + b.length,
    );
    return block?.gradePercent ?? 0;
  }
}

// Mirrors apps/canvas/src/world.ts's surfaceCrr exactly (see its comment
// for why these bands are duplicated rather than shared: the one shared
// definition that looked like it should back this, game-core's
// SurfaceSpec, was deleted as dead and incomplete rather than promoted).
export function surfaceCrr(lateral: number): number {
  if (lateral < 3.0) return 0.02;
  if (lateral < 4.5) return 0.005;
  if (lateral < 5.5) return 0.014;
  return 0.005;
}
