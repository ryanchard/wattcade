/**
 * Paperboy's poster: the round, twenty minutes before sunrise.
 *
 * Drawn from the same `PALETTE` the street itself is drawn from, so the card
 * cannot advertise a colour the game no longer wears. Everything is a
 * fraction of the box it is given, so one function serves a wide card and a
 * narrow one.
 */
import { PALETTE } from './render/palette.js';

/** The warm pool a porch light throws. Additive, like the scene's own. */
function glow(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255, 198, 116, 0.55)');
  g.addColorStop(0.45, 'rgba(255, 176, 96, 0.22)');
  g.addColorStop(1, 'rgba(255, 150, 80, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** One gable-roofed house, flat-filled, with its windows lit or not. */
function house(
  ctx: CanvasRenderingContext2D,
  x: number, baseY: number, w: number, h: number, lit: boolean,
): void {
  const wall = lit ? PALETTE.houseWall[0]! : PALETTE.houseWallCool[0]!;
  ctx.fillStyle = wall;
  ctx.fillRect(x, baseY - h, w, h);

  ctx.fillStyle = PALETTE.houseRoof[0]!;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.09, baseY - h);
  ctx.lineTo(x + w * 0.5, baseY - h * 1.42);
  ctx.lineTo(x + w * 1.09, baseY - h);
  ctx.closePath();
  ctx.fill();

  // Two windows per storey. A lit one is the delivery signal, and the whole
  // scene is built so that reads first.
  const ww = w * 0.24;
  const wh = h * 0.26;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const wx = x + w * (0.16 + col * 0.44);
      const wy = baseY - h + h * (0.18 + row * 0.42);
      ctx.fillStyle = lit ? PALETTE.windowLit : PALETTE.windowDark;
      ctx.fillRect(wx, wy, ww, wh);
      if (lit) {
        ctx.fillStyle = PALETTE.windowLitCore;
        ctx.fillRect(wx + ww * 0.2, wy + wh * 0.18, ww * 0.6, wh * 0.44);
      }
      ctx.fillStyle = PALETTE.mullion;
      ctx.fillRect(wx + ww * 0.46, wy, ww * 0.08, wh);
    }
  }
}

/** The rider, side-on and small — a red jersey against a blue street. */
function rider(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
): void {
  ctx.strokeStyle = PALETTE.bikeTyre;
  ctx.lineWidth = s * 0.1;
  for (const wheelX of [x - s * 0.52, x + s * 0.52]) {
    ctx.beginPath();
    ctx.arc(wheelX, y, s * 0.34, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = PALETTE.bikeFrame;
  ctx.lineWidth = s * 0.11;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.52, y);
  ctx.lineTo(x, y - s * 0.1);
  ctx.lineTo(x + s * 0.52, y);
  ctx.moveTo(x, y - s * 0.1);
  ctx.lineTo(x + s * 0.2, y - s * 0.62);
  ctx.stroke();

  ctx.fillStyle = PALETTE.rider;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.28, y - s * 0.5);
  ctx.lineTo(x + s * 0.24, y - s * 0.98);
  ctx.lineTo(x + s * 0.46, y - s * 0.72);
  ctx.lineTo(x - s * 0.06, y - s * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PALETTE.riderHelmet;
  ctx.beginPath();
  ctx.arc(x + s * 0.36, y - s * 1.04, s * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.bagCanvas;
  ctx.beginPath();
  ctx.ellipse(x - s * 0.22, y - s * 0.6, s * 0.24, s * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

export function poster(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const horizon = height * 0.52;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, PALETTE.skyTop);
  sky.addColorStop(0.72, '#4a3f63');
  sky.addColorStop(1, PALETTE.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  // The far street, as a ragged roofline rather than drawn houses.
  ctx.fillStyle = '#2a2c46';
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  for (let i = 0; i <= 10; i++) {
    const x = (width * i) / 10;
    const top = horizon - height * (0.05 + ((i * 7) % 5) * 0.018);
    ctx.lineTo(x, top);
    ctx.lineTo(x + width / 10, top);
  }
  ctx.lineTo(width, horizon);
  ctx.closePath();
  ctx.fill();

  // Lawn, then the kerb, then the road: the three strips the round runs over.
  ctx.fillStyle = PALETTE.lawn;
  ctx.fillRect(0, horizon, width, height * 0.14);
  ctx.fillStyle = PALETTE.sidewalk;
  ctx.fillRect(0, horizon + height * 0.14, width, height * 0.05);
  ctx.fillStyle = PALETTE.curb;
  ctx.fillRect(0, horizon + height * 0.185, width, height * 0.015);
  ctx.fillStyle = PALETTE.road;
  ctx.fillRect(0, horizon + height * 0.2, width, height * 0.8);

  // Centre line, in perspective enough to say "road" and no more.
  ctx.fillStyle = PALETTE.roadLine;
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const y = horizon + height * (0.34 + t * t * 0.6);
    const len = width * (0.06 + t * 0.1);
    ctx.fillRect(width * 0.5 - len / 2 + t * width * 0.06, y, len, height * (0.012 + t * 0.014));
  }

  // Three houses on the near side. Two subscribers, one not — the read the
  // whole game is built on.
  const baseY = horizon + height * 0.15;
  house(ctx, width * 0.04, baseY, width * 0.2, height * 0.3, true);
  house(ctx, width * 0.3, baseY, width * 0.17, height * 0.24, false);
  house(ctx, width * 0.55, baseY, width * 0.22, height * 0.33, true);

  glow(ctx, width * 0.14, baseY, height * 0.24);
  glow(ctx, width * 0.66, baseY, height * 0.26);

  // A mailbox with its flag still up: a paper still owed.
  ctx.fillStyle = PALETTE.mailboxPost;
  ctx.fillRect(width * 0.845, baseY - height * 0.05, width * 0.012, height * 0.07);
  ctx.fillStyle = PALETTE.mailboxSubscriber;
  ctx.fillRect(width * 0.82, baseY - height * 0.085, width * 0.062, height * 0.038);
  ctx.fillStyle = PALETTE.mailboxFlagUp;
  ctx.fillRect(width * 0.884, baseY - height * 0.105, width * 0.008, height * 0.04);

  rider(ctx, width * 0.42, height * 0.87, height * 0.2);

  // The paper, mid-air, already thrown.
  ctx.save();
  ctx.translate(width * 0.24, height * 0.66);
  ctx.rotate(-0.5);
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(-width * 0.022, -height * 0.016, width * 0.044, height * 0.032);
  ctx.fillStyle = PALETTE.paperBand;
  ctx.fillRect(-width * 0.022, -height * 0.004, width * 0.044, height * 0.008);
  ctx.restore();
}
