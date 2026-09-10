import { depthKey } from '../iso.js';
import type {
  HazardState, HouseState, Paper, StackState, WorldState,
} from '../world.js';

export const CULL_BEHIND_M = 60;
export const CULL_AHEAD_M = 260;

export type Drawable =
  | { kind: 'house'; depth: number; house: HouseState }
  | { kind: 'hazard'; depth: number; hazard: HazardState }
  | { kind: 'stack'; depth: number; stack: StackState }
  | { kind: 'paper'; depth: number; paper: Paper }
  | { kind: 'rider'; depth: number };

export function collectDrawables(w: WorldState): Drawable[] {
  const lo = w.rider.distance - CULL_BEHIND_M;
  const hi = w.rider.distance + CULL_AHEAD_M;
  const visible = (distance: number) => distance > lo && distance < hi;

  const out: Drawable[] = [];

  for (const house of w.houses) {
    if (!visible(house.spec.distance)) continue;
    out.push({
      kind: 'house',
      depth: depthKey(house.spec.distance, 0.75),
      house,
    });
  }
  for (const hazard of w.hazards) {
    if (!visible(hazard.distance)) continue;
    out.push({
      kind: 'hazard',
      depth: depthKey(hazard.distance, hazard.lateral),
      hazard,
    });
  }
  for (const stack of w.stacks) {
    if (stack.taken || !visible(stack.spec.distance)) continue;
    out.push({
      kind: 'stack',
      depth: depthKey(stack.spec.distance, stack.spec.lateral),
      stack,
    });
  }
  for (const paper of w.papers) {
    if (!visible(paper.distance)) continue;
    out.push({
      kind: 'paper',
      depth: depthKey(paper.distance, paper.lateral),
      paper,
    });
  }
  out.push({
    kind: 'rider',
    depth: depthKey(w.rider.distance, w.rider.lateral),
  });

  out.sort((a, b) => a.depth - b.depth);
  return out;
}
