import { INK, KIT, PALETTE } from './palette.js';
import {
  LAP_LENGTH_M, RACE_DISTANCE_M, lapPhase,
} from './race.js';
import type { RaceState } from './race.js';

/**
 * The velodrome, side-on, riders travelling right.
 *
 * Two rules govern everything here.
 *
 * 1. THE GAP IS LITERAL SCREEN DISTANCE. The rival's position on screen is
 *    the gap, to scale. The picture IS the information; the number in the HUD
 *    is a courtesy.
 *
 * 2. THE WIND IS VISIBLE. Out in the wind the screen streams with air and the
 *    rider works visibly harder. In the shelter it goes quiet: clean boards,
 *    still air, a rider sitting up. That is the honest visual counterpart to
 *    the cw the app is sending the trainer at the same instant, so the
 *    picture, the physics and the legs all say the same thing.
 *
 * Everything else stays disciplined around those two.
 */

// --- camera ---------------------------------------------------------------

/** Pixels per metre when the riders are together. A rider is ~1.75 m long,
 * so this makes a bike about 52 px — big enough to read at a glance. */
export const PX_PER_M_MAX = 30;
/** Floor, so a rival a hundred metres up the road is still a shape and not a
 * single pixel. Below this the oval track map carries the information. */
export const PX_PER_M_MIN = 2.6;
/** The player sits here across the screen and stays there. A rider breathing
 * hard should not also be tracking their own avatar around the frame. */
export const PLAYER_ANCHOR = 0.40;
/** How much of the width the gap is allowed to fill before the view pulls
 * back. Zooming out is itself the message: they are gone. */
export const GAP_SCREEN_SHARE = 0.46;
/** Seconds for the zoom to settle, so the scale never pops. */
const SCALE_TAU_S = 0.7;

export function targetScale(gapM: number, width: number): number {
  const span = Math.max(1, Math.abs(gapM));
  return Math.min(PX_PER_M_MAX, Math.max(PX_PER_M_MIN, (GAP_SCREEN_SHARE * width) / span));
}

// --- streaming air --------------------------------------------------------

interface Streak {
  x: number;
  y: number;
  len: number;
  life: number;
  maxLife: number;
  vx: number;
}

export interface RenderState {
  scale: number;
  /** Board-seam scroll, in pixels, wrapped. */
  scroll: number;
  /** Wheel rotation, radians. */
  wheelPhase: number;
  /** Pedal stroke, radians. */
  crankPhase: number;
  streaks: Streak[];
  spawnCarry: number;
  /** Eased 0..1 "how hard this looks", drives the rider's posture. */
  strain: number;
  elapsed: number;
}

export function createRenderState(): RenderState {
  return {
    scale: PX_PER_M_MAX,
    scroll: 0,
    wheelPhase: 0,
    crankPhase: 0,
    streaks: [],
    spawnCarry: 0,
    strain: 0,
    elapsed: 0,
  };
}

/** Streaks per second at 1 m/s, out in the wind. */
const STREAK_RATE = 5.5;
const STREAK_LIFE_S = 0.9;
const WHEEL_RADIUS_M = 0.335;

export function updateRenderState(
  r: RenderState, s: RaceState, width: number, height: number, dt: number,
): void {
  r.elapsed += dt;

  const want = targetScale(s.gap, width);
  r.scale += (want - r.scale) * (1 - Math.exp(-dt / SCALE_TAU_S));

  const speed = s.player.speed;
  r.scroll = (r.scroll + speed * r.scale * dt) % 4096;
  r.wheelPhase = (r.wheelPhase + (speed / WHEEL_RADIUS_M) * dt) % (Math.PI * 2);
  // A track rider turns a big gear fast; tie the stroke to speed so the legs
  // and the boards agree with each other.
  r.crankPhase = (r.crankPhase + (speed * 0.62) * dt) % (Math.PI * 2);

  const effort = s.player.powerCurrent / Math.max(1, s.profile.ftpWatts);
  const wantStrain = s.player.drafting
    ? Math.min(1, effort * 0.35)
    : Math.min(1, 0.25 + effort * 0.6);
  r.strain += (wantStrain - r.strain) * (1 - Math.exp(-dt / 0.5));

  // Spawn only out in the wind. In the shelter the existing streaks live out
  // their second and the air simply goes still — no icon, no caption.
  if (!s.player.drafting && !s.paused && !s.finished) {
    r.spawnCarry += STREAK_RATE * speed * dt;
    while (r.spawnCarry >= 1) {
      r.spawnCarry -= 1;
      const bandTop = height * 0.42;
      const bandBottom = height * 0.86;
      const y = bandTop + Math.random() * (bandBottom - bandTop);
      r.streaks.push({
        x: width * (0.35 + Math.random() * 0.75),
        y,
        len: 40 + Math.random() * 190,
        life: 0,
        maxLife: STREAK_LIFE_S * (0.6 + Math.random() * 0.8),
        vx: -(speed * r.scale * (1.15 + Math.random() * 0.9)),
      });
    }
  } else {
    r.spawnCarry = 0;
  }

  for (let i = r.streaks.length - 1; i >= 0; i--) {
    const st = r.streaks[i]!;
    st.life += dt;
    st.x += st.vx * dt;
    if (st.life >= st.maxLife || st.x + st.len < -50) {
      r.streaks.splice(i, 1);
    }
  }
}

// --- the track ------------------------------------------------------------

/** Vertical layout of the bowl, as fractions of the canvas height. */
const L = {
  roof: 0.00,
  farTopMin: 0.22,   // far banking's outer edge at the ends of the oval
  farTopMax: 0.36,   // ...and directly across from the camera
  farHeight: 0.115,
  railTop: 0.485,    // top of the near banking (the rail)
  boardsTop: 0.505,
  stayers: 0.665,
  ridersY: 0.795,
  sprint: 0.822,
  measurement: 0.862,
  coteTop: 0.876,
  coteBottom: 0.916,
} as const;

function farTopAt(x: number, width: number, height: number): number {
  // Low in the middle (the far straight, directly across), rising at both
  // ends (the turns, curving away). This is what restores the oval to a
  // side-on view before the track map ever gets involved.
  const k = Math.abs(Math.cos((Math.PI * x) / Math.max(1, width)));
  return height * (L.farTopMax - (L.farTopMax - L.farTopMin) * k);
}

function drawRoof(
  c: CanvasRenderingContext2D, w: number, h: number, r: RenderState,
): void {
  // Dark arena above the bowl, with the overhead rigs burning into it.
  const sky = c.createLinearGradient(0, 0, 0, h * 0.4);
  sky.addColorStop(0, INK.arenaDeep);
  sky.addColorStop(1, PALETTE.arena);
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h * 0.45);

  // Trusses.
  c.strokeStyle = INK.rail;
  c.lineWidth = 2;
  for (let i = 0; i <= 6; i++) {
    const x = (w / 6) * i;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h * 0.13);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(0, h * 0.13);
  c.lineTo(w, h * 0.13);
  c.stroke();

  // The rigs, and the hard pools they throw down onto the boards.
  const rigs = 5;
  for (let i = 0; i < rigs; i++) {
    const x = (w / rigs) * (i + 0.5);
    const y = h * 0.135;
    c.fillStyle = PALETTE.light;
    c.globalAlpha = 0.9;
    c.beginPath();
    c.ellipse(x, y, w * 0.012, h * 0.008, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;

    const cone = c.createRadialGradient(x, y, 0, x, y, h * 0.55);
    cone.addColorStop(0, 'rgba(255, 244, 220, 0.13)');
    cone.addColorStop(0.55, 'rgba(255, 244, 220, 0.05)');
    cone.addColorStop(1, 'rgba(255, 244, 220, 0)');
    c.fillStyle = cone;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - w * 0.16, h);
    c.lineTo(x + w * 0.16, h);
    c.closePath();
    c.fill();
  }
  void r;
}

function drawFarSide(
  c: CanvasRenderingContext2D, w: number, h: number, r: RenderState,
): void {
  const steps = 48;
  const height = h * L.farHeight;

  c.beginPath();
  c.moveTo(0, farTopAt(0, w, h));
  for (let i = 1; i <= steps; i++) {
    const x = (w / steps) * i;
    c.lineTo(x, farTopAt(x, w, h));
  }
  for (let i = steps; i >= 0; i--) {
    const x = (w / steps) * i;
    c.lineTo(x, farTopAt(x, w, h) + height);
  }
  c.closePath();
  c.fillStyle = PALETTE.boardsShadow;
  c.fill();

  // Seams on the far side, scrolling the other way — that is the far
  // straight, and it is going past in the opposite direction.
  c.save();
  c.clip();
  c.strokeStyle = INK.seam;
  c.lineWidth = 1;
  const spacing = 26;
  const off = (-r.scroll * 0.35) % spacing;
  for (let x = off - spacing; x < w + spacing; x += spacing) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + 6, h);
    c.stroke();
  }
  c.restore();

  // The cote d'azur on the far side's inner edge, and the rail above it.
  c.lineWidth = Math.max(2, h * 0.006);
  c.strokeStyle = PALETTE.cote;
  c.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = (w / steps) * i;
    const y = farTopAt(x, w, h) + height;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();

  c.lineWidth = 2;
  c.strokeStyle = INK.rail;
  c.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = (w / steps) * i;
    const y = farTopAt(x, w, h) - 3;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
}

function drawNearTrack(
  c: CanvasRenderingContext2D, w: number, h: number,
  r: RenderState, s: RaceState,
): void {
  const top = h * L.boardsTop;
  const bottom = h * L.coteTop;

  // The boards. Warm honey where the rigs land, unlit between.
  const wood = c.createLinearGradient(0, top, 0, bottom);
  wood.addColorStop(0, PALETTE.boardsShadow);
  wood.addColorStop(0.35, PALETTE.boards);
  wood.addColorStop(1, PALETTE.boardsShadow);
  c.fillStyle = wood;
  c.fillRect(0, top, w, bottom - top);

  c.save();
  c.beginPath();
  c.rect(0, top, w, bottom - top);
  c.clip();

  // Board seams, fanning slightly with the banking so the surface reads as a
  // curved wall rather than a stripe.
  c.strokeStyle = INK.seam;
  c.lineWidth = 1.2;
  const spacing = 34;
  const off = (-r.scroll) % spacing;
  for (let x = off - spacing * 2; x < w + spacing * 2; x += spacing) {
    c.beginPath();
    c.moveTo(x, top);
    c.lineTo(x + 22, bottom);
    c.stroke();
  }

  // Pooled light, moving with the boards.
  for (let i = 0; i < 5; i++) {
    const px = ((w / 5) * (i + 0.5) - r.scroll * 0.15 + w * 3) % (w + 400) - 200;
    const pool = c.createRadialGradient(
      px, top + (bottom - top) * 0.45, 0,
      px, top + (bottom - top) * 0.45, w * 0.13,
    );
    pool.addColorStop(0, 'rgba(255, 244, 220, 0.16)');
    pool.addColorStop(1, 'rgba(255, 244, 220, 0)');
    c.fillStyle = pool;
    c.fillRect(px - w * 0.14, top, w * 0.28, bottom - top);
  }

  // The painted lines. A track has exactly these and no others.
  const line = (yf: number, colour: string, width: number): void => {
    c.strokeStyle = colour;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(0, h * yf);
    c.lineTo(w, h * yf);
    c.stroke();
  };
  line(L.stayers, INK.paint, Math.max(1.5, h * 0.0035));
  line(L.sprint, PALETTE.sprintLine, Math.max(2, h * 0.005));
  line(L.measurement, INK.measurement, Math.max(2, h * 0.0055));

  // The finish line, at its real place on the lap, sweeping past once every
  // 250 m. The lap counter turning over is not the only thing that says so.
  const anchor = w * PLAYER_ANCHOR;
  const phase = lapPhase(s.player.distance);
  const metresToLine = (1 - phase) * LAP_LENGTH_M;
  for (const d of [metresToLine - LAP_LENGTH_M, metresToLine]) {
    const x = anchor + d * r.scale;
    if (x < -60 || x > w + 60) continue;
    c.fillStyle = INK.paint;
    const lw = Math.max(3, r.scale * 0.35);
    c.fillRect(x, top, lw, bottom - top);
    // The chequer of the pursuit line.
    c.fillStyle = 'rgba(14, 20, 24, 0.75)';
    for (let k = 0; k < 10; k += 2) {
      const yy = top + ((bottom - top) / 10) * k;
      c.fillRect(x, yy, lw, (bottom - top) / 10);
    }
  }

  c.restore();

  // Rail at the top of the banking.
  c.fillStyle = INK.rail;
  c.fillRect(0, h * L.railTop, w, h * (L.boardsTop - L.railTop));

  // Cote d'azur, then the infield floor.
  c.fillStyle = PALETTE.cote;
  c.fillRect(0, h * L.coteTop, w, h * (L.coteBottom - L.coteTop));
  c.fillStyle = PALETTE.arena;
  c.fillRect(0, h * L.coteBottom, w, h * (1 - L.coteBottom) + 2);
}

// --- riders ---------------------------------------------------------------

interface Kit {
  body: string;
  accent: string;
}

/**
 * One rider, side-on, travelling right. `strain` is 0..1: at 0 they sit up
 * in the shelter and barely move; at 1 they are deep in the bars and rocking.
 */
function drawRider(
  c: CanvasRenderingContext2D,
  x: number, y: number, scale: number,
  kit: Kit, r: RenderState, strain: number, sheltered: boolean,
): void {
  const u = scale; // one metre
  const wheelR = WHEEL_RADIUS_M * u;
  if (wheelR < 1.2) {
    // Far enough away to be a mark on the boards rather than a bicycle.
    c.fillStyle = kit.accent;
    c.fillRect(x - 3, y - 8, 6, 8);
    return;
  }

  const rock = Math.sin(r.crankPhase * 2) * 0.035 * strain * u;
  const tuck = 0.10 * strain;

  c.save();
  c.translate(x, y);

  // Shadow on the boards.
  c.fillStyle = 'rgba(14, 20, 24, 0.28)';
  c.beginPath();
  c.ellipse(0, wheelR * 0.18, u * 0.95, u * 0.10, 0, 0, Math.PI * 2);
  c.fill();

  const rearX = -0.52 * u;
  const frontX = 0.52 * u;
  const hubY = -wheelR;

  // Wheels.
  c.lineWidth = Math.max(1, u * 0.035);
  for (const wx of [rearX, frontX]) {
    c.strokeStyle = KIT.frame;
    c.beginPath();
    c.arc(wx, hubY, wheelR, 0, Math.PI * 2);
    c.stroke();
    if (wheelR > 6) {
      c.strokeStyle = 'rgba(255, 244, 220, 0.22)';
      c.lineWidth = Math.max(0.6, u * 0.012);
      for (let i = 0; i < 4; i++) {
        const a = r.wheelPhase + (i * Math.PI) / 4;
        c.beginPath();
        c.moveTo(wx + Math.cos(a) * wheelR * 0.9, hubY + Math.sin(a) * wheelR * 0.9);
        c.lineTo(wx - Math.cos(a) * wheelR * 0.9, hubY - Math.sin(a) * wheelR * 0.9);
        c.stroke();
      }
      c.lineWidth = Math.max(1, u * 0.035);
    }
  }

  const bbX = -0.02 * u;
  const bbY = hubY + wheelR * 0.42;
  const saddleX = -0.30 * u;
  const saddleY = hubY - wheelR * 1.35 + rock;
  const barX = 0.36 * u;
  const barY = hubY - wheelR * 1.05 + tuck * u * 0.3;

  // Frame.
  c.strokeStyle = KIT.frame;
  c.lineWidth = Math.max(1.2, u * 0.045);
  c.beginPath();
  c.moveTo(rearX, hubY); c.lineTo(bbX, bbY);
  c.lineTo(saddleX, saddleY); c.lineTo(rearX, hubY);
  c.moveTo(saddleX, saddleY); c.lineTo(barX, barY);
  c.moveTo(bbX, bbY); c.lineTo(barX, barY);
  c.moveTo(barX, barY); c.lineTo(frontX, hubY);
  c.stroke();

  // Cranks and legs.
  const crank = wheelR * 0.5;
  for (const side of [0, Math.PI]) {
    const a = r.crankPhase + side;
    const px = bbX + Math.cos(a) * crank;
    const py = bbY + Math.sin(a) * crank;
    const hipX = saddleX + 0.05 * u;
    const hipY = saddleY - 0.02 * u;
    const kneeX = (hipX + px) / 2 + 0.16 * u;
    const kneeY = (hipY + py) / 2 - 0.02 * u;
    c.strokeStyle = side === 0 ? kit.body : kit.accent;
    c.lineWidth = Math.max(1.4, u * 0.075);
    c.beginPath();
    c.moveTo(hipX, hipY);
    c.quadraticCurveTo(kneeX, kneeY, px, py);
    c.stroke();
  }

  // Torso — the posture is the effort. Sheltered riders sit up.
  const shoulderX = barX - 0.14 * u;
  const shoulderY = barY - (0.42 - tuck) * u + rock * 0.6;
  c.strokeStyle = kit.body;
  c.lineWidth = Math.max(2, u * 0.16);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(saddleX + 0.03 * u, saddleY - 0.05 * u);
  c.lineTo(shoulderX, shoulderY);
  c.stroke();

  // Arms.
  c.strokeStyle = kit.accent;
  c.lineWidth = Math.max(1.2, u * 0.06);
  c.beginPath();
  c.moveTo(shoulderX, shoulderY);
  c.lineTo(barX, barY);
  c.stroke();

  // Head, in a helmet.
  c.fillStyle = kit.accent;
  c.beginPath();
  c.ellipse(
    shoulderX + 0.14 * u, shoulderY - 0.10 * u,
    0.15 * u, 0.11 * u, -0.25, 0, Math.PI * 2,
  );
  c.fill();

  // In the shelter, a faint pocket of still air sits on the rider. It is not
  // a badge — it is the absence of everything else moving.
  if (sheltered && u > 8) {
    c.strokeStyle = 'rgba(255, 244, 220, 0.10)';
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(0, -wheelR * 1.1, u * 1.5, u * 0.95, 0, 0, Math.PI * 2);
    c.stroke();
  }

  c.lineCap = 'butt';
  c.restore();
}

// --- the scene ------------------------------------------------------------

export function renderScene(
  c: CanvasRenderingContext2D, s: RaceState, r: RenderState,
  w: number, h: number,
): void {
  c.fillStyle = PALETTE.arena;
  c.fillRect(0, 0, w, h);

  drawRoof(c, w, h, r);
  drawFarSide(c, w, h, r);
  drawNearTrack(c, w, h, r, s);

  const anchor = w * PLAYER_ANCHOR;
  const rivalX = anchor - s.gap * r.scale;
  const y = h * L.ridersY;

  // Air BEHIND the riders, so the rider is inside the weather rather than
  // pasted on top of it.
  drawStreaks(c, r, 0.55);

  // Rival first when it is behind, so the leader overlaps correctly.
  const rivalKit = { body: KIT.rivalBody, accent: KIT.rivalAccent };
  const playerKit = { body: KIT.playerBody, accent: KIT.playerAccent };
  const rivalStrain = s.rival.drafting ? 0.25 : 0.75;
  const clampedRivalX = Math.max(-w * 0.2, Math.min(w * 1.2, rivalX));

  if (rivalX < anchor) {
    drawRider(c, clampedRivalX, y, r.scale, rivalKit, r, rivalStrain, s.rival.drafting);
    drawRider(c, anchor, y, r.scale, playerKit, r, r.strain, s.player.drafting);
  } else {
    drawRider(c, anchor, y, r.scale, playerKit, r, r.strain, s.player.drafting);
    drawRider(c, clampedRivalX, y, r.scale, rivalKit, r, rivalStrain, s.rival.drafting);
  }

  drawStreaks(c, r, 1);

  // If the rival is off the edge of the world, say which edge.
  if (rivalX < -20 || rivalX > w + 20) {
    const right = rivalX > 0;
    const cx = right ? w - 26 : 26;
    c.fillStyle = KIT.rivalAccent;
    c.beginPath();
    c.moveTo(cx + (right ? 10 : -10), y - 24);
    c.lineTo(cx + (right ? -8 : 8), y - 40);
    c.lineTo(cx + (right ? -8 : 8), y - 8);
    c.closePath();
    c.fill();
  }

  drawVignette(c, w, h);
}

function drawStreaks(c: CanvasRenderingContext2D, r: RenderState, layer: number): void {
  c.save();
  c.lineCap = 'round';
  for (const st of r.streaks) {
    const k = st.life / st.maxLife;
    // Fade in fast, out slow — a gust arrives and trails away.
    const alpha = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * 0.40 * layer;
    if (alpha <= 0.01) continue;
    c.strokeStyle = `rgba(255, 244, 220, ${alpha.toFixed(3)})`;
    c.lineWidth = layer > 0.8 ? 1.6 : 1;
    c.beginPath();
    c.moveTo(st.x, st.y);
    c.lineTo(st.x + st.len * layer, st.y);
    c.stroke();
  }
  c.restore();
}

function drawVignette(c: CanvasRenderingContext2D, w: number, h: number): void {
  const v = c.createRadialGradient(
    w * 0.45, h * 0.62, h * 0.25, w * 0.45, h * 0.62, h * 1.1,
  );
  v.addColorStop(0, 'rgba(7, 11, 14, 0)');
  v.addColorStop(1, 'rgba(7, 11, 14, 0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
}

// --- the oval track map ---------------------------------------------------

/**
 * A stadium, not an ellipse: two straights and two true semicircles, which is
 * what a velodrome actually is. Returns a point at `phase` (0..1) round the
 * lap, travelling anticlockwise, the way track riders go.
 */
export function pointOnOval(
  phase: number, cx: number, cy: number, rx: number, ry: number,
): { x: number; y: number } {
  const r = ry;
  const straight = Math.max(0, 2 * (rx - ry));
  const arc = Math.PI * r;
  const perimeter = 2 * straight + 2 * arc;
  let d = ((phase % 1) + 1) % 1 * perimeter;

  // Bottom straight, left to right.
  if (d < straight) return { x: cx - straight / 2 + d, y: cy + r };
  d -= straight;
  // Right turn, sweeping up.
  if (d < arc) {
    const a = Math.PI / 2 - (d / arc) * Math.PI;
    return { x: cx + straight / 2 + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }
  d -= arc;
  // Top straight, right to left.
  if (d < straight) return { x: cx + straight / 2 - d, y: cy - r };
  d -= straight;
  // Left turn, sweeping down.
  const a = -Math.PI / 2 - (d / arc) * Math.PI;
  return { x: cx - straight / 2 + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

export function drawTrackMap(
  c: CanvasRenderingContext2D, s: RaceState, x: number, y: number, size: number,
): void {
  const rx = size / 2;
  const ry = size / 3.4;
  const cx = x + rx;
  const cy = y + ry;

  c.save();
  // The loop itself.
  c.strokeStyle = 'rgba(201, 154, 94, 0.35)';
  c.lineWidth = Math.max(5, size * 0.055);
  c.beginPath();
  for (let i = 0; i <= 96; i++) {
    const p = pointOnOval(i / 96, cx, cy, rx, ry);
    if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
  }
  c.closePath();
  c.stroke();

  // The cote d'azur, inside the loop.
  c.strokeStyle = 'rgba(46, 127, 168, 0.5)';
  c.lineWidth = 1.5;
  c.beginPath();
  for (let i = 0; i <= 96; i++) {
    const p = pointOnOval(i / 96, cx, cy, rx * 0.9, ry * 0.86);
    if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
  }
  c.closePath();
  c.stroke();

  // The finish line, at the end of the bottom straight.
  const fin = pointOnOval(0, cx, cy, rx, ry);
  c.strokeStyle = PALETTE.sprintLine;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(fin.x, fin.y - size * 0.035);
  c.lineTo(fin.x, fin.y + size * 0.035);
  c.stroke();

  const dot = (distance: number, colour: string, radius: number): void => {
    const p = pointOnOval(lapPhase(Math.min(distance, RACE_DISTANCE_M)), cx, cy, rx, ry);
    c.fillStyle = colour;
    c.beginPath();
    c.arc(p.x, p.y, radius, 0, Math.PI * 2);
    c.fill();
  };
  dot(s.rival.distance, KIT.rivalAccent, Math.max(3, size * 0.032));
  dot(s.player.distance, KIT.playerAccent, Math.max(3.5, size * 0.038));

  c.restore();
}
