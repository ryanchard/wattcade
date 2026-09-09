import { BLOCK_LENGTH_M, difficultyAt } from './difficulty.js';
import { mulberry32, pick, rangeFloat } from './rng.js';
import type { Rng } from './rng.js';

export type HazardKind =
  | 'car' | 'dog' | 'sprinkler' | 'lawnmower' | 'drain' | 'bin' | 'skater';

export interface HouseSpec {
  id: string;
  distance: number;
  subscriber: boolean;
  mailboxLateral: number;
  porchLateral: number;
  windowLateral: number;
}

export interface HazardSpec {
  id: string;
  kind: HazardKind;
  distance: number;
  lateral: number;
  width: number;
  speed: number;
  phase: number;
  moving: boolean;
}

export interface SurfaceSpec {
  distance: number;
  length: number;
  lateral: number;
  width: number;
  kind: 'grass' | 'curb';
}

export interface StackSpec {
  id: string;
  distance: number;
  lateral: number;
}

export interface BlockSpec {
  index: number;
  startDistance: number;
  length: number;
  gradePercent: number;
  houses: HouseSpec[];
  hazards: HazardSpec[];
  surfaces: SurfaceSpec[];
  stacks: StackSpec[];
}

export const RIDER_WIDTH_M = 0.8;
export const RIDABLE_MIN = 2.0;
export const RIDABLE_MAX = 9.5;
export const MIN_CORRIDOR_M = 0.9;

/** How far along the street a hazard blocks the rider's line. */
const HAZARD_DEPTH_M = 2.5;

interface HazardTemplate {
  kind: HazardKind;
  lateralLo: number;
  lateralHi: number;
  width: number;
  moving: boolean;
}

const TEMPLATES: readonly HazardTemplate[] = [
  { kind: 'car', lateralLo: 5.8, lateralHi: 9.0, width: 1.8, moving: true },
  { kind: 'skater', lateralLo: 3.0, lateralHi: 4.4, width: 0.7, moving: true },
  { kind: 'dog', lateralLo: 2.2, lateralHi: 4.4, width: 0.6, moving: true },
  { kind: 'lawnmower', lateralLo: 1.6, lateralHi: 2.9, width: 0.9, moving: true },
  { kind: 'sprinkler', lateralLo: 1.6, lateralHi: 2.9, width: 1.2, moving: false },
  { kind: 'bin', lateralLo: 3.1, lateralHi: 4.4, width: 0.8, moving: false },
  { kind: 'drain', lateralLo: 4.6, lateralHi: 5.4, width: 0.7, moving: false },
];

/**
 * Lateral intervals within the ridable band that no hazard occupies at this
 * point along the street. The generator uses this to guarantee that a block
 * can always be ridden through; the tests use it to prove that it did.
 *
 * SCOPE OF THE GUARANTEE: this function, and the `wouldBlock` check the
 * generator runs against it, evaluate every hazard at its spawn `distance`
 * and `lateral` only. They never read `speed`, `phase`, or `moving`. So the
 * invariant `generateBlock` actually establishes is "no block is impassable
 * in its static spawn configuration" — NOT "no block is ever impassable at
 * runtime". A later system that animates cars, dogs, etc. moves hazards away
 * from these spawn coordinates over time, and that motion is not analysed
 * here at all.
 *
 * This is fine for a *moving* hazard: it can transiently narrow or even
 * momentarily close a corridor as it passes through, but because it keeps
 * moving it also reopens one — a rider who waits or times their line still
 * gets through. That is categorically different from a static wall, which
 * is what this invariant actually forbids.
 *
 * The failure mode to watch for: any future code that freezes a moving
 * hazard in place, slows it enough that it behaves like a static obstacle
 * for practical purposes, or otherwise removes its ability to clear the
 * corridor over time, MUST NOT assume this file's passability guarantee
 * still holds — it was never evaluated against that hazard's motion, only
 * against its spawn point.
 */
export function freeCorridors(
  hazards: readonly HazardSpec[],
  distance: number,
): Array<[number, number]> {
  const blocked = hazards
    .filter((h) => Math.abs(h.distance - distance) <= HAZARD_DEPTH_M / 2)
    .map((h): [number, number] => [
      h.lateral - h.width / 2,
      h.lateral + h.width / 2,
    ])
    .sort((a, b) => a[0] - b[0]);

  const gaps: Array<[number, number]> = [];
  let cursor = RIDABLE_MIN;
  for (const [lo, hi] of blocked) {
    if (lo > cursor) gaps.push([cursor, Math.min(lo, RIDABLE_MAX)]);
    cursor = Math.max(cursor, hi);
    if (cursor >= RIDABLE_MAX) break;
  }
  if (cursor < RIDABLE_MAX) gaps.push([cursor, RIDABLE_MAX]);
  return gaps.filter(([lo, hi]) => hi > lo);
}

function widestCorridor(
  hazards: readonly HazardSpec[],
  distance: number,
): number {
  const gaps = freeCorridors(hazards, distance);
  return Math.max(0, ...gaps.map(([lo, hi]) => hi - lo));
}

/** Would adding this hazard wall off the street anywhere near it? */
function wouldBlock(
  existing: readonly HazardSpec[],
  candidate: HazardSpec,
): boolean {
  const next = [...existing, candidate];
  const from = candidate.distance - HAZARD_DEPTH_M;
  const to = candidate.distance + HAZARD_DEPTH_M;
  for (let d = from; d <= to; d += 0.5) {
    if (widestCorridor(next, d) < MIN_CORRIDOR_M) return true;
  }
  return false;
}

export function generateBlock(seed: number, index: number): BlockSpec {
  // Mixing the index into the seed makes each block independently
  // reproducible, so blocks can be generated in any order or regenerated
  // on demand without replaying the whole route.
  const rng: Rng = mulberry32((seed ^ (index * 0x9e3779b1)) >>> 0);
  const d = difficultyAt(index);
  const startDistance = index * BLOCK_LENGTH_M;

  const gradePercent = Number(
    rangeFloat(rng, -d.maxGradePercent, d.maxGradePercent).toFixed(2),
  );

  const houses: HouseSpec[] = [];
  const spacing = BLOCK_LENGTH_M / (d.housesPerBlock + 1);
  for (let i = 0; i < d.housesPerBlock; i++) {
    houses.push({
      id: `h-${index}-${i}`,
      distance: startDistance + spacing * (i + 1),
      subscriber: rng() < d.subscriberRatio,
      mailboxLateral: Number(rangeFloat(rng, 2.9, 3.3).toFixed(2)),
      porchLateral: Number(rangeFloat(rng, 1.6, 2.2).toFixed(2)),
      windowLateral: Number(rangeFloat(rng, 0.6, 1.2).toFixed(2)),
    });
  }

  const hazards: HazardSpec[] = [];
  let attempts = 0;
  while (hazards.length < d.hazardBudget && attempts < d.hazardBudget * 12) {
    attempts += 1;
    const t = pick(rng, TEMPLATES);
    const candidate: HazardSpec = {
      id: `z-${index}-${hazards.length}-${attempts}`,
      kind: t.kind,
      distance: startDistance + rangeFloat(rng, 6, BLOCK_LENGTH_M - 6),
      lateral: Number(rangeFloat(rng, t.lateralLo, t.lateralHi).toFixed(2)),
      width: t.width,
      speed: t.moving ? Number(rangeFloat(rng, 0.4, 1).toFixed(2)) * d.trafficSpeed : 0,
      phase: Number(rng().toFixed(3)),
      moving: t.moving,
    };
    if (wouldBlock(hazards, candidate)) continue;
    hazards.push(candidate);
  }

  const surfaces: SurfaceSpec[] = [
    {
      distance: startDistance,
      length: BLOCK_LENGTH_M,
      lateral: 2.25,
      width: 1.5,
      kind: 'grass',
    },
    {
      distance: startDistance,
      length: BLOCK_LENGTH_M,
      lateral: 5.0,
      width: 1.0,
      kind: 'curb',
    },
  ];

  const stacks: StackSpec[] = [];
  if (index === 0 || rng() < 0.55) {
    stacks.push({
      id: `s-${index}-0`,
      distance: startDistance + rangeFloat(rng, 10, BLOCK_LENGTH_M - 10),
      lateral: Number(rangeFloat(rng, 3.2, 4.2).toFixed(2)),
    });
  }

  return {
    index,
    startDistance,
    length: BLOCK_LENGTH_M,
    gradePercent,
    houses,
    hazards,
    surfaces,
    stacks,
  };
}
