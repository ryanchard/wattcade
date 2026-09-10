import { DISPLAY_FONT, INK, KIT, LABEL_FONT, PALETTE } from './palette.js';
import {
  LAP_LENGTH_M, RACE_DISTANCE_M, RACE_LAPS, lapNumber, lapPhase,
} from './race.js';
import type { RaceState } from './race.js';
import { drawTabular } from './text.js';

/**
 * The velodrome, side-on, riders travelling right.
 *
 * Three rules govern everything here.
 *
 * 1. THE GAP IS LITERAL SCREEN DISTANCE, and SPEED IS LITERAL SCREEN SPEED.
 *    The rival's position on screen is the gap, to scale, and the boards go
 *    past at a fixed number of pixels per metre RIDDEN — never at the
 *    camera's scale. Sixty km/h looks like sixty km/h whether the rival is on
 *    your wheel or a hundred metres up the road. When the rival runs out of
 *    frame the camera does NOT keep pulling back; they are pinned to the edge
 *    with a chevron and the metres beside it.
 *
 * 2. THE WIND IS VISIBLE. Out in the wind the screen streams with air and the
 *    rider works visibly harder. In the shelter it goes quiet: clean boards,
 *    still air, a rider sitting up. That is the honest visual counterpart to
 *    the cw the app is sending the trainer at the same instant, so the
 *    picture, the physics and the legs all say the same thing.
 *
 * 3. IT IS AN OVAL. The far banking bends away at both ends of the frame, the
 *    near banking rises into the turns with it, and both riders lean where
 *    the lap says they are in a bend. You are in a bowl, not beside a road.
 */

// --- camera ---------------------------------------------------------------

/** Pixels per metre when the riders are together. A rider is ~1.75 m long,
 * so this makes a bike about 52 px — big enough to read at a glance. */
export const PX_PER_M_MAX = 30;
/** The camera never pulls back further than two thirds of full scale. Past
 * that, zooming out costs the whole world its sense of speed and buys only a
 * smaller rival; the edge marker says "they are gone" for free. */
export const PX_PER_M_MIN = 20;
/** Riders inside this many metres of each other are shown at full scale: a
 * sprint's worth of racing happens here and it should never breathe. */
export const ZOOM_KNEE_M = 25;
/** The pull-back is complete by knee × this. Past it the scale is pinned. */
const ZOOM_RAMP_RATIO = 3.2;
/** How much of the width the gap may fill before the knee is brought in, so
 * a narrow canvas starts easing sooner than a wide one. */
export const GAP_SCREEN_SHARE = 0.46;
/** Seconds for the zoom to settle, so the scale never pops. */
const SCALE_TAU_S = 0.7;

/**
 * The ground and everything parallaxed off it scroll at THIS, always —
 * deliberately not at `scale`. Tying the world's speed to the camera made
 * riding well look slow, which is exactly backwards in a sprint game.
 */
export const SCROLL_PX_PER_M = PX_PER_M_MAX;

/**
 * Scroll wraps here. Chosen as a common multiple of every layer's period
 * (near seams 32, far seams 24 at half parallax, light pools 420 at 0.2), so
 * the wrap is invisible instead of a jump every few seconds.
 */
const SCROLL_WRAP = 16800;

/** The player sits here across the screen and stays there. A rider breathing
 * hard should not also be tracking their own avatar around the frame. */
export const PLAYER_ANCHOR = 0.40;

/**
 * Full scale until the riders are properly apart, then a small bounded ease
 * back to PX_PER_M_MIN and no further.
 */
export function targetScale(gapM: number, width: number): number {
  const span = Math.abs(gapM);
  const knee = Math.max(1, Math.min(ZOOM_KNEE_M, (GAP_SCREEN_SHARE * width) / PX_PER_M_MAX));
  // Written as a negated comparison so a NaN gap holds full scale.
  if (!(span > knee)) return PX_PER_M_MAX;
  const t = Math.min(1, (span - knee) / (knee * (ZOOM_RAMP_RATIO - 1)));
  const eased = t * t * (3 - 2 * t);
  return PX_PER_M_MAX + (PX_PER_M_MIN - PX_PER_M_MAX) * eased;
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

/** Gradients that depend only on the canvas size. Rebuilt when it changes,
 * never per frame and never per entity. */
interface Scenery {
  w: number;
  h: number;
  sky: CanvasGradient;
  cone: CanvasGradient;
  wood: CanvasGradient;
  pool: CanvasGradient;
  vignette: CanvasGradient;
}

export interface RenderState {
  scale: number;
  /** Board-seam scroll, in pixels of ground travelled, wrapped. */
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
  scenery: Scenery | null;
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
    scenery: null,
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
  // Metres ridden, at a fixed pixels-per-metre. Independent of the camera.
  r.scroll = (r.scroll + speed * SCROLL_PX_PER_M * dt) % SCROLL_WRAP;
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
      const bandTop = height * 0.40;
      const bandBottom = height * 0.88;
      const y = bandTop + Math.random() * (bandBottom - bandTop);
      r.streaks.push({
        x: width * (0.35 + Math.random() * 0.75),
        y,
        len: 40 + Math.random() * 190,
        life: 0,
        maxLife: STREAK_LIFE_S * (0.6 + Math.random() * 0.8),
        // Air moves with the ground, at the ground's fixed scale.
        vx: -(speed * SCROLL_PX_PER_M * (1.15 + Math.random() * 0.9)),
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

// --- the shape of the bowl ------------------------------------------------

/** Vertical layout of the bowl, as fractions of the canvas height. */
const L = {
  /** Far banking's outer rail at the ends of the oval (the turns)... */
  farTopMin: 0.165,
  /** ...and directly across from the camera (the far straight). */
  farTopMax: 0.375,
  /** The far banking's face: nearly edge-on across the straight, and much
   * deeper at the turns, where you are looking into the bowl. */
  farHeightMin: 0.095,
  farHeightMax: 0.205,
  railTop: 0.485,
  boardsTop: 0.505,
  stayers: 0.665,
  ridersY: 0.795,
  sprint: 0.822,
  measurement: 0.862,
  coteTop: 0.876,
  coteBottom: 0.916,
  /** How far the near track climbs as it turns away at the frame's ends. */
  nearLift: 0.055,
} as const;

/**
 * 0 in the middle of the frame, 1 at both ends: how far into a turn the track
 * is at this screen position. Raised to a power so the straights stay flat
 * and the bend happens where a bend happens — at the ends.
 */
function turnK(x: number, width: number): number {
  const c = Math.abs(Math.cos((Math.PI * x) / Math.max(1, width)));
  return c * c * Math.sqrt(c); // c^2.5, cheaper than Math.pow
}

/** The far banking's outer rail: low across the straight, climbing hard at
 * both ends where the oval turns away from the camera. */
export function farTopAt(x: number, width: number, height: number): number {
  const k = turnK(x, width);
  return height * (L.farTopMax - (L.farTopMax - L.farTopMin) * k);
}

/** The far banking's visible face. Deeper at the turns. */
function farHeightAt(x: number, width: number, height: number): number {
  const k = turnK(x, width);
  return height * (L.farHeightMin + (L.farHeightMax - L.farHeightMin) * k);
}

/** Where a point on the near banking sits. `t` runs 0 at the top of the
 * boards to 1 at the cote d'azur, and may run outside that for the rail
 * above and the apron below. The band lifts and narrows into the turns. */
function nearY(x: number, t: number, width: number, height: number): number {
  const base = height * (L.boardsTop + (L.coteTop - L.boardsTop) * t);
  return base - height * L.nearLift * turnK(x, width) * (0.3 + 0.7 * t);
}

/** Convert one of L's absolute height fractions to a near-band `t`. */
function tAt(fraction: number): number {
  return (fraction - L.boardsTop) / (L.coteTop - L.boardsTop);
}

const T_RAIL = tAt(L.railTop);
const T_STAYERS = tAt(L.stayers);
const T_RIDERS = tAt(L.ridersY);
const T_SPRINT = tAt(L.sprint);
const T_MEASUREMENT = tAt(L.measurement);
const T_APRON = tAt(L.coteBottom);

/** Steps across the frame for every curved edge. Enough to read as a curve,
 * few enough to be free. */
const CURVE_STEPS = 32;

function curve(
  c: CanvasRenderingContext2D, w: number,
  yAt: (x: number) => number, reverse = false,
): void {
  for (let i = 0; i <= CURVE_STEPS; i++) {
    const x = (w / CURVE_STEPS) * (reverse ? CURVE_STEPS - i : i);
    const y = yAt(x);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
}

/**
 * How hard a rider is leaning, -1..1, from where they are round the lap.
 * Zero on the two straights, full through the two bends — and opposite signs
 * in the two bends, because seen from the side the ends of an oval tip away
 * from each other. Pure, so the lean is the same every time you ride it.
 */
export function leanFor(phase: number): number {
  const s = Math.sin(2 * Math.PI * phase);
  return s * s * s;
}

/** Radians at full bend. Enough to read; not enough to look like a crash. */
const LEAN_MAX = 0.14;

// --- scenery --------------------------------------------------------------

/** Pools of overhead light on the boards, in screen pixels. */
const POOL_SPACING = 420;
const POOL_PARALLAX = 0.2;
const POOL_RADIUS = 260;
const NEAR_SEAM_PX = 32;
const FAR_SEAM_PX = 24;
const FAR_PARALLAX = 0.5;

function scenery(c: CanvasRenderingContext2D, r: RenderState, w: number, h: number): Scenery {
  const cached = r.scenery;
  if (cached !== null && cached.w === w && cached.h === h) return cached;

  const sky = c.createLinearGradient(0, 0, 0, h * 0.4);
  sky.addColorStop(0, INK.arenaDeep);
  sky.addColorStop(1, PALETTE.arena);

  // Built at the origin and moved into place with translate(), so five light
  // rigs and five light pools cost two gradients rather than ten a frame.
  const cone = c.createRadialGradient(0, 0, 0, 0, 0, h * 0.55);
  cone.addColorStop(0, 'rgba(255, 244, 220, 0.16)');
  cone.addColorStop(0.55, 'rgba(255, 244, 220, 0.055)');
  cone.addColorStop(1, 'rgba(255, 244, 220, 0)');

  const wood = c.createLinearGradient(0, h * (L.boardsTop - L.nearLift), 0, h * L.coteTop);
  wood.addColorStop(0, PALETTE.boardsShadow);
  wood.addColorStop(0.30, PALETTE.boards);
  wood.addColorStop(0.72, PALETTE.boards);
  wood.addColorStop(1, PALETTE.boardsShadow);

  const pool = c.createRadialGradient(0, 0, 0, 0, 0, POOL_RADIUS);
  pool.addColorStop(0, 'rgba(255, 244, 220, 0.20)');
  pool.addColorStop(0.6, 'rgba(255, 244, 220, 0.06)');
  pool.addColorStop(1, 'rgba(255, 244, 220, 0)');

  const vignette = c.createRadialGradient(
    w * 0.45, h * 0.62, h * 0.25, w * 0.45, h * 0.62, h * 1.1,
  );
  vignette.addColorStop(0, 'rgba(7, 11, 14, 0)');
  vignette.addColorStop(1, 'rgba(7, 11, 14, 0.55)');

  const built: Scenery = { w, h, sky, cone, wood, pool, vignette };
  r.scenery = built;
  return built;
}

function drawRoof(
  c: CanvasRenderingContext2D, w: number, h: number, sc: Scenery,
): void {
  // Dark arena above the bowl, with the overhead rigs burning into it.
  c.fillStyle = sc.sky;
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

    c.save();
    c.translate(x, y);
    c.fillStyle = sc.cone;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(-w * 0.16, h);
    c.lineTo(w * 0.16, h);
    c.closePath();
    c.fill();
    c.restore();
  }
}

function drawFarSide(
  c: CanvasRenderingContext2D, w: number, h: number, r: RenderState,
): void {
  const top = (x: number): number => farTopAt(x, w, h);
  const bottom = (x: number): number => farTopAt(x, w, h) + farHeightAt(x, w, h);

  c.beginPath();
  curve(c, w, top);
  curve(c, w, bottom, true);
  c.closePath();
  c.fillStyle = PALETTE.boardsShadow;
  c.fill();

  // Seams on the far side, scrolling the other way — that is the far
  // straight, and it is going past in the opposite direction.
  c.save();
  c.clip();
  c.strokeStyle = INK.seam;
  c.lineWidth = 1;
  const off = (r.scroll * FAR_PARALLAX) % FAR_SEAM_PX;
  for (let x = off - FAR_SEAM_PX; x < w + FAR_SEAM_PX; x += FAR_SEAM_PX) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + 6, h);
    c.stroke();
  }
  // The overhead rigs catch the far banking's face where it turns toward us.
  c.fillStyle = 'rgba(255, 244, 220, 0.05)';
  c.beginPath();
  curve(c, w, top);
  curve(c, w, (x) => top(x) + farHeightAt(x, w, h) * 0.45, true);
  c.closePath();
  c.fill();
  c.restore();

  // The cote d'azur on the far side's inner edge, and the rail above it.
  c.lineWidth = Math.max(2, h * 0.006);
  c.strokeStyle = PALETTE.cote;
  c.beginPath();
  curve(c, w, bottom);
  c.stroke();

  // The fence around the top of the banking. Its curve is the oval's
  // silhouette, so it is a band rather than a hairline.
  c.fillStyle = INK.rail;
  c.beginPath();
  curve(c, w, (x) => top(x) - h * 0.014);
  curve(c, w, (x) => top(x) - 1, true);
  c.closePath();
  c.fill();

  // A shadow under the far banking, so the bowl has a floor to sit in.
  c.fillStyle = 'rgba(7, 11, 14, 0.45)';
  c.beginPath();
  curve(c, w, bottom);
  curve(c, w, (x) => bottom(x) + h * 0.03, true);
  c.closePath();
  c.fill();
}

function drawNearTrack(
  c: CanvasRenderingContext2D, w: number, h: number,
  r: RenderState, s: RaceState, sc: Scenery,
): void {
  const at = (x: number, t: number): number => nearY(x, t, w, h);

  // The boards, curving up into the turn at both ends of the frame.
  c.beginPath();
  curve(c, w, (x) => at(x, 0));
  curve(c, w, (x) => at(x, 1), true);
  c.closePath();

  c.save();
  c.clip();
  c.fillStyle = sc.wood;
  c.fillRect(0, h * (L.boardsTop - L.nearLift) - 4, w, h * (L.coteTop - L.boardsTop + L.nearLift) + 8);

  // Board seams, fanning with the banking so the surface reads as a curved
  // wall rather than a stripe. These are what the speed is read from.
  c.strokeStyle = INK.seam;
  c.lineWidth = 1.2;
  const off = (-r.scroll) % NEAR_SEAM_PX;
  for (let x = off - NEAR_SEAM_PX * 2; x < w + NEAR_SEAM_PX * 2; x += NEAR_SEAM_PX) {
    c.beginPath();
    c.moveTo(x, at(x, 0));
    c.lineTo(x + 22, at(x + 22, 1));
    c.stroke();
  }

  // The planks themselves run the way the riders do, so they do not scroll.
  // Between them and the seams the boards read as timber.
  c.strokeStyle = 'rgba(78, 52, 26, 0.22)';
  c.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    c.beginPath();
    curve(c, w, (x) => at(x, i / 8));
    c.stroke();
  }

  // Pooled light, moving with the boards.
  c.fillStyle = sc.pool;
  const drift = (r.scroll * POOL_PARALLAX) % POOL_SPACING;
  for (let i = -1; i * POOL_SPACING - drift < w + POOL_SPACING; i++) {
    const px = i * POOL_SPACING - drift;
    c.save();
    c.translate(px, at(px, 0.45));
    c.fillRect(-POOL_RADIUS, -POOL_RADIUS, POOL_RADIUS * 2, POOL_RADIUS * 2);
    c.restore();
  }

  // The painted lines. A track has exactly these and no others.
  const line = (t: number, colour: string, width: number): void => {
    c.strokeStyle = colour;
    c.lineWidth = width;
    c.beginPath();
    curve(c, w, (x) => at(x, t));
    c.stroke();
  };
  line(T_STAYERS, INK.paint, Math.max(1.5, h * 0.0035));
  line(T_SPRINT, PALETTE.sprintLine, Math.max(2, h * 0.005));
  line(T_MEASUREMENT, INK.measurement, Math.max(2, h * 0.0055));

  // The finish line, at its real place on the lap, sweeping past once every
  // 250 m. The lap counter turning over is not the only thing that says so.
  const anchor = w * PLAYER_ANCHOR;
  const phase = lapPhase(s.player.distance);
  const metresToLine = (1 - phase) * LAP_LENGTH_M;
  for (const d of [metresToLine - LAP_LENGTH_M, metresToLine]) {
    const x = anchor + d * r.scale;
    if (x < -60 || x > w + 60) continue;
    const lw = Math.max(3, r.scale * 0.35);
    // Skewed with the boards, so it lies on the surface.
    const skew = 22;
    c.fillStyle = INK.paint;
    c.beginPath();
    c.moveTo(x, at(x, 0));
    c.lineTo(x + lw, at(x + lw, 0));
    c.lineTo(x + skew + lw, at(x + skew + lw, 1));
    c.lineTo(x + skew, at(x + skew, 1));
    c.closePath();
    c.fill();
    // The chequer of the pursuit line.
    c.fillStyle = 'rgba(14, 20, 24, 0.75)';
    for (let k = 0; k < 10; k += 2) {
      const t0 = k / 10;
      const t1 = (k + 1) / 10;
      const x0 = x + skew * t0;
      const x1 = x + skew * t1;
      c.beginPath();
      c.moveTo(x0, at(x0, t0));
      c.lineTo(x0 + lw, at(x0 + lw, t0));
      c.lineTo(x1 + lw, at(x1 + lw, t1));
      c.lineTo(x1, at(x1, t1));
      c.closePath();
      c.fill();
    }
  }

  c.restore();

  // Rail at the top of the banking, curving with it.
  c.fillStyle = INK.rail;
  c.beginPath();
  curve(c, w, (x) => at(x, T_RAIL));
  curve(c, w, (x) => at(x, 0) + 1, true);
  c.closePath();
  c.fill();

  // Cote d'azur, then the infield floor.
  c.fillStyle = PALETTE.cote;
  c.beginPath();
  curve(c, w, (x) => at(x, 1));
  curve(c, w, (x) => at(x, T_APRON), true);
  c.closePath();
  c.fill();

  c.fillStyle = PALETTE.arena;
  c.beginPath();
  curve(c, w, (x) => at(x, T_APRON) - 1);
  c.lineTo(w, h + 2);
  c.lineTo(0, h + 2);
  c.closePath();
  c.fill();
}

// --- riders ---------------------------------------------------------------

interface Kit {
  body: string;
  accent: string;
}

/**
 * One rider, side-on, travelling right. `strain` is 0..1: at 0 they sit up
 * in the shelter and barely move; at 1 they are deep in the bars and rocking.
 * `lean` is radians — they are in a bend, and the boards are holding them up.
 */
function drawRider(
  c: CanvasRenderingContext2D,
  x: number, y: number, scale: number,
  kit: Kit, r: RenderState, strain: number, sheltered: boolean, lean: number,
): void {
  const u = scale; // one metre
  const wheelR = WHEEL_RADIUS_M * u;

  // Shadow on the boards. Drawn before the lean, because the shadow stays
  // flat on the surface — it is what anchors the rider to the track.
  c.fillStyle = 'rgba(14, 20, 24, 0.34)';
  c.beginPath();
  c.ellipse(x + lean * u * 0.8, y + wheelR * 0.18, u * 1.0, u * 0.11, 0, 0, Math.PI * 2);
  c.fill();

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
  c.rotate(lean);

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
  const sc = scenery(c, r, w, h);

  c.fillStyle = PALETTE.arena;
  c.fillRect(0, 0, w, h);

  drawRoof(c, w, h, sc);
  drawFarSide(c, w, h, r);
  drawNearTrack(c, w, h, r, s, sc);

  const anchor = w * PLAYER_ANCHOR;
  const rivalX = anchor - s.gap * r.scale;

  // Air BEHIND the riders, so the rider is inside the weather rather than
  // pasted on top of it.
  drawStreaks(c, r, 0.55);

  // Rival first when it is behind, so the leader overlaps correctly.
  const rivalKit = { body: KIT.rivalBody, accent: KIT.rivalAccent };
  const playerKit = { body: KIT.playerBody, accent: KIT.playerAccent };
  const rivalStrain = s.rival.drafting ? 0.25 : 0.75;
  // Swap the rider for the edge marker just before they would be clipped.
  const margin = w * 0.045;
  const clampedRivalX = Math.max(margin, Math.min(w - margin, rivalX));
  const offFrame = rivalX < margin || rivalX > w - margin;

  const rider = (x: number, kit: Kit, strain: number, sheltered: boolean, distance: number): void => {
    drawRider(
      c, x, nearY(x, T_RIDERS, w, h), r.scale, kit, r, strain, sheltered,
      LEAN_MAX * leanFor(lapPhase(distance)),
    );
  };

  if (rivalX < anchor) {
    if (!offFrame) rider(clampedRivalX, rivalKit, rivalStrain, s.rival.drafting, s.rival.distance);
    rider(anchor, playerKit, r.strain, s.player.drafting, s.player.distance);
  } else {
    rider(anchor, playerKit, r.strain, s.player.drafting, s.player.distance);
    if (!offFrame) rider(clampedRivalX, rivalKit, rivalStrain, s.rival.drafting, s.rival.distance);
  }

  drawStreaks(c, r, 1);

  // Out of frame is not a reason to shrink the world. Pin them to the edge
  // and say, in metres, how far past it they are.
  if (offFrame) {
    drawEdgeMarker(c, s.gap, rivalX > anchor, w, nearY(clampedRivalX, T_RIDERS, w, h));
  }

  c.fillStyle = sc.vignette;
  c.fillRect(0, 0, w, h);
}

/**
 * The rival, off the edge of the world: a chevron pointing the way they went
 * and the gap in metres beside it, in their own colour.
 */
function drawEdgeMarker(
  c: CanvasRenderingContext2D, gapM: number, ahead: boolean, w: number, y: number,
): void {
  const dir = ahead ? 1 : -1;
  const edge = ahead ? w - 14 : 14;
  const unit = Math.max(14, w / 64);
  const top = y - unit * 2.6;

  c.save();
  // A slab of the arena behind it, so the number never fights the boards.
  c.fillStyle = 'rgba(7, 11, 14, 0.62)';
  c.fillRect(ahead ? w - unit * 5.6 : 0, top - unit * 1.5, unit * 5.6, unit * 3.4);

  c.fillStyle = KIT.rivalAccent;
  for (let i = 0; i < 2; i++) {
    const cx = edge - dir * i * unit * 0.62;
    c.beginPath();
    c.moveTo(cx, top);
    c.lineTo(cx - dir * unit * 0.5, top - unit * 0.62);
    c.lineTo(cx - dir * unit * 0.5, top + unit * 0.62);
    c.closePath();
    c.fill();
  }

  const metres = Math.round(Math.abs(gapM));
  c.fillStyle = INK.text;
  drawTabular(
    c, `${metres}`, ahead ? w - unit * 0.6 : unit * 0.6, top + unit * 1.75,
    `800 ${unit * 1.7}px ${DISPLAY_FONT}`, ahead ? 'right' : 'left',
  );
  c.restore();
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

function ovalPath(
  c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number,
): void {
  c.beginPath();
  for (let i = 0; i <= 72; i++) {
    const p = pointOnOval(i / 72, cx, cy, rx, ry);
    if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
  }
  c.closePath();
}

/**
 * The loop, and the lap, as one instrument. The oval is the shape of the
 * place — two straights, two turns — with both riders on it as dots and the
 * lap count sitting in the infield where there is nothing else to look at.
 * Sized to be read at a glance by somebody breathing hard.
 */
export function drawTrackMap(
  c: CanvasRenderingContext2D, s: RaceState, x: number, y: number, size: number,
): void {
  const rx = size / 2;
  const ry = size / 3.1;
  const cx = x + rx;
  const cy = y + ry;
  const band = Math.max(8, size * 0.075);

  c.save();

  // The banking: a board-coloured band with a dark core, so it reads as a
  // track and not as a line drawing.
  c.lineCap = 'butt';
  c.strokeStyle = 'rgba(14, 20, 24, 0.55)';
  c.lineWidth = band + 4;
  ovalPath(c, cx, cy, rx, ry);
  c.stroke();

  c.strokeStyle = PALETTE.boards;
  c.lineWidth = band;
  c.globalAlpha = 0.85;
  ovalPath(c, cx, cy, rx, ry);
  c.stroke();
  c.globalAlpha = 1;

  // The cote d'azur, inside the loop.
  c.strokeStyle = PALETTE.cote;
  c.lineWidth = Math.max(2, band * 0.22);
  ovalPath(c, cx, cy, rx - band * 0.62, ry - band * 0.62);
  c.stroke();

  // The finish line, at the end of the bottom straight, across the band.
  const fin = pointOnOval(0, cx, cy, rx, ry);
  c.strokeStyle = INK.text;
  c.lineWidth = Math.max(2.5, size * 0.016);
  c.beginPath();
  c.moveTo(fin.x, fin.y - band * 0.7);
  c.lineTo(fin.x, fin.y + band * 0.7);
  c.stroke();

  // The lap, in the infield. It is the only number here, so it can be big.
  const lap = lapNumber(s.player.distance);
  // A new lap lands with weight: the count flares for the first few metres
  // of it. Derived from distance, so it is the same every ride.
  const intoLap = s.player.distance % LAP_LENGTH_M;
  const flare = Math.max(0, 1 - intoLap / 10);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = INK.text;
  const lapFont = `800 ${size * 0.30}px ${DISPLAY_FONT}`;
  const gap = drawTabular(c, `${lap}`, cx, cy + size * 0.075, lapFont, 'center');
  if (flare > 0) {
    c.globalAlpha = flare * 0.5;
    c.fillStyle = PALETTE.light;
    drawTabular(c, `${lap}`, cx, cy + size * 0.075, lapFont, 'center');
    c.globalAlpha = 1;
  }
  c.fillStyle = INK.textDim;
  c.font = `600 ${Math.max(9, size * 0.055)}px ${LABEL_FONT}`;
  c.textAlign = 'left';
  c.fillText(`/${RACE_LAPS}`, cx + gap / 2 + size * 0.02, cy + size * 0.075);
  c.fillStyle = INK.textFaint;
  c.letterSpacing = '0.14em';
  c.textAlign = 'center';
  c.fillText('LAP', cx, cy - size * 0.10);
  c.letterSpacing = '0px';
  c.textAlign = 'left';

  // The riders. Ringed in the arena's dark so they never disappear into the
  // boards, and the player is the larger of the two.
  const dot = (distance: number, colour: string, radius: number): void => {
    const p = pointOnOval(lapPhase(Math.min(distance, RACE_DISTANCE_M)), cx, cy, rx, ry);
    c.fillStyle = 'rgba(7, 11, 14, 0.85)';
    c.beginPath();
    c.arc(p.x, p.y, radius + Math.max(1.5, size * 0.012), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = colour;
    c.beginPath();
    c.arc(p.x, p.y, radius, 0, Math.PI * 2);
    c.fill();
  };
  dot(s.rival.distance, KIT.rivalAccent, Math.max(3.5, size * 0.035));
  dot(s.player.distance, KIT.playerAccent, Math.max(4.5, size * 0.045));

  c.restore();
}
