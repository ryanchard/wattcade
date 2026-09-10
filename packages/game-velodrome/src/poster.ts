/**
 * Velodrome's poster: the banking, seen from inside the track.
 *
 * The three things that make a velodrome a velodrome and not a road — pine
 * boards running up the banking, the cote d'azur at the bottom of them, and
 * the sprinters' line in red — drawn in the palette the race itself uses.
 */
import { INK, KIT, PALETTE } from './palette.js';

/** A rider on the banking: small, leaning, and mostly kit. */
function rider(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, s: number, body: string, accent: string,
): void {
  ctx.strokeStyle = KIT.frame;
  ctx.lineWidth = s * 0.09;
  for (const wx of [x - s * 0.42, x + s * 0.42]) {
    ctx.beginPath();
    ctx.ellipse(wx, y, s * 0.3, s * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y);
  ctx.lineTo(x + s * 0.06, y - s * 0.1);
  ctx.lineTo(x + s * 0.42, y);
  ctx.moveTo(x + s * 0.06, y - s * 0.1);
  ctx.lineTo(x + s * 0.3, y - s * 0.56);
  ctx.stroke();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.24, y - s * 0.46);
  ctx.lineTo(x + s * 0.26, y - s * 0.9);
  ctx.lineTo(x + s * 0.46, y - s * 0.68);
  ctx.lineTo(x - s * 0.02, y - s * 0.26);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x + s * 0.38, y - s * 0.94, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
}

export function poster(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  // The arena beyond the rail. Cold, and almost the whole top of the frame.
  const dark = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  dark.addColorStop(0, INK.arenaDeep);
  dark.addColorStop(1, PALETTE.arena);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, width, height);

  // Roof structure: a few pale trusses over the dark, so the black at the
  // top of the card is a building rather than an absence.
  ctx.strokeStyle = INK.rail;
  ctx.lineWidth = Math.max(1, height * 0.012);
  for (let i = 0; i < 4; i++) {
    const y = height * (0.05 + i * 0.045);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y - height * 0.02);
    ctx.stroke();
  }

  // The banking. One big ellipse arc: the track curving away and up, with
  // the boards running perpendicular to it.
  const cx = width * 0.5;
  const cy = height * 1.62;
  const rOuter = height * 1.5;
  const rInner = height * 0.98;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, width * 0.95, rOuter, 0, Math.PI, Math.PI * 2);
  ctx.ellipse(cx, cy, width * 0.62, rInner, 0, Math.PI * 2, Math.PI, true);
  ctx.closePath();
  ctx.clip();

  const boards = ctx.createLinearGradient(0, height * 0.2, 0, height);
  boards.addColorStop(0, PALETTE.boardsShadow);
  boards.addColorStop(0.55, PALETTE.boards);
  boards.addColorStop(1, PALETTE.boardsShadow);
  ctx.fillStyle = boards;
  ctx.fillRect(0, 0, width, height);

  // Board seams, radiating from the centre of the oval, which is what makes
  // the surface read as boards rather than as a brown ramp.
  ctx.strokeStyle = INK.seam;
  ctx.lineWidth = Math.max(1, height * 0.006);
  for (let i = -26; i <= 26; i++) {
    const a = Math.PI * 1.5 + i * 0.031;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * width * 0.6, cy + Math.sin(a) * rInner);
    ctx.lineTo(cx + Math.cos(a) * width * 1.1, cy + Math.sin(a) * rOuter);
    ctx.stroke();
  }
  ctx.restore();

  // The overhead rig, lighting a stretch of the boards and leaving the rest
  // in the shadow colour. Additive, as the scene's own lights are.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pool = ctx.createRadialGradient(
    width * 0.34, height * 0.52, 0, width * 0.34, height * 0.52, width * 0.5,
  );
  pool.addColorStop(0, 'rgba(255, 244, 220, 0.24)');
  pool.addColorStop(1, 'rgba(255, 244, 220, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // The three lines every track has, in the order they sit going up the
  // banking: cote d'azur, black measurement line, red sprinters' line.
  const band = (r: number, w: number, colour: string): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, height * w);
    ctx.beginPath();
    ctx.ellipse(cx, cy, width * (0.62 + (r - rInner) / rOuter), r, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  };
  band(rInner, 0.055, PALETTE.cote);
  band(rInner + height * 0.05, 0.012, INK.measurement);
  band(rInner + height * 0.13, 0.016, PALETTE.sprintLine);
  band(rInner + height * 0.32, 0.012, INK.paint);

  // Infield, below the cote: flat and dark, so the boards have somewhere to
  // stop.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, width * 0.62, rInner, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = PALETTE.arena;
  ctx.fill();
  ctx.restore();

  // Two riders, high on the banking, the warm one in front.
  rider(ctx, width * 0.62, height * 0.72, height * 0.2,
    KIT.rivalBody, KIT.rivalAccent);
  rider(ctx, width * 0.4, height * 0.79, height * 0.24,
    KIT.playerBody, KIT.playerAccent);
}
