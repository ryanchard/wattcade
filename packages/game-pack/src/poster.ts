/**
 * The Pack's poster: the road, and what is on it behind you.
 *
 * The same side-on read the game uses — silhouettes on a ground line, the
 * rider warm and everything chasing him flat black — so the card is the game
 * held still. Colours are the renderer's own.
 */
import { POSTER_INK, POSTER_SKY } from './render.js';

/** A dog, flat, mid-stride. Four legs is one too many to read at this size. */
function dog(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, phase: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.42, s * 0.44, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head and snout, forward and low.
  ctx.beginPath();
  ctx.moveTo(x + s * 0.3, y - s * 0.56);
  ctx.lineTo(x + s * 0.92, y - s * 0.66);
  ctx.lineTo(x + s * 0.92, y - s * 0.4);
  ctx.lineTo(x + s * 0.3, y - s * 0.3);
  ctx.closePath();
  ctx.fill();
  // Ear.
  ctx.beginPath();
  ctx.moveTo(x + s * 0.34, y - s * 0.62);
  ctx.lineTo(x + s * 0.5, y - s * 0.98);
  ctx.lineTo(x + s * 0.6, y - s * 0.6);
  ctx.closePath();
  ctx.fill();
  // Tail.
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y - s * 0.5);
  ctx.lineTo(x - s * 0.92, y - s * 0.82);
  ctx.lineTo(x - s * 0.82, y - s * 0.44);
  ctx.closePath();
  ctx.fill();
  // Legs, swung by phase so the three dogs are not one dog stamped thrice.
  ctx.lineWidth = s * 0.13;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ctx.fillStyle;
  for (let i = 0; i < 2; i++) {
    const lx = x + (i === 0 ? -s * 0.24 : s * 0.28);
    const swing = Math.sin(phase + i * 2.1) * s * 0.3;
    ctx.beginPath();
    ctx.moveTo(lx, y - s * 0.3);
    ctx.lineTo(lx + swing, y);
    ctx.moveTo(lx, y - s * 0.3);
    ctx.lineTo(lx - swing, y);
    ctx.stroke();
  }
}

export function poster(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const groundY = height * 0.7;

  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, POSTER_SKY.top);
  sky.addColorStop(1, POSTER_SKY.horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY);

  // A low moon, because the chase happens at night and nothing else in the
  // sky says so.
  ctx.fillStyle = 'rgba(242, 234, 217, 0.22)';
  ctx.beginPath();
  ctx.arc(width * 0.78, height * 0.2, height * 0.09, 0, Math.PI * 2);
  ctx.fill();

  // Far treeline: one flat band, no detail, purely to put a horizon in.
  ctx.fillStyle = POSTER_INK.silhouette;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  for (let i = 0; i <= 14; i++) {
    const x = (width * i) / 14;
    ctx.lineTo(x, groundY - height * (0.03 + ((i * 5) % 4) * 0.022));
  }
  ctx.lineTo(width, groundY);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  const ground = ctx.createLinearGradient(0, groundY, 0, height);
  ground.addColorStop(0, POSTER_INK.groundFar);
  ground.addColorStop(1, POSTER_INK.groundNear);
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundY, width, height - groundY);

  ctx.strokeStyle = POSTER_INK.roadLine;
  ctx.lineWidth = Math.max(1, height * 0.008);
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  // The pack, three deep and gaining, in the same flat black the game uses.
  ctx.fillStyle = POSTER_INK.silhouette;
  const s = height * 0.2;
  dog(ctx, width * 0.08, groundY + height * 0.1, s * 1.05, 0);
  dog(ctx, width * 0.24, groundY + height * 0.14, s * 1.2, 1.4);
  dog(ctx, width * 0.4, groundY + height * 0.18, s * 1.35, 2.7);

  // Dust, kicked up behind them.
  ctx.fillStyle = POSTER_INK.dust;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(width * (0.04 + i * 0.07), groundY + height * (0.2 + i * 0.01),
      height * (0.03 + i * 0.008), 0, Math.PI * 2);
    ctx.fill();
  }

  // The rider: ahead, and the only warm thing in the picture.
  const rx = width * 0.74;
  const ry = groundY + height * 0.2;
  const rs = height * 0.3;
  ctx.strokeStyle = POSTER_INK.silhouette;
  ctx.lineWidth = rs * 0.07;
  for (const wx of [rx - rs * 0.44, rx + rs * 0.44]) {
    ctx.beginPath();
    ctx.arc(wx, ry - rs * 0.28, rs * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(rx - rs * 0.44, ry - rs * 0.28);
  ctx.lineTo(rx, ry - rs * 0.36);
  ctx.lineTo(rx + rs * 0.44, ry - rs * 0.28);
  ctx.moveTo(rx, ry - rs * 0.36);
  ctx.lineTo(rx + rs * 0.16, ry - rs * 0.86);
  ctx.stroke();

  ctx.fillStyle = POSTER_INK.riderAccent;
  ctx.beginPath();
  ctx.moveTo(rx - rs * 0.24, ry - rs * 0.7);
  ctx.lineTo(rx + rs * 0.2, ry - rs * 1.16);
  ctx.lineTo(rx + rs * 0.4, ry - rs * 0.94);
  ctx.lineTo(rx - rs * 0.04, ry - rs * 0.52);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = POSTER_INK.silhouette;
  ctx.beginPath();
  ctx.arc(rx + rs * 0.32, ry - rs * 1.22, rs * 0.16, 0, Math.PI * 2);
  ctx.fill();

  // One dog already on him — the drag you are carrying, drawn in the colour
  // the HUD uses for exactly that.
  ctx.fillStyle = POSTER_INK.dogOnRider;
  dog(ctx, rx - rs * 0.62, ry, rs * 0.6, 0.8);
}
