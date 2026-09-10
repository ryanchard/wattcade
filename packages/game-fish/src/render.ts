/**
 * Fish, drawn.
 *
 * The entire game is one question — is that thing bigger than me? — so the
 * picture answers it twice over. Silhouettes are bold and unfussy so lengths
 * compare at a glance, and every fish is coloured by whether it is currently
 * food or currently death. That colouring is computed against the player's
 * size on every frame, which means the sea visibly changes allegiance as you
 * grow: the shape that was a dark predator two minutes ago is now glowing
 * green and swimming toward its mistake.
 *
 * Everything in here is decoration. The rules live in `session.ts`.
 */
import { mulberry32 } from '@paperboy/game-core';
import type { Rng } from '@paperboy/game-core';
import { TANK_DEPTH_M, fishDepth, isEdible } from './session.js';
import type { Fish, FishSession } from './session.js';

const WATER_TOP = '#3fbcd0';
const WATER_MID = '#12657f';
const WATER_DEEP = '#05203a';
const SEABED = '#04162a';

const PLAYER_BODY = '#ff9d4d';
const PLAYER_FIN = '#e8722a';
const PREY_BODY = '#8ff0c4';
const PREY_FIN = '#4fc79a';
const PREDATOR_BODY = '#0d1c33';
const PREDATOR_FIN = '#081527';
const PREDATOR_EDGE = '#e0503f';
const EYE_WHITE = '#f6f3e6';
const EYE_DARK = '#0b1622';
const BIOLUM = 'rgba(140, 240, 255, 0.75)';

const PLAYER_X_FRACTION = 0.3;

/** Light from above: shafts that drift rather than scroll with the world. */
const SHAFTS = 6;

export interface Bubble {
  x: number;
  y: number;
  r: number;
  rise: number;
  life: number;
}

export interface Mote {
  /** Fraction of the width and height; drifts, wraps, never scrolls exactly
   * with the world so the water has depth to it. */
  fx: number;
  fy: number;
  r: number;
  phase: number;
}

export interface RenderState {
  readonly rng: Rng;
  clock: number;
  bubbles: Bubble[];
  motes: Mote[];
  sinceBubble: number;
  /** Slow scroll of the deep-water speckle, for a sense of travel. */
  drift: number;
}

export function createRenderState(): RenderState {
  // Seeded, not Math.random: nothing in this project rolls dice it cannot
  // reproduce, even for bubbles.
  const rng = mulberry32(0x9e3779b9);
  const motes: Mote[] = [];
  for (let i = 0; i < 40; i++) {
    motes.push({ fx: rng(), fy: rng(), r: 0.6 + rng() * 2.2, phase: rng() * 7 });
  }
  return { rng, clock: 0, bubbles: [], motes, sinceBubble: 0, drift: 0 };
}

export function updateRenderState(
  r: RenderState, speed: number, dt: number,
): void {
  r.clock += dt;
  r.drift += speed * 6 * dt;

  // A small trail of bubbles from the player's mouth. More when swimming hard.
  r.sinceBubble += dt;
  const interval = 0.24 / Math.max(0.4, speed / 4);
  if (r.sinceBubble >= interval) {
    r.sinceBubble = 0;
    r.bubbles.push({
      x: (r.rng() - 0.5) * 14,
      y: 0,
      r: 1.4 + r.rng() * 3,
      rise: 26 + r.rng() * 34,
      life: 1,
    });
  }

  for (const b of r.bubbles) {
    b.y -= b.rise * dt;
    b.x += Math.sin(r.clock * 3 + b.r) * 8 * dt;
    b.life -= dt * 0.55;
  }
  if (r.bubbles.some((b) => b.life <= 0)) {
    r.bubbles = r.bubbles.filter((b) => b.life > 0);
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  s: FishSession,
  r: RenderState,
  width: number,
  height: number,
): void {
  const scale = height / TANK_DEPTH_M;
  const playerX = width * PLAYER_X_FRACTION;
  const sx = (worldX: number): number => playerX + (worldX - s.distance) * scale;
  const sy = (depth: number): number => depth * scale;

  drawWater(ctx, width, height);
  drawShafts(ctx, r, width, height);
  drawMotes(ctx, r, width, height);
  drawSeabed(ctx, r, width, height, scale);

  // Big fish behind small ones, so nothing important is ever hidden by
  // something unimportant.
  const ordered = [...s.fish].sort((a, b) => b.size - a.size);
  for (const f of ordered) {
    const x = sx(f.x);
    const reach = f.size * scale * 2.4;
    if (x < -reach || x > width + reach) continue;
    drawFish(ctx, f, x, sy(fishDepth(f, s.elapsed)), scale, s.size, r);
  }

  drawBubbles(ctx, r, playerX, sy(s.depth), s.size * scale);
  drawPlayer(ctx, playerX, sy(s.depth), s.size * scale, r);
}

function drawWater(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, WATER_TOP);
  g.addColorStop(0.42, WATER_MID);
  g.addColorStop(1, WATER_DEEP);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

/** Shafts of light coming down from the surface. Slow, wide, low contrast:
 * they must give the water a top without competing with a silhouette. */
function drawShafts(
  ctx: CanvasRenderingContext2D, r: RenderState, width: number, height: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < SHAFTS; i++) {
    const sway = Math.sin(r.clock * 0.22 + i * 1.9) * width * 0.03;
    const topX = ((i + 0.5) / SHAFTS) * width + sway;
    const w = width * 0.05;
    const g = ctx.createLinearGradient(topX, 0, topX - width * 0.1, height);
    g.addColorStop(0, 'rgba(190, 250, 255, 0.22)');
    g.addColorStop(0.6, 'rgba(150, 230, 255, 0.06)');
    g.addColorStop(1, 'rgba(150, 230, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(topX - w, 0);
    ctx.lineTo(topX + w, 0);
    ctx.lineTo(topX - width * 0.1 + w * 2.6, height);
    ctx.lineTo(topX - width * 0.1 - w * 2.6, height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Bioluminescent specks, brightest where the water is darkest. */
function drawMotes(
  ctx: CanvasRenderingContext2D, r: RenderState, width: number, height: number,
): void {
  ctx.save();
  for (const m of r.motes) {
    const x = (m.fx * width - (r.drift * (0.3 + m.r * 0.2))) % width;
    const y = m.fy * height;
    const depthFraction = m.fy;
    const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(r.clock * 1.7 + m.phase));
    ctx.globalAlpha = depthFraction * twinkle * 0.85;
    ctx.fillStyle = BIOLUM;
    ctx.beginPath();
    ctx.arc(x < 0 ? x + width : x, y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSeabed(
  ctx: CanvasRenderingContext2D, r: RenderState,
  width: number, height: number, scale: number,
): void {
  const bedY = height - scale * 1.4;
  ctx.fillStyle = SEABED;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, bedY);
  const step = 90;
  for (let x = 0; x <= width + step; x += step) {
    const h = Math.sin((x + r.drift * 0.4) * 0.01) * scale * 0.8;
    ctx.lineTo(x, bedY + h);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
}

/**
 * One fish. Prey glow; predators are dark with a red edge and a face doing
 * altogether too much. The difference is deliberately loud — this is the
 * gameplay read and it is not the place for subtlety.
 */
function drawFish(
  ctx: CanvasRenderingContext2D, f: Fish, x: number, y: number,
  scale: number, playerSize: number, r: RenderState,
): void {
  const food = isEdible(playerSize, f.size);
  const len = f.size * scale;
  const facing = f.vx <= 0 ? -1 : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  if (food) {
    // Prey are lit from within, so they read as "go and get it" at a glance.
    ctx.shadowColor = 'rgba(143, 240, 196, 0.55)';
    ctx.shadowBlur = Math.min(30, len * 0.5);
  }

  const body = food ? PREY_BODY : PREDATOR_BODY;
  const fin = food ? PREY_FIN : PREDATOR_FIN;
  const tailSwish = Math.sin(r.clock * (food ? 7 : 3.4) + f.bobPhase) * 0.22;

  // Tail, behind.
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(-len * 0.8, 0);
  ctx.lineTo(-len * 1.35, -len * (0.5 + tailSwish));
  ctx.lineTo(-len * 1.35, len * (0.5 - tailSwish));
  ctx.closePath();
  ctx.fill();

  // Dorsal fin.
  ctx.beginPath();
  ctx.moveTo(-len * 0.35, -len * 0.4);
  ctx.lineTo(0, -len * 0.85);
  ctx.lineTo(len * 0.3, -len * 0.36);
  ctx.closePath();
  ctx.fill();

  // Body.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, len, len * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (!food) {
    ctx.strokeStyle = PREDATOR_EDGE;
    ctx.lineWidth = Math.max(1.5, len * 0.05);
    ctx.stroke();
  }

  // The face. Everything gets an eye; the dangerous ones get a whole mood.
  const eyeX = len * 0.52;
  const eyeR = Math.max(1.6, len * (food ? 0.11 : 0.15));
  ctx.fillStyle = EYE_WHITE;
  ctx.beginPath();
  ctx.arc(eyeX, -len * 0.14, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = food ? EYE_DARK : PREDATOR_EDGE;
  ctx.beginPath();
  ctx.arc(eyeX + eyeR * 0.25, -len * 0.14, eyeR * 0.52, 0, Math.PI * 2);
  ctx.fill();

  if (food) {
    // A small, oblivious mouth.
    ctx.strokeStyle = EYE_DARK;
    ctx.lineWidth = Math.max(1, len * 0.05);
    ctx.beginPath();
    ctx.arc(len * 0.86, len * 0.06, len * 0.14, -0.9, 0.9);
    ctx.stroke();
  } else {
    // A grin, with teeth, and an eyebrow doing the heavy lifting.
    ctx.strokeStyle = PREDATOR_EDGE;
    ctx.lineWidth = Math.max(1.6, len * 0.06);
    ctx.beginPath();
    ctx.moveTo(eyeX - eyeR * 1.5, -len * 0.34);
    ctx.lineTo(eyeX + eyeR * 1.1, -len * 0.24);
    ctx.stroke();

    ctx.fillStyle = EYE_WHITE;
    const teeth = 5;
    for (let i = 0; i < teeth; i++) {
      const t = i / teeth;
      const tx = len * (0.28 + t * 0.62);
      const th = len * 0.16;
      ctx.beginPath();
      ctx.moveTo(tx, len * 0.12);
      ctx.lineTo(tx + len * 0.09, len * 0.12);
      ctx.lineTo(tx + len * 0.045, len * 0.12 + th);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = EYE_WHITE;
    ctx.lineWidth = Math.max(1.4, len * 0.05);
    ctx.beginPath();
    ctx.moveTo(len * 0.22, len * 0.12);
    ctx.lineTo(len * 0.96, len * 0.02);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBubbles(
  ctx: CanvasRenderingContext2D, r: RenderState, x: number, y: number, len: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(230, 250, 255, 0.7)';
  ctx.lineWidth = 1.2;
  for (const b of r.bubbles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, b.life)) * 0.8;
    ctx.beginPath();
    ctx.arc(x + len * 0.9 + b.x, y + b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** You. Warm, and the only warm thing down here, so you are never in doubt
 * about which fish you are. */
function drawPlayer(
  ctx: CanvasRenderingContext2D, x: number, y: number, len: number, r: RenderState,
): void {
  const swish = Math.sin(r.clock * 9) * 0.24;

  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(255, 157, 77, 0.5)';
  ctx.shadowBlur = Math.min(34, len * 0.55);

  ctx.fillStyle = PLAYER_FIN;
  ctx.beginPath();
  ctx.moveTo(-len * 0.8, 0);
  ctx.lineTo(-len * 1.4, -len * (0.55 + swish));
  ctx.lineTo(-len * 1.4, len * (0.55 - swish));
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-len * 0.4, -len * 0.42);
  ctx.lineTo(0, len * -0.95);
  ctx.lineTo(len * 0.32, -len * 0.38);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PLAYER_BODY;
  ctx.beginPath();
  ctx.ellipse(0, 0, len, len * 0.54, 0, 0, Math.PI * 2);
  ctx.fill();

  // A side stripe, so the length is easy to read against another fish.
  ctx.fillStyle = PLAYER_FIN;
  ctx.beginPath();
  ctx.ellipse(-len * 0.1, len * 0.06, len * 0.6, len * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = EYE_WHITE;
  ctx.beginPath();
  ctx.arc(len * 0.55, -len * 0.15, Math.max(1.8, len * 0.13), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = EYE_DARK;
  ctx.beginPath();
  ctx.arc(len * 0.6, -len * 0.15, Math.max(1, len * 0.07), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
