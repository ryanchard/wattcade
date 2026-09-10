/**
 * Every game the arcade offers, in the order the hub shows them.
 *
 * `apps/phaser` is deliberately absent. It is a rebuild of Paperboy kept as a
 * bake-off comparison artifact; "Paperboy" and "Paperboy but Phaser" sitting
 * side by side would be a question for the rider that has nothing to do with
 * riding.
 */
import type { GameModule } from '@paperboy/game-api';
import { paperboy } from '@paperboy/game-paperboy';
import { pack } from '@paperboy/game-pack';
import { spincycle } from '@paperboy/game-spincycle';
import { velodrome } from '@paperboy/game-velodrome';

export const CATALOG: readonly GameModule[] = [paperboy, pack, velodrome, spincycle];

export function gameById(id: string): GameModule | null {
  return CATALOG.find((g) => g.id === id) ?? null;
}
