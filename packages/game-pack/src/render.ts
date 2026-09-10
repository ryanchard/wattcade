import type { Session } from './session.js';

// ---------------------------------------------------------------------------
// Side-on view. The gap is the picture, not just a number: the pack's
// screen position is a direct readout of `session.gap` in metres, so a
// shrinking gap visibly means the pack crawling up the screen toward the
// rider. No perspective/iso projection — just a ground line, parallax
// layers for a sense of speed, and flat silhouettes.
// ---------------------------------------------------------------------------

const RIDER_X_FRACTION = 0.62;
const GROUND_Y_FRACTION = 0.68;

/** Pixels of screen offset per metre of gap. Tuned so a fresh run's
 * starting gap (see GAP_INITIAL_M) reads as a clear but not huge lead. */
const PACK_PX_PER_METER = 9;
/** However large the gap gets, the pack never renders closer than this to
 * the left edge — it pins there with a chevron rather than vanishing. */
const PACK_EDGE_PAD_PX = 46;
/** Never draw the pack closer to the rider than this, so the two
 * silhouettes stay visually distinct until the literal moment of catch. */
const PACK_MIN_OFFSET_PX = 14;

/** Parallax scroll speed per layer, in px per (m/s of rider speed). This
 * *is* the sense of speed — cheap, and it reads instantly. */
const FAR_SPEED_PX_PER_MPS = 2.2;
const MID_SPEED_PX_PER_MPS = 5.5;
const NEAR_SPEED_PX_PER_MPS = 13;

const FAR_PERIOD_PX = 420;
const MID_PERIOD_PX = 220;
const NEAR_PERIOD_PX = 56;

const SKY_TOP = '#1b2036';
const SKY_HORIZON = '#3c4568';
const GROUND_FAR = '#232a44';
const GROUND_NEAR = '#171b2c';
const SILHOUETTE = '#0d0f18';
const RIDER_ACCENT = '#f2ead9';
const DOG_ON_RIDER = '#c94f3a';
const PACK_COLOUR = '#0d0f18';
const PACK_DUST = 'rgba(13, 15, 24, 0.35)';
const GAP_ROAD_LINE = 'rgba(242, 234, 217, 0.18)';

export interface RenderState {
  scrollFar: number;
  scrollMid: number;
  scrollNear: number;
  legPhase: number;
}

export function createRenderState(): RenderState {
  return { scrollFar: 0, scrollMid: 0, scrollNear: 0, legPhase: 0 };
}

export function updateRenderState(
  r: RenderState, speed: number, dt: number,
): void {
  r.scrollFar += speed * FAR_SPEED_PX_PER_MPS * dt;
  r.scrollMid += speed * MID_SPEED_PX_PER_MPS * dt;
  r.scrollNear += speed * NEAR_SPEED_PX_PER_MPS * dt;
  r.legPhase += (2 + speed * 1.5) * dt;
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  s: Session,
  r: RenderState,
  width: number,
  height: number,
): void {
  const groundY = height * GROUND_Y_FRACTION;
  const riderX = width * RIDER_X_FRACTION;

  drawSky(ctx, width, groundY);
  drawFarLayer(ctx, r, width, groundY);
  drawGroundLine(ctx, width, groundY);
  drawMidLayer(ctx, r, width, groundY);
  drawNearLayer(ctx, r, width, groundY);

  const { x: packX, pinned } = packScreenX(s.gap, riderX);
  drawPack(ctx, packX, groundY, r.legPhase, pinned);
  drawRider(ctx, riderX, groundY, r.legPhase, s.dogs);
}

/**
 * Maps the gap (metres) to a screen x-position for the pack, left of the
 * rider. Within normal play this is a true, linear readout of the gap; only
 * once the pack would render off the left edge does it pin there (with
 * `pinned` set so the caller can flag "still out there, further back than
 * shown").
 */
function packScreenX(
  gapM: number, riderX: number,
): { x: number; pinned: boolean } {
  const wanted = Math.max(0, gapM) * PACK_PX_PER_METER;
  const maxOffset = riderX - PACK_EDGE_PAD_PX;
  const offset = Math.min(Math.max(wanted, PACK_MIN_OFFSET_PX), maxOffset);
  return { x: riderX - offset, pinned: wanted > maxOffset };
}

function drawSky(ctx: CanvasRenderingContext2D, width: number, groundY: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY);
}

function drawGroundLine(ctx: CanvasRenderingContext2D, width: number, groundY: number): void {
  const ground = ctx.createLinearGradient(0, groundY, 0, groundY + 260);
  ground.addColorStop(0, GROUND_FAR);
  ground.addColorStop(1, GROUND_NEAR);
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundY, width, 260);
  ctx.strokeStyle = GAP_ROAD_LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();
}

/** Distant, slow-moving low hills — a faint sense of a world going by. */
function drawFarLayer(
  ctx: CanvasRenderingContext2D, r: RenderState, width: number, groundY: number,
): void {
  const offset = r.scrollFar % FAR_PERIOD_PX;
  ctx.fillStyle = 'rgba(60, 69, 104, 0.5)';
  for (let x = -offset - FAR_PERIOD_PX; x < width + FAR_PERIOD_PX; x += FAR_PERIOD_PX) {
    ctx.beginPath();
    ctx.ellipse(x + FAR_PERIOD_PX / 2, groundY, FAR_PERIOD_PX * 0.6, 46, 0, Math.PI, 0, true);
    ctx.fill();
  }
}

/** Mid-distance poles — the layer that most sells "passing scenery". */
function drawMidLayer(
  ctx: CanvasRenderingContext2D, r: RenderState, width: number, groundY: number,
): void {
  const offset = r.scrollMid % MID_PERIOD_PX;
  ctx.fillStyle = 'rgba(13, 15, 24, 0.55)';
  for (let x = -offset; x < width + MID_PERIOD_PX; x += MID_PERIOD_PX) {
    ctx.fillRect(x - 2, groundY - 70, 4, 70);
  }
}

/** Fast ground detail directly underfoot — dashes plus tufts of grass. */
function drawNearLayer(
  ctx: CanvasRenderingContext2D, r: RenderState, width: number, groundY: number,
): void {
  const offset = r.scrollNear % NEAR_PERIOD_PX;
  ctx.strokeStyle = 'rgba(242, 234, 217, 0.35)';
  ctx.lineWidth = 3;
  for (let x = -offset; x < width + NEAR_PERIOD_PX; x += NEAR_PERIOD_PX) {
    ctx.beginPath();
    ctx.moveTo(x, groundY + 14);
    ctx.lineTo(x + NEAR_PERIOD_PX * 0.5, groundY + 14);
    ctx.stroke();
  }
}

/** A bike + rider silhouette, facing right, with any currently-attached
 * dogs drawn latched onto it — the drag has a visible cause. */
function drawRider(
  ctx: CanvasRenderingContext2D, x: number, groundY: number, legPhase: number, dogs: number,
): void {
  const wheelR = 19;
  const hubY = groundY - wheelR;
  const rearX = x - 24;
  const frontX = x + 24;

  ctx.save();
  ctx.fillStyle = SILHOUETTE;
  ctx.strokeStyle = SILHOUETTE;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Wheels.
  strokeCircle(ctx, rearX, hubY, wheelR);
  strokeCircle(ctx, frontX, hubY, wheelR);

  // Frame.
  const seatX = x - 6;
  const seatY = hubY - 30;
  const barX = x + 16;
  const barY = hubY - 24;
  ctx.beginPath();
  ctx.moveTo(rearX, hubY);
  ctx.lineTo(seatX, seatY);
  ctx.lineTo(frontX, hubY);
  ctx.lineTo(barX, barY);
  ctx.moveTo(seatX, seatY);
  ctx.lineTo(x + 4, hubY);
  ctx.stroke();

  // Rider: torso leaning forward, head, one animated leg.
  const hipX = seatX;
  const hipY = seatY - 4;
  const shoulderX = barX - 4;
  const shoulderY = seatY - 34;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(shoulderX, shoulderY);
  ctx.stroke();
  // Arm to the bars.
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(barX, barY);
  ctx.stroke();
  // Head.
  ctx.beginPath();
  ctx.arc(shoulderX + 6, shoulderY - 12, 10, 0, Math.PI * 2);
  ctx.fill();
  // Pedalling leg (simple two-segment leg swinging with legPhase).
  const kneeSwing = Math.sin(legPhase) * 12;
  const kneeX = x - 2 + kneeSwing;
  const kneeY = hubY - 14;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(kneeX, kneeY);
  ctx.lineTo(x - 6, hubY);
  ctx.stroke();

  ctx.restore();

  // Dogs latched on: drawn biting the rear of the bike/rider, stacked so
  // more dogs visibly pile up.
  const visible = Math.min(dogs, 5);
  for (let i = 0; i < visible; i++) {
    drawLatchedDog(ctx, rearX - 8 - i * 13, hubY + 4, i);
  }
  if (dogs > visible) {
    ctx.save();
    ctx.fillStyle = RIDER_ACCENT;
    ctx.font = '700 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`+${dogs - visible}`, rearX - 8 - visible * 13, hubY + 24);
    ctx.restore();
  }
}

function drawLatchedDog(
  ctx: CanvasRenderingContext2D, x: number, y: number, i: number,
): void {
  ctx.save();
  ctx.fillStyle = DOG_ON_RIDER;
  ctx.translate(x, y);
  ctx.rotate(-0.25 - i * 0.03);
  drawDogShape(ctx, 0.75);
  ctx.restore();
}

/** The chasing pack: a bunched, generic cluster of dogs — its position IS
 * the gap. `pinned` marks that the true gap is larger than what's shown, so
 * a small chevron reinforces "still out there, further back than drawn". */
function drawPack(
  ctx: CanvasRenderingContext2D, x: number, groundY: number, legPhase: number, pinned: boolean,
): void {
  ctx.save();
  ctx.fillStyle = PACK_DUST;
  ctx.beginPath();
  ctx.ellipse(x - 6, groundY - 4, 34, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = PACK_COLOUR;
  const offsets = [-18, -2, 12, -10, 4];
  offsets.forEach((dx, i) => {
    ctx.save();
    ctx.translate(x + dx, groundY - 3 + Math.sin(legPhase + i) * 1.5);
    drawDogShape(ctx, 1 + (i % 2) * 0.12);
    ctx.restore();
  });

  if (pinned) {
    ctx.save();
    ctx.fillStyle = 'rgba(201, 79, 58, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 46, groundY - 34);
    ctx.lineTo(x - 34, groundY - 40);
    ctx.lineTo(x - 34, groundY - 28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** One simple four-legged silhouette, drawn around the local origin with
 * its feet on y = 0, facing right (toward +x, i.e. toward the rider). */
function drawDogShape(ctx: CanvasRenderingContext2D, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.ellipse(0, -9, 13, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head.
  ctx.beginPath();
  ctx.ellipse(11, -13, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Ear.
  ctx.beginPath();
  ctx.moveTo(13, -17);
  ctx.lineTo(17, -21);
  ctx.lineTo(11, -18);
  ctx.closePath();
  ctx.fill();
  // Tail.
  ctx.beginPath();
  ctx.moveTo(-12, -12);
  ctx.lineTo(-19, -18);
  ctx.lineTo(-13, -8);
  ctx.closePath();
  ctx.fill();
  // Legs.
  ctx.fillRect(-8, -6, 3, 6);
  ctx.fillRect(-1, -6, 3, 6);
  ctx.fillRect(5, -6, 3, 6);
  ctx.fillRect(9, -6, 3, 6);
  ctx.restore();
}

function strokeCircle(
  ctx: CanvasRenderingContext2D, x: number, y: number, radius: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}
