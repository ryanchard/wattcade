import { worldToScreen } from '../iso.js';
import type { Camera, IsoConfig } from '../iso.js';

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  cfg: IsoConfig;
}

const p = (d: DrawCtx, distance: number, lateral: number, height = 0) =>
  worldToScreen(distance, lateral, height, d.camera, d.cfg);

export function groundQuad(
  d: DrawCtx, d0: number, l0: number, d1: number, l1: number, fill: string,
): void {
  const { ctx } = d;
  const a = p(d, d0, l0);
  const b = p(d, d1, l0);
  const c = p(d, d1, l1);
  const e = p(d, d0, l1);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(e.x, e.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export interface BoxSpec {
  distance: number;
  lateral: number;
  depth: number;
  width: number;
  height: number;
  base?: number;
  top: string;
  left: string;
  right: string;
}

/**
 * An isometric box. In this projection the faces nearest the viewer are the
 * one at greater lateral and the one at lesser distance, so only those two
 * plus the top are drawn.
 */
export function box(d: DrawCtx, spec: BoxSpec): void {
  const { ctx } = d;
  const base = spec.base ?? 0;
  const dLo = spec.distance - spec.depth / 2;
  const dHi = spec.distance + spec.depth / 2;
  const lLo = spec.lateral - spec.width / 2;
  const lHi = spec.lateral + spec.width / 2;
  const hTop = base + spec.height;

  const face = (pts: Array<{ x: number; y: number }>, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const pt of pts.slice(1)) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Face at greater lateral (toward the road).
  face(
    [
      p(d, dLo, lHi, base), p(d, dHi, lHi, base),
      p(d, dHi, lHi, hTop), p(d, dLo, lHi, hTop),
    ],
    spec.right,
  );

  // Face at lesser distance (toward the rider).
  face(
    [
      p(d, dLo, lLo, base), p(d, dLo, lHi, base),
      p(d, dLo, lHi, hTop), p(d, dLo, lLo, hTop),
    ],
    spec.left,
  );

  face(
    [
      p(d, dLo, lLo, hTop), p(d, dHi, lLo, hTop),
      p(d, dHi, lHi, hTop), p(d, dLo, lHi, hTop),
    ],
    spec.top,
  );
}

export function shadow(
  d: DrawCtx, distance: number, lateral: number, radius: number,
): void {
  const { ctx, cfg } = d;
  const c = p(d, distance, lateral, 0);
  ctx.beginPath();
  ctx.ellipse(
    c.x, c.y, radius * cfg.tileW * 0.5, radius * cfg.tileH * 0.5, 0, 0, Math.PI * 2,
  );
  ctx.fillStyle = 'rgba(10, 12, 24, 0.35)';
  ctx.fill();
}
