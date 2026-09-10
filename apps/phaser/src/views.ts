import type Phaser from 'phaser';
import type { HazardSpec, HouseSpec } from '@paperboy/game-core';
import { PHASER_ISO } from './iso.js';

export const COLOURS = {
  road: 0x33384a,
  roadLine: 0x6d7490,
  sidewalk: 0xb9b2a6,
  lawn: 0x5f7a5a,
  curb: 0x8d8779,
  paper: 0xf2ead9,
  rider: 0xe5533d,
  subscriberGlow: 0xffd98a,
  mailboxSubscriber: 0x4f9dd6,
  mailboxPlain: 0x6b6b6b,
  wallWarm: 0xc47a4e,
  wallCool: 0x7d6b53,
  roof: 0x4a3b33,
  car: 0xc9d1e8,
  dog: 0x8a6b4a,
  sprinkler: 0x7fc4d6,
  lawnmower: 0x7ba05b,
  drain: 0x2a2e3d,
  bin: 0x4c5a4a,
  skater: 0xd98d3f,
  water: 0xbfe6f2,
  waterDim: 0x7fa9bd,
} as const;

const shade = (colour: number, amount: number): number => {
  const r = Math.round(((colour >> 16) & 255) * amount);
  const g = Math.round(((colour >> 8) & 255) * amount);
  const b = Math.round((colour & 255) * amount);
  return (r << 16) | (g << 8) | b;
};

/**
 * An isometric box drawn into a Graphics, centred on the container origin.
 * Unlike Version A this is drawn ONCE at creation and then only moved, which
 * is the whole reason Version B uses containers rather than immediate mode.
 */
function box(
  g: Phaser.GameObjects.Graphics,
  depthM: number, widthM: number, heightM: number, colour: number,
): void {
  const { tileW, tileH, heightScale } = PHASER_ISO;
  const dx = (depthM * tileW) / 2;
  const dy = (depthM * tileH) / 2;
  const lx = (widthM * tileW) / 2;
  const ly = (widthM * tileH) / 2;
  const h = heightM * heightScale;

  // Face toward the road.
  g.fillStyle(shade(colour, 0.72));
  g.fillPoints(
    [
      { x: -dx + lx, y: dy + ly }, { x: dx + lx, y: -dy + ly },
      { x: dx + lx, y: -dy + ly - h }, { x: -dx + lx, y: dy + ly - h },
    ] as Phaser.Types.Math.Vector2Like[],
    true,
  );

  // Face toward the rider.
  g.fillStyle(shade(colour, 0.56));
  g.fillPoints(
    [
      { x: -dx - lx, y: dy - ly }, { x: -dx + lx, y: dy + ly },
      { x: -dx + lx, y: dy + ly - h }, { x: -dx - lx, y: dy - ly - h },
    ] as Phaser.Types.Math.Vector2Like[],
    true,
  );

  // Top.
  g.fillStyle(colour);
  g.fillPoints(
    [
      { x: -dx - lx, y: dy - ly - h }, { x: dx - lx, y: -dy - ly - h },
      { x: dx + lx, y: -dy + ly - h }, { x: -dx + lx, y: dy + ly - h },
    ] as Phaser.Types.Math.Vector2Like[],
    true,
  );
}

/**
 * Local pixel offset for a point `depthOffsetM` along the street and
 * `lateralOffsetM` across it (both metres, relative to the container's own
 * origin) and `heightM` above the ground — the same isometric skew `box()`
 * above uses for its corners, factored out so other local geometry (the
 * sprinkler spray below) can be placed in the same frame without going
 * through a full box.
 */
function isoLocalPoint(
  depthOffsetM: number, lateralOffsetM: number, heightM: number,
): { x: number; y: number } {
  const { tileW, tileH, heightScale } = PHASER_ISO;
  return {
    x: tileW * (depthOffsetM + lateralOffsetM),
    y: tileH * (lateralOffsetM - depthOffsetM) - heightM * heightScale,
  };
}

/**
 * The sprinkler's danger signal: two fans of droplets arcing up and out to
 * each side of the head. Drawn into its own Graphics so `StreetScene` can
 * toggle it visible/hidden per frame against `isHazardActive` without
 * touching the always-on base box drawn by `drawHazardView` — an inactive
 * sprinkler must read as obviously safe, an active one as obviously
 * dangerous, and the toggle is what keeps that promise in sync with
 * collision.
 */
export function drawSprinklerSprayView(g: Phaser.GameObjects.Graphics): void {
  const dropletsPerArc = 5;
  for (const side of [-1, 1] as const) {
    const tint = side === -1 ? COLOURS.water : COLOURS.waterDim;
    for (let i = 1; i <= dropletsPerArc; i++) {
      const u = i / dropletsPerArc;
      const lateralOffsetM = side * 0.55 * u;
      const depthOffsetM = 0.12 * u;
      // Arcs up then back down, peaking around the midpoint of the reach.
      const heightM = 0.15 + 0.7 * u * (1 - u) * 4;
      const { x, y } = isoLocalPoint(depthOffsetM, lateralOffsetM, heightM);
      const radius = 3 * (1 - u) + 1.2;
      g.fillStyle(tint, 0.9);
      g.fillCircle(x, y, radius);
    }
  }
}

export function drawHouseView(
  g: Phaser.GameObjects.Graphics, spec: HouseSpec,
): void {
  box(g, 9, 1.4, 3.2, spec.subscriber ? COLOURS.wallWarm : COLOURS.wallCool);
  g.fillStyle(spec.subscriber ? COLOURS.subscriberGlow : 0x3a4055);
  g.fillRect(-8, -46, 12, 14);
}

export function drawHazardView(
  g: Phaser.GameObjects.Graphics, spec: HazardSpec,
): void {
  const colour = (COLOURS as Record<string, number>)[spec.kind] ?? 0x999999;
  box(
    g,
    spec.kind === 'car' ? 4 : 1,
    spec.width,
    spec.kind === 'drain' ? 0.1 : 1.2,
    colour,
  );
}

export function drawStackView(g: Phaser.GameObjects.Graphics): void {
  box(g, 0.6, 0.6, 0.4, COLOURS.paper);
}

export function drawRiderView(g: Phaser.GameObjects.Graphics): void {
  box(g, 1.5, 0.6, 1.7, COLOURS.rider);
}

export function drawPaperView(g: Phaser.GameObjects.Graphics): void {
  box(g, 0.3, 0.3, 0.18, COLOURS.paper);
}
