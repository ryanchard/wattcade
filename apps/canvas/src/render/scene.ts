import { DEFAULT_ISO, worldToScreen } from '../iso.js';
import type { Camera, IsoConfig } from '../iso.js';
import type { WorldState } from '../world.js';
import { collectDrawables } from './drawables.js';
import { PALETTE } from './palette.js';
import { box, groundQuad, shadow } from './primitives.js';
import type { DrawCtx } from './primitives.js';

const HOUSE_WIDTH = 1.4;
const HOUSE_DEPTH = 9;
const HOUSE_HEIGHT = 3.2;

/** Stable per-entity colour choice, so a house does not shimmer between frames. */
function hashPick<T>(id: string, items: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return items[h % items.length]!;
}

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * amount);
  const g = clamp(((n >> 8) & 255) * amount);
  const b = clamp((n & 255) * amount);
  return `rgb(${r}, ${g}, ${b})`;
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

function drawHouse(d: DrawCtx, house: WorldState['houses'][number]): void {
  const wall = hashPick(house.spec.id, PALETTE.houseWall);
  const roof = hashPick(`${house.spec.id}r`, PALETTE.houseRoof);
  const lit = house.spec.subscriber && !house.windowBroken;

  box(d, {
    distance: house.spec.distance,
    lateral: 0.75,
    depth: HOUSE_DEPTH,
    width: HOUSE_WIDTH,
    height: HOUSE_HEIGHT,
    top: roof,
    left: shade(wall, lit ? 1.0 : 0.62),
    right: shade(wall, lit ? 0.86 : 0.5),
  });

  // Window: lit and warm for a subscriber, dark once smashed.
  const wx = worldToScreen(
    house.spec.distance - 2.2, house.spec.windowLateral, 1.8,
    d.camera, d.cfg,
  );
  d.ctx.fillStyle = house.windowBroken
    ? '#1a1c26'
    : lit ? PALETTE.subscriberGlow : '#3a4055';
  d.ctx.fillRect(wx.x - 5, wx.y - 7, 10, 12);

  // Mailbox at the kerbside edge of the lawn.
  box(d, {
    distance: house.spec.distance,
    lateral: house.spec.mailboxLateral,
    depth: 0.35,
    width: 0.35,
    height: house.delivered ? 0.7 : 1.0,
    top: house.spec.subscriber
      ? PALETTE.mailboxSubscriber
      : PALETTE.mailboxPlain,
    left: shade(house.spec.subscriber ? '#4f9dd6' : '#6b6b6b', 0.7),
    right: shade(house.spec.subscriber ? '#4f9dd6' : '#6b6b6b', 0.55),
  });
}

function drawRider(d: DrawCtx, w: WorldState): void {
  const blink =
    w.elapsed < w.rider.invulnerableUntil &&
    Math.floor(w.elapsed * 12) % 2 === 0;
  if (blink) return;

  shadow(d, w.rider.distance, w.rider.lateral, 1.0);
  box(d, {
    distance: w.rider.distance,
    lateral: w.rider.lateral,
    depth: 1.5,
    width: 0.6,
    height: 1.7,
    top: PALETTE.riderAccent,
    left: PALETTE.rider,
    right: shade('#e5533d', 0.75),
  });
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

  for (const item of collectDrawables(w)) {
    switch (item.kind) {
      case 'house':
        drawHouse(d, item.house);
        break;
      case 'hazard': {
        const colour = PALETTE.hazard[item.hazard.spec.kind] ?? '#999';
        shadow(d, item.hazard.distance, item.hazard.lateral, item.hazard.spec.width);
        box(d, {
          distance: item.hazard.distance,
          lateral: item.hazard.lateral,
          depth: item.hazard.spec.kind === 'car' ? 4 : 1,
          width: item.hazard.spec.width,
          height: item.hazard.spec.kind === 'drain' ? 0.1 : 1.2,
          top: colour,
          left: shade(colour, 0.72),
          right: shade(colour, 0.56),
        });
        break;
      }
      case 'stack':
        box(d, {
          distance: item.stack.spec.distance,
          lateral: item.stack.spec.lateral,
          depth: 0.6, width: 0.6, height: 0.4,
          top: PALETTE.paper,
          left: shade('#f2ead9', 0.8),
          right: shade('#f2ead9', 0.65),
        });
        break;
      case 'paper':
        shadow(d, item.paper.distance, item.paper.lateral, 0.35);
        box(d, {
          distance: item.paper.distance,
          lateral: item.paper.lateral,
          depth: 0.3, width: 0.3, height: 0.18,
          base: item.paper.height,
          top: PALETTE.paper,
          left: shade('#f2ead9', 0.82),
          right: shade('#f2ead9', 0.68),
        });
        break;
      case 'rider':
        drawRider(d, w);
        break;
    }
  }
}
