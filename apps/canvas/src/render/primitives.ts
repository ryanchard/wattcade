import { worldToScreen } from '../iso.js';
import type { Camera, IsoConfig } from '../iso.js';
import { GLOW_STOPS } from './palette.js';

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  cfg: IsoConfig;
}

const TAU = Math.PI * 2;

const p = (d: DrawCtx, distance: number, lateral: number, height = 0) =>
  worldToScreen(distance, lateral, height, d.camera, d.cfg);

/**
 * `worldToScreen` inlined, x only. Used by the path builders below, which run
 * thousands of times per frame; going through `worldToScreen` there would
 * allocate a ScreenPoint object per vertex.
 */
function px(d: DrawCtx, distance: number, lateral: number): number {
  return d.cfg.originX
    + (lateral - (d.camera.distance - distance)) * (d.cfg.tileW / 2);
}

function py(d: DrawCtx, distance: number, lateral: number, height: number): number {
  return d.cfg.originY
    + (lateral + (d.camera.distance - distance)) * (d.cfg.tileH / 2)
    - height * d.cfg.heightScale;
}

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

/**
 * Fills an arbitrary flat-shaded face given in WORLD space. `pts` is a flat
 * run of `distance, lateral, height` triples — flat rather than an array of
 * points so a face costs one array literal per call instead of one object per
 * vertex. Vertices must be coplanar and wound consistently; nothing here
 * back-face culls, so callers decide which faces are visible.
 */
export function polygon(
  d: DrawCtx, pts: readonly number[], fill: string,
): void {
  const { ctx } = d;
  if (pts.length < 9) return;
  ctx.beginPath();
  ctx.moveTo(px(d, pts[0]!, pts[1]!), py(d, pts[0]!, pts[1]!, pts[2]!));
  for (let i = 3; i + 2 < pts.length; i += 3) {
    ctx.lineTo(px(d, pts[i]!, pts[i + 1]!), py(d, pts[i]!, pts[i + 1]!, pts[i + 2]!));
  }
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
  const base = spec.base ?? 0;
  const dLo = spec.distance - spec.depth / 2;
  const dHi = spec.distance + spec.depth / 2;
  const lLo = spec.lateral - spec.width / 2;
  const lHi = spec.lateral + spec.width / 2;
  const hTop = base + spec.height;

  // Face at greater lateral (toward the road).
  polygon(d, [
    dLo, lHi, base, dHi, lHi, base, dHi, lHi, hTop, dLo, lHi, hTop,
  ], spec.right);

  // Face at lesser distance (toward the rider).
  polygon(d, [
    dLo, lLo, base, dLo, lHi, base, dLo, lHi, hTop, dLo, lLo, hTop,
  ], spec.left);

  polygon(d, [
    dLo, lLo, hTop, dHi, lLo, hTop, dHi, lHi, hTop, dLo, lHi, hTop,
  ], spec.top);
}

export interface PrismSpec {
  distance: number;
  lateral: number;
  /** Footprint along the street, including any eave overhang. */
  depth: number;
  /** Footprint across the street, including any eave overhang. */
  width: number;
  /** Height of the eave line above the ground. */
  base: number;
  /** Height of the ridge above the eave line. */
  rise: number;
  /**
   * Which way the ridge line runs. `'distance'` is a side gable — the ridge
   * runs along the street and the gable triangle faces the oncoming rider.
   * `'lateral'` is a front gable — the ridge runs back from the street and
   * the triangle faces the road.
   */
  axis: 'distance' | 'lateral';
  slope: string;
  gable: string;
}

/**
 * A triangular prism: the pitched roof primitive. A prism is convex, so its
 * projection is tiled exactly by its front-facing faces — in this projection
 * that is one sloping plane plus one gable triangle, and the two never
 * overlap, so draw order between them does not matter.
 */
export function prism(d: DrawCtx, s: PrismSpec): void {
  const dLo = s.distance - s.depth / 2;
  const dHi = s.distance + s.depth / 2;
  const lLo = s.lateral - s.width / 2;
  const lHi = s.lateral + s.width / 2;
  const top = s.base + s.rise;

  if (s.axis === 'distance') {
    // Ridge runs along the street at the mid-lateral line.
    polygon(d, [
      dLo, s.lateral, top, dHi, s.lateral, top,
      dHi, lHi, s.base, dLo, lHi, s.base,
    ], s.slope);
    polygon(d, [
      dLo, lLo, s.base, dLo, s.lateral, top, dLo, lHi, s.base,
    ], s.gable);
    return;
  }

  // Ridge runs across the street at the mid-distance line.
  polygon(d, [
    dLo, lLo, s.base, dLo, lHi, s.base,
    s.distance, lHi, top, s.distance, lLo, top,
  ], s.slope);
  polygon(d, [
    dLo, lHi, s.base, s.distance, lHi, top, dHi, lHi, s.base,
  ], s.gable);
}

/**
 * Runs `draw` in a space where the unit circle at the origin projects to the
 * world-space ellipse spanned by the two radius vectors. Everything circular
 * in the scene — wheels, glow pools, a dog's shoulder — is one of these, and
 * doing it with a transform rather than a polygon approximation keeps the
 * curve smooth and costs one path.
 */
function inEllipseSpace(
  d: DrawCtx,
  cx: number, cy: number,
  ax: number, ay: number,
  bx: number, by: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const { ctx } = d;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.transform(ax, ay, bx, by, 0, 0);
  draw(ctx);
  ctx.restore();
}

/**
 * A filled ellipse lying flat on the ground, with radii given in metres along
 * the street (`rd`) and across it (`rl`).
 */
export function groundEllipse(
  d: DrawCtx,
  distance: number, lateral: number,
  rd: number, rl: number,
  fill: string,
): void {
  const hw = d.cfg.tileW / 2;
  const hh = d.cfg.tileH / 2;
  inEllipseSpace(
    d,
    px(d, distance, lateral), py(d, distance, lateral, 0),
    rd * hw, -rd * hh, rl * hw, rl * hh,
    (ctx) => {
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
    },
  );
}

/**
 * A filled ellipse standing upright in the plane that contains the street
 * axis and the vertical — the plane a bike wheel or a car wheel lives in.
 */
export function uprightEllipse(
  d: DrawCtx,
  distance: number, lateral: number, height: number,
  rd: number, rh: number,
  fill: string,
): void {
  const hw = d.cfg.tileW / 2;
  const hh = d.cfg.tileH / 2;
  inEllipseSpace(
    d,
    px(d, distance, lateral), py(d, distance, lateral, height),
    rd * hw, -rd * hh, 0, -rh * d.cfg.heightScale,
    (ctx) => {
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
    },
  );
}

export interface WheelSpec {
  distance: number;
  lateral: number;
  /** Height of the hub above the ground; also the wheel's radius. */
  radius: number;
  /** Rotation in radians. Derive it from distance travelled, never a clock. */
  angle: number;
  tyre: string;
  rim: string;
  hub: string;
}

/**
 * A rolling wheel: tyre, one spoke bar that turns with `angle`, and a hub.
 * The spoke bar is what makes motion legible — a plain disc rolling is
 * indistinguishable from a disc sliding.
 */
export function wheel(d: DrawCtx, s: WheelSpec): void {
  const hw = d.cfg.tileW / 2;
  const hh = d.cfg.tileH / 2;
  const r = s.radius;
  inEllipseSpace(
    d,
    px(d, s.distance, s.lateral), py(d, s.distance, s.lateral, r),
    r * hw, -r * hh, 0, -r * d.cfg.heightScale,
    (ctx) => {
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fillStyle = s.tyre;
      ctx.fill();

      ctx.rotate(s.angle);
      ctx.fillStyle = s.rim;
      ctx.fillRect(-0.86, -0.1, 1.72, 0.2);
      ctx.fillRect(-0.1, -0.86, 0.2, 1.72);

      ctx.beginPath();
      ctx.arc(0, 0, 0.22, 0, TAU);
      ctx.fillStyle = s.hub;
      ctx.fill();
    },
  );
}

// The warm-glow gradient is defined once in a unit space and reused for every
// pool and halo in the frame: canvas gradients are resolved against the CTM at
// paint time, so the same object stretches to fit whatever ellipse space it is
// filled in. Rebuilt only if the canvas context itself is replaced.
let glowCtx: CanvasRenderingContext2D | null = null;
let glowGradient: CanvasGradient | null = null;

function warmGlow(ctx: CanvasRenderingContext2D): CanvasGradient {
  if (glowCtx !== ctx || glowGradient === null) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [offset, colour] of GLOW_STOPS) g.addColorStop(offset, colour);
    glowCtx = ctx;
    glowGradient = g;
  }
  return glowGradient;
}

/**
 * The warm pool a porch light throws onto its lawn: an additive radial
 * falloff on the ground plane. Must be painted after the street and before
 * any entity, or it washes over whatever is standing in it.
 */
export function groundGlow(
  d: DrawCtx,
  distance: number, lateral: number,
  rd: number, rl: number,
  intensity: number,
): void {
  const { ctx } = d;
  const hw = d.cfg.tileW / 2;
  const hh = d.cfg.tileH / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = intensity;
  inEllipseSpace(
    d,
    px(d, distance, lateral), py(d, distance, lateral, 0),
    rd * hw, -rd * hh, rl * hw, rl * hh,
    (c) => {
      c.beginPath();
      c.arc(0, 0, 1, 0, TAU);
      c.fillStyle = warmGlow(c);
      c.fill();
    },
  );
  ctx.restore();
}

/**
 * A small additive halo in screen space around a point light — a porch lamp,
 * a headlight. Radius is in pixels because the projection is parallel: a lamp
 * 100 m up the street is drawn at exactly the same size as one beside you.
 */
export function pointGlow(
  d: DrawCtx,
  distance: number, lateral: number, height: number,
  radiusPx: number,
  intensity: number,
): void {
  const { ctx } = d;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = intensity;
  inEllipseSpace(
    d,
    px(d, distance, lateral), py(d, distance, lateral, height),
    radiusPx, 0, 0, radiusPx,
    (c) => {
      c.beginPath();
      c.arc(0, 0, 1, 0, TAU);
      c.fillStyle = warmGlow(c);
      c.fill();
    },
  );
  ctx.restore();
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
