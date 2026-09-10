import { DEFAULT_ISO } from '../iso.js';
import type { Camera, IsoConfig } from '../iso.js';
import type { WorldState } from '../world.js';
import { collectDrawables } from './drawables.js';
import {
  drawHazard, drawHouse, drawHouseGlow, drawPaper, drawRider, drawStack,
  houseIsLit,
} from './entities.js';
import { PALETTE } from './palette.js';
import { groundQuad } from './primitives.js';
import type { DrawCtx } from './primitives.js';

/**
 * How far ahead and behind porch-light pools are painted. Much tighter than
 * the entity cull: the projection is parallel, so a house 260 m up the street
 * is drawn at full size but far off the right-hand edge of the screen, and
 * every pool costs a gradient fill. This window covers everything that can
 * actually be on screen.
 */
const GLOW_AHEAD_M = 140;
const GLOW_BEHIND_M = 30;

/**
 * Slack, in pixels, around the viewport for the off-screen test below. Wide
 * enough to cover the tallest thing drawn (a house roof is ~80 px above its
 * anchor) plus a porch-light pool's radius, so nothing pops in at an edge.
 */
const CULL_MARGIN_PX = 220;

/**
 * Half the widest a house's drawing reaches from its anchor: half the 9 m
 * frontage, plus the eave overhang, plus the mailbox out at the kerb.
 */
const HOUSE_HALF_SPAN_M = 6.0;

/**
 * Is an entity's drawn extent entirely off the left or right of the screen?
 *
 * `collectDrawables` culls a generous 260 m ahead because it is a pure,
 * camera-independent function — but the projection is parallel, so a house
 * 260 m up the street is drawn at full size roughly 3400 px off the right
 * edge. Two thirds of the sorted list is therefore invisible, and a house is
 * now some thirty filled paths rather than one box. Skipping those here costs
 * one multiply per entity and changes nothing about ordering: it removes
 * entities from the frame, never reorders the ones that remain.
 *
 * X only, deliberately. Distance ahead moves an entity right AND up together
 * in this projection, so the horizontal test already catches everything the
 * vertical one would, and lateral spans at most 10 m (130 px) in total.
 */
function offScreenX(
  d: DrawCtx, width: number,
  distance: number, lateral: number, halfSpanM: number,
): boolean {
  const x = d.cfg.originX
    + (lateral - (d.camera.distance - distance)) * (d.cfg.tileW / 2);
  const reach = halfSpanM * (d.cfg.tileW / 2) + CULL_MARGIN_PX;
  return x + reach < 0 || x - reach > width;
}

function drawSky(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(1, PALETTE.skyHorizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function drawStreet(d: DrawCtx, w: WorldState): void {
  const from = w.rider.distance - 80;
  const to = w.rider.distance + 280;
  groundQuad(d, from, 1.5, to, 3.0, PALETTE.lawn);
  groundQuad(d, from, 3.0, to, 4.5, PALETTE.sidewalk);
  groundQuad(d, from, 4.5, to, 5.5, PALETTE.curb);
  groundQuad(d, from, 5.5, to, 10.0, PALETTE.road);

  // Centre line, dashed by construction rather than by setLineDash.
  for (let s = Math.floor(from / 8) * 8; s < to; s += 8) {
    groundQuad(d, s, 7.6, s + 4, 7.9, PALETTE.roadLine);
  }
}

/**
 * The porch-light pass. Additive warm pools on the ground for every lit
 * subscriber house, painted after the street and BEFORE the sorted entity
 * loop — a pool drawn later would paint over whatever was standing in it.
 * It is deliberately not part of the depth-sorted list: it is light on the
 * ground plane, not an object with a footprint.
 */
function drawPorchGlow(d: DrawCtx, w: WorldState, width: number): void {
  const lo = w.rider.distance - GLOW_BEHIND_M;
  const hi = w.rider.distance + GLOW_AHEAD_M;
  for (const house of w.houses) {
    if (!houseIsLit(house)) continue;
    const dist = house.spec.distance;
    if (dist <= lo || dist >= hi) continue;
    if (offScreenX(d, width, dist, 2.5, HOUSE_HALF_SPAN_M)) continue;
    drawHouseGlow(d, house);
  }
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  width: number,
  height: number,
): void {
  drawSky(ctx, width, height);

  const camera: Camera = { distance: w.rider.distance };
  const cfg: IsoConfig = {
    ...DEFAULT_ISO,
    originX: width * 0.34,
    originY: height * 0.62,
  };
  const d: DrawCtx = { ctx, camera, cfg };

  drawStreet(d, w);
  drawPorchGlow(d, w, width);

  for (const item of collectDrawables(w)) {
    switch (item.kind) {
      case 'house':
        if (offScreenX(d, width, item.house.spec.distance, 0.75, HOUSE_HALF_SPAN_M)) break;
        drawHouse(d, item.house);
        break;
      case 'hazard':
        if (offScreenX(d, width, item.hazard.distance, item.hazard.lateral, 2.5)) break;
        drawHazard(d, item.hazard, w.elapsed);
        break;
      case 'stack':
        if (offScreenX(d, width, item.stack.spec.distance, item.stack.spec.lateral, 1)) break;
        drawStack(d, item.stack);
        break;
      case 'paper':
        if (offScreenX(d, width, item.paper.distance, item.paper.lateral, 1)) break;
        drawPaper(d, item.paper);
        break;
      case 'rider':
        drawRider(d, w);
        break;
    }
  }
}
