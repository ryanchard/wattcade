/**
 * Spin Cycle's poster: the machine, aloft, on a good afternoon.
 *
 * The game's read is silhouette against a big pale sky, so the poster is too:
 * most of the frame is sky, the ground is a strip of English green at the
 * bottom, and the only warm thing in it is the machine.
 */
import { POSTER_INK, POSTER_SKY } from './render.js';

/** A soft cumulus. Three overlapping circles is all one needs at this size. */
function cloud(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number,
): void {
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.85, y + r * 0.12, r * 0.72, 0, Math.PI * 2);
  ctx.arc(x - r * 0.8, y + r * 0.2, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

export function poster(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const groundY = height * 0.84;

  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, POSTER_SKY.top);
  sky.addColorStop(0.55, POSTER_SKY.mid);
  sky.addColorStop(1, POSTER_SKY.haze);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY);

  cloud(ctx, width * 0.16, height * 0.2, height * 0.09, 0.5);
  cloud(ctx, width * 0.72, height * 0.14, height * 0.07, 0.38);
  cloud(ctx, width * 0.52, height * 0.44, height * 0.11, 0.75);
  cloud(ctx, width * 0.9, height * 0.55, height * 0.08, 0.6);

  // Fields, then the hedgerow that separates them. The strip is thin: the
  // sky is what you are flying in and the ground is what you are avoiding.
  ctx.fillStyle = POSTER_INK.groundFar;
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = POSTER_INK.groundNear;
  ctx.fillRect(0, groundY + height * 0.07, width, height);
  ctx.fillStyle = POSTER_INK.hedge;
  for (let i = 0; i < 5; i++) {
    const x = width * (i / 5) - width * 0.05;
    ctx.beginPath();
    ctx.moveTo(x, groundY + height * 0.075);
    ctx.lineTo(x + width * 0.12, groundY - height * 0.01);
    ctx.lineTo(x + width * 0.15, groundY + height * 0.075);
    ctx.closePath();
    ctx.fill();
  }

  // Bunting, strung across the top: the village-fete register the whole
  // game is pitched in.
  ctx.strokeStyle = POSTER_INK.ink;
  ctx.lineWidth = Math.max(1, height * 0.005);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.06);
  ctx.quadraticCurveTo(width * 0.5, height * 0.14, width, height * 0.04);
  ctx.stroke();
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const x = width * t;
    const y = height * (0.06 + 0.08 * (4 * t * (1 - t)) - 0.02 * t);
    ctx.fillStyle = POSTER_INK.bunting[i % POSTER_INK.bunting.length]!;
    ctx.beginPath();
    ctx.moveTo(x - width * 0.016, y);
    ctx.lineTo(x + width * 0.016, y);
    ctx.lineTo(x, y + height * 0.05);
    ctx.closePath();
    ctx.fill();
  }

  // The machine. Wings of canvas, a brass frame, a propeller driven by the
  // legs of the man sitting in it.
  const cx = width * 0.38;
  const cy = height * 0.55;
  const s = height * 0.3;

  // Upper and lower wing.
  ctx.fillStyle = POSTER_INK.canvas;
  ctx.strokeStyle = POSTER_INK.ink;
  ctx.lineWidth = Math.max(1, s * 0.04);
  for (const dy of [-s * 0.62, s * 0.1]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + dy, s * 1.15, s * 0.13, -0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Struts between them.
  for (const dx of [-s * 0.75, -s * 0.1, s * 0.6]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - s * 0.56);
    ctx.lineTo(cx + dx, cy + s * 0.06);
    ctx.stroke();
  }

  // Fuselage: a long brass hull with a tail.
  ctx.fillStyle = POSTER_INK.brass;
  ctx.beginPath();
  ctx.moveTo(cx + s * 1.1, cy - s * 0.16);
  ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 0.36, cx - s * 1.05, cy - s * 0.18);
  ctx.lineTo(cx - s * 1.05, cy + s * 0.02);
  ctx.quadraticCurveTo(cx + s * 0.3, cy + s * 0.12, cx + s * 1.1, cy - s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = POSTER_INK.canvas;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.95, cy - s * 0.2);
  ctx.lineTo(cx - s * 1.35, cy - s * 0.66);
  ctx.lineTo(cx - s * 1.05, cy - s * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // The pilot, pedalling.
  ctx.fillStyle = POSTER_INK.ink;
  ctx.beginPath();
  ctx.arc(cx + s * 0.12, cy - s * 0.46, s * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.02, cy - s * 0.36);
  ctx.lineTo(cx + s * 0.3, cy - s * 0.34);
  ctx.lineTo(cx + s * 0.24, cy - s * 0.14);
  ctx.lineTo(cx - s * 0.06, cy - s * 0.16);
  ctx.closePath();
  ctx.fill();

  // The propeller: the control axis, drawn as a blur because it is your legs.
  ctx.strokeStyle = POSTER_INK.brass;
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.beginPath();
  ctx.ellipse(cx + s * 1.12, cy - s * 0.1, s * 0.1, s * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = POSTER_INK.inkSoft;
  ctx.beginPath();
  ctx.moveTo(cx + s * 1.12, cy - s * 0.72);
  ctx.lineTo(cx + s * 1.12, cy + s * 0.52);
  ctx.stroke();

  // A balloon, further off and higher, for scale and for somewhere to look.
  ctx.fillStyle = POSTER_INK.balloon;
  ctx.beginPath();
  ctx.ellipse(width * 0.84, height * 0.32, height * 0.055, height * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = POSTER_INK.ink;
  ctx.fillRect(width * 0.826, height * 0.4, height * 0.028, height * 0.032);
}
