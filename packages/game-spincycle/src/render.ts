/**
 * Spin Cycle, drawn.
 *
 * Silhouette first. A rider breathing hard has to read, in one glance, where
 * the hole is and whether they are above or below it — so obstacles are flat
 * ink shapes against a big pale sky, and the machine is the only warm thing
 * in the picture. Everything decorative (cloud drift, propeller spin, the
 * wobble of a startled bird) is driven from `animate` and never touches the
 * simulation.
 *
 * One scale is used for both axes, so nothing is stretched and a gap that
 * looks tall enough is tall enough.
 */
import {
  CRAFT_HALF_H_M, CRAFT_HALF_W_M, SKY_HEIGHT_M,
} from './session.js';
import type { Obstacle, SpinSession } from './session.js';

const SKY_TOP = '#7fbde3';
const SKY_MID = '#bcdff2';
const SKY_HAZE = '#f7ecd6';
const GROUND_FAR = '#a9c087';
const GROUND_NEAR = '#78975b';
const HEDGE = '#5c7a45';
const INK = '#3a2f29';
const INK_SOFT = 'rgba(58, 47, 41, 0.45)';
const BRASS = '#c98a3c';
const CANVAS_CLOTH = '#f6ecd6';
const BUNTING_FLAGS = ['#d2543f', '#e8b34a', '#4f8fb0', '#f6ecd6'] as const;
const BALLOON_RED = '#c2503d';

/** The machine sits here across the screen, leaving most of it as warning. */
const CRAFT_X_FRACTION = 0.28;
/** Top of the flyable sky, and the ground line, as fractions of the stage. */
const SKY_TOP_FRACTION = 0.06;
const GROUND_FRACTION = 0.88;

/** Cloud drift in px per (m/s of forward speed), per layer. */
const CLOUD_SPEED = [0.5, 1.6, 4.2] as const;
const CLOUD_PERIOD = [520, 340, 230] as const;
const CLOUD_ALPHA = [0.35, 0.55, 0.85] as const;
const CLOUD_Y = [0.16, 0.3, 0.5] as const;
const CLOUD_SCALE = [0.7, 1, 1.5] as const;

/** Hedgerows underfoot, the fastest layer of all. */
const FIELD_SPEED = 9;
const FIELD_PERIOD = 190;

/**
 * The scene's colours, grouped and exported so the game's poster is drawn
 * from the same decisions the scene is, and re-grades with it.
 */
export const POSTER_SKY = { top: SKY_TOP, mid: SKY_MID, haze: SKY_HAZE } as const;

export const POSTER_INK = {
  groundFar: GROUND_FAR,
  groundNear: GROUND_NEAR,
  hedge: HEDGE,
  ink: INK,
  inkSoft: INK_SOFT,
  brass: BRASS,
  canvas: CANVAS_CLOTH,
  bunting: BUNTING_FLAGS,
  balloon: BALLOON_RED,
} as const;

export interface RenderState {
  clouds: [number, number, number];
  fields: number;
  /** Propeller angle, radians. Spins with cadence, because it is your legs. */
  propeller: number;
  /** Seconds of wall time, for things that breathe rather than scroll. */
  clock: number;
}

export function createRenderState(): RenderState {
  return { clouds: [0, 0, 0], fields: 0, propeller: 0, clock: 0 };
}

export function updateRenderState(
  r: RenderState, speed: number, rpm: number | null, dt: number,
): void {
  for (let i = 0; i < 3; i++) {
    r.clouds[i] = (r.clouds[i] ?? 0) + speed * (CLOUD_SPEED[i] ?? 1) * dt;
  }
  r.fields += speed * FIELD_SPEED * dt;
  // A visible propeller tied to real rpm is the cheapest possible readout of
  // the control axis: the rider sees their own legs on the screen.
  r.propeller += ((rpm ?? 0) / 60) * Math.PI * 2 * dt;
  r.clock += dt;
}

interface View {
  readonly scale: number;
  readonly craftX: number;
  readonly groundY: number;
  readonly originX: number;
}

function view(s: SpinSession, width: number, height: number): View {
  const skyTopY = height * SKY_TOP_FRACTION;
  const groundY = height * GROUND_FRACTION;
  const scale = Math.max(1, (groundY - skyTopY) / SKY_HEIGHT_M);
  const craftX = width * CRAFT_X_FRACTION;
  return { scale, craftX, groundY, originX: craftX - s.distance * scale };
}

const sx = (v: View, worldX: number): number => v.originX + worldX * v.scale;
const sy = (v: View, altitude: number): number => v.groundY - altitude * v.scale;

export function renderScene(
  ctx: CanvasRenderingContext2D,
  s: SpinSession,
  r: RenderState,
  width: number,
  height: number,
): void {
  const v = view(s, width, height);

  drawSky(ctx, width, v.groundY);
  for (let i = 0; i < 3; i++) drawCloudLayer(ctx, r, i, width, height);
  drawGround(ctx, r, width, height, v.groundY);

  for (const o of s.obstacles) {
    const x = sx(v, o.x);
    if (x < -220 || x > width + 220) continue;
    drawObstacle(ctx, o, v, r);
  }

  drawCraft(ctx, v.craftX, sy(v, s.altitude), v.scale, s.vertical, r);
}

function drawSky(ctx: CanvasRenderingContext2D, width: number, groundY: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, groundY);
  g.addColorStop(0, SKY_TOP);
  g.addColorStop(0.55, SKY_MID);
  g.addColorStop(1, SKY_HAZE);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, groundY);
}

/** Three layers of soft cumulus. Parallax IS the sense of speed here — the
 * sky has nothing else in it to move. */
function drawCloudLayer(
  ctx: CanvasRenderingContext2D, r: RenderState, layer: number,
  width: number, height: number,
): void {
  const period = CLOUD_PERIOD[layer] ?? 300;
  const offset = (r.clouds[layer] ?? 0) % period;
  const y = height * (CLOUD_Y[layer] ?? 0.3);
  const scale = CLOUD_SCALE[layer] ?? 1;

  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${CLOUD_ALPHA[layer] ?? 0.5})`;
  for (let x = -offset - period; x < width + period; x += period) {
    // Two clouds per period, offset from each other, so the repeat is not
    // a metronome.
    puff(ctx, x + period * 0.2, y, 42 * scale);
    puff(ctx, x + period * 0.68, y + 46 * scale, 27 * scale);
  }
  ctx.restore();
}

function puff(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.52, 0, 0, Math.PI * 2);
  ctx.ellipse(x + r * 0.62, y - r * 0.2, r * 0.66, r * 0.46, 0, 0, Math.PI * 2);
  ctx.ellipse(x - r * 0.6, y + r * 0.08, r * 0.55, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawGround(
  ctx: CanvasRenderingContext2D, r: RenderState,
  width: number, height: number, groundY: number,
): void {
  const g = ctx.createLinearGradient(0, groundY, 0, height);
  g.addColorStop(0, GROUND_FAR);
  g.addColorStop(1, GROUND_NEAR);
  ctx.fillStyle = g;
  ctx.fillRect(0, groundY, width, Math.max(1, height - groundY));

  const offset = r.fields % FIELD_PERIOD;
  ctx.strokeStyle = HEDGE;
  ctx.lineWidth = 3;
  for (let x = -offset; x < width + FIELD_PERIOD; x += FIELD_PERIOD) {
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x - 40, height);
    ctx.stroke();
  }
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();
}

function drawObstacle(
  ctx: CanvasRenderingContext2D, o: Obstacle, v: View, r: RenderState,
): void {
  switch (o.kind) {
    case 'spire': return drawSpire(ctx, o, v);
    case 'bunting': return drawBunting(ctx, o, v);
    case 'birds': return drawBirds(ctx, o, v, r);
    case 'balloon': return drawBalloon(ctx, o, v, r);
  }
}

/** A church, with the spire doing the work. The block below it is solid too,
 * and drawn solid, so the picture and the collision box agree. */
function drawSpire(ctx: CanvasRenderingContext2D, o: Obstacle, v: View): void {
  const span = o.spans[0];
  if (span === undefined) return;
  const x = sx(v, o.x);
  const halfW = o.halfW * v.scale;
  const topY = sy(v, span.hi);
  const baseY = sy(v, span.lo);
  const towerTop = topY + (baseY - topY) * 0.42;

  ctx.fillStyle = INK;
  ctx.fillRect(x - halfW, towerTop, halfW * 2, baseY - towerTop);
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x + halfW, towerTop);
  ctx.lineTo(x - halfW, towerTop);
  ctx.closePath();
  ctx.fill();

  // A clock face, because it is that kind of church.
  ctx.fillStyle = CANVAS_CLOTH;
  ctx.beginPath();
  ctx.arc(x, towerTop + halfW * 0.9, halfW * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/** Bunting, hung from poles that leave the top of the picture. Fly under it. */
function drawBunting(ctx: CanvasRenderingContext2D, o: Obstacle, v: View): void {
  const span = o.spans[0];
  if (span === undefined) return;
  const x = sx(v, o.x);
  const halfW = o.halfW * v.scale;
  const swagY = sy(v, span.lo);
  const topY = sy(v, span.hi);

  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, halfW * 0.14);
  ctx.beginPath();
  ctx.moveTo(x - halfW, topY);
  ctx.lineTo(x - halfW, swagY - halfW * 0.5);
  ctx.moveTo(x + halfW, topY);
  ctx.lineTo(x + halfW, swagY - halfW * 0.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - halfW, swagY - halfW * 0.5);
  ctx.quadraticCurveTo(x, swagY + halfW * 0.25, x + halfW, swagY - halfW * 0.5);
  ctx.stroke();

  const flags = 7;
  for (let i = 0; i < flags; i++) {
    const t = (i + 0.5) / flags;
    const fx = x - halfW + t * halfW * 2;
    const sag = Math.sin(t * Math.PI) * halfW * 0.6;
    const fy = swagY - halfW * 0.5 + sag;
    ctx.fillStyle = BUNTING_FLAGS[i % BUNTING_FLAGS.length] ?? CANVAS_CLOTH;
    ctx.beginPath();
    ctx.moveTo(fx - halfW * 0.11, fy);
    ctx.lineTo(fx + halfW * 0.11, fy);
    ctx.lineTo(fx, fy + halfW * 0.34);
    ctx.closePath();
    ctx.fill();
  }
}

/** A flock, startled. Drawn as one solid mass of ink birds so the band you
 * must not enter reads as a band, not as gaps between individuals. */
function drawBirds(
  ctx: CanvasRenderingContext2D, o: Obstacle, v: View, r: RenderState,
): void {
  const span = o.spans[0];
  if (span === undefined) return;
  const left = sx(v, o.x - o.halfW);
  const right = sx(v, o.x + o.halfW);
  const top = sy(v, span.hi);
  const bottom = sy(v, span.lo);
  const rows = 3;
  const cols = 5;

  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const jitter = Math.sin(o.flourish * 40 + row * 3 + col) * 0.18;
      const bx = left + ((col + 0.5) / cols) * (right - left);
      const by = top + ((row + 0.5 + jitter) / rows) * (bottom - top);
      const w = (right - left) / cols * 0.42;
      const flap = Math.sin(r.clock * 9 + row * 1.7 + col * 0.9) * 0.4;
      ctx.lineWidth = Math.max(2, w * 0.22);
      ctx.beginPath();
      ctx.moveTo(bx - w, by + w * flap);
      ctx.quadraticCurveTo(bx, by - w * 0.7, bx, by);
      ctx.quadraticCurveTo(bx, by - w * 0.7, bx + w, by + w * flap);
      ctx.stroke();
    }
  }
}

function drawBalloon(
  ctx: CanvasRenderingContext2D, o: Obstacle, v: View, r: RenderState,
): void {
  const span = o.spans[0];
  if (span === undefined) return;
  const x = sx(v, o.x);
  const top = sy(v, span.hi);
  const bottom = sy(v, span.lo);
  const cy = (top + bottom) / 2;
  const ry = (bottom - top) / 2;
  const rx = o.halfW * v.scale;

  ctx.save();
  ctx.translate(x, cy + Math.sin(r.clock * 1.1 + o.flourish * 6) * ry * 0.05);

  ctx.fillStyle = CANVAS_CLOTH;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();

  // Vertical gores in red, clipped to the envelope.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = BALLOON_RED;
  for (let i = -2; i <= 2; i += 2) {
    ctx.fillRect(i * rx * 0.34 - rx * 0.11, -ry, rx * 0.22, ry * 2);
  }
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry * 0.82, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Basket, hanging inside the collision box rather than below it.
  const basketY = ry * 0.82;
  ctx.beginPath();
  ctx.moveTo(-rx * 0.4, basketY - ry * 0.06);
  ctx.lineTo(-rx * 0.22, basketY + ry * 0.14);
  ctx.moveTo(rx * 0.4, basketY - ry * 0.06);
  ctx.lineTo(rx * 0.22, basketY + ry * 0.14);
  ctx.stroke();
  ctx.fillStyle = BRASS;
  ctx.fillRect(-rx * 0.24, basketY + ry * 0.12, rx * 0.48, ry * 0.16);
  ctx.restore();
}

/**
 * The machine: brass, canvas and optimism. It pitches with its climb rate,
 * which is a second readout of the control axis — nose up means climbing,
 * and the rider learns that without being told.
 */
function drawCraft(
  ctx: CanvasRenderingContext2D, x: number, y: number, scale: number,
  vertical: number, r: RenderState,
): void {
  const halfW = CRAFT_HALF_W_M * scale;
  const halfH = CRAFT_HALF_H_M * scale;
  const pitch = Math.max(-0.42, Math.min(0.42, vertical / 44));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-pitch);

  // Upper wing, a long thin plank of canvas.
  ctx.fillStyle = CANVAS_CLOTH;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, halfH * 0.14);
  ctx.beginPath();
  ctx.ellipse(0, -halfH * 0.72, halfW, halfH * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Struts between wing and hull.
  ctx.beginPath();
  ctx.moveTo(-halfW * 0.55, -halfH * 0.6);
  ctx.lineTo(-halfW * 0.4, halfH * 0.1);
  ctx.moveTo(halfW * 0.55, -halfH * 0.6);
  ctx.lineTo(halfW * 0.4, halfH * 0.1);
  ctx.stroke();

  // Hull: a bathtub of varnished wood.
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.ellipse(0, halfH * 0.2, halfW * 0.62, halfH * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Tailplane.
  ctx.fillStyle = CANVAS_CLOTH;
  ctx.beginPath();
  ctx.moveTo(-halfW * 0.55, halfH * 0.15);
  ctx.lineTo(-halfW * 1.02, -halfH * 0.5);
  ctx.lineTo(-halfW * 0.72, halfH * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // The pilot, pedalling.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(halfW * 0.05, -halfH * 0.18, halfH * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // The propeller, out in front, spinning at your actual cadence.
  const px = halfW * 0.72;
  ctx.save();
  ctx.translate(px, halfH * 0.12);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, halfH * 0.16);
  const blades = 2;
  for (let i = 0; i < blades; i++) {
    const a = r.propeller + (i * Math.PI) / blades;
    // Foreshortened to a spinning ellipse rather than a wheel of sticks.
    const ry = Math.cos(a) * halfH * 0.95;
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.lineTo(0, ry);
    ctx.stroke();
  }
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, halfH * 0.16), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
