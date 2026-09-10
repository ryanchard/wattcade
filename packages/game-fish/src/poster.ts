/**
 * Fish's poster: the one question the game asks, held still.
 *
 * Depth is the whole picture — bright at the top, black at the bottom — and
 * every silhouette in it is sized against the one warm fish in the middle, so
 * the card asks "is that bigger than you?" before the rider has read a word.
 */
import { POSTER_INK, POSTER_WATER } from './render.js';

/** One fish: body, tail, dorsal, eye. Length is the only thing that matters. */
function fish(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, len: number, facing: 1 | -1,
  body: string, fin: string,
): void {
  const h = len * 0.42;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(-len * 0.4, 0);
  ctx.lineTo(-len * 0.62, -h * 0.6);
  ctx.lineTo(-len * 0.54, 0);
  ctx.lineTo(-len * 0.62, h * 0.6);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-len * 0.08, -h * 0.42);
  ctx.lineTo(len * 0.04, -h * 0.92);
  ctx.lineTo(len * 0.16, -h * 0.36);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, len * 0.5, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = POSTER_INK.eyeWhite;
  ctx.beginPath();
  ctx.arc(len * 0.3, -h * 0.14, h * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = POSTER_INK.eyeDark;
  ctx.beginPath();
  ctx.arc(len * 0.32, -h * 0.14, h * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function poster(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const water = ctx.createLinearGradient(0, 0, 0, height);
  water.addColorStop(0, POSTER_WATER.top);
  water.addColorStop(0.42, POSTER_WATER.mid);
  water.addColorStop(0.88, POSTER_WATER.deep);
  water.addColorStop(1, POSTER_WATER.seabed);
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, width, height);

  // Light from the surface: four shafts, wider as they fall, fading out well
  // before the bottom. This is the only thing that says which way is up.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const x = width * (0.1 + i * 0.27);
    const g = ctx.createLinearGradient(x, 0, x, height * 0.7);
    g.addColorStop(0, 'rgba(210, 250, 255, 0.18)');
    g.addColorStop(1, 'rgba(210, 250, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - width * 0.03, 0);
    ctx.lineTo(x + width * 0.03, 0);
    ctx.lineTo(x + width * 0.11, height * 0.7);
    ctx.lineTo(x - width * 0.07, height * 0.7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // The seabed, and a few weeds off it.
  ctx.fillStyle = POSTER_WATER.seabed;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, height * 0.94);
  ctx.quadraticCurveTo(width * 0.4, height * 0.88, width, height * 0.96);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Something huge in the dark, mostly implied — the size the rider is
  // trying to become, and until then the thing that ends the run.
  fish(ctx, width * 0.76, height * 0.74, width * 0.72, -1,
    POSTER_INK.predatorBody, POSTER_INK.predatorFin);
  ctx.strokeStyle = POSTER_INK.predatorEdge;
  ctx.lineWidth = Math.max(1, height * 0.008);
  ctx.beginPath();
  ctx.ellipse(width * 0.76, height * 0.74, width * 0.36, width * 0.152, 0, Math.PI * 1.05, Math.PI * 1.75);
  ctx.stroke();

  // Prey, small and green, swimming toward their mistake.
  fish(ctx, width * 0.24, height * 0.3, width * 0.1, 1,
    POSTER_INK.preyBody, POSTER_INK.preyFin);
  fish(ctx, width * 0.36, height * 0.44, width * 0.075, 1,
    POSTER_INK.preyBody, POSTER_INK.preyFin);
  fish(ctx, width * 0.12, height * 0.5, width * 0.06, 1,
    POSTER_INK.preyBody, POSTER_INK.preyFin);

  // You: warm, and the only thing in the picture with a scale of its own.
  fish(ctx, width * 0.42, height * 0.46, width * 0.28, 1,
    POSTER_INK.playerBody, POSTER_INK.playerFin);

  // Bubbles from your mouth, and something glowing down where the light is
  // not.
  ctx.fillStyle = 'rgba(246, 243, 230, 0.5)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(width * (0.57 + i * 0.035), height * (0.4 - i * 0.055),
      height * (0.012 - i * 0.002), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = POSTER_INK.biolum;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(width * (0.06 + i * 0.045), height * (0.82 + (i % 2) * 0.06),
      height * 0.009, 0, Math.PI * 2);
    ctx.fill();
  }
}
