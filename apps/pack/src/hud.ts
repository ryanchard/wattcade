import { SHAKE_HOLD_DURATION_S, shakeThreshold } from './session.js';
import type { Session } from './session.js';

const TEXT = '#f2ead9';
const TEXT_DIM = 'rgba(242, 234, 217, 0.6)';
const GROWING = '#7fd88f';
const SHRINKING = '#e5533d';
const NEUTRAL = '#f2ead9';
const BAR_TRACK = 'rgba(242, 234, 217, 0.18)';
const BAR_FILL = '#ffd98a';
const BAR_FILL_HOT = '#7fd88f';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Draws the whole ride HUD. The gap is drawn first, biggest, and highest on
 * screen — it is the single most important thing to see. Shake progress is
 * second, drawn large enough to track mid-sprint. Dog count and everything
 * else is smaller, secondary information.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  s: Session,
  gapTrendMps: number,
  width: number,
  trainerLabel: string,
): void {
  ctx.save();
  ctx.textBaseline = 'top';

  drawGap(ctx, s.gap, gapTrendMps, width);
  drawShakeProgress(ctx, s, width);
  drawDogCount(ctx, s.dogs, width);
  drawSecondary(ctx, s, width, trainerLabel);

  ctx.restore();
}

function drawGap(
  ctx: CanvasRenderingContext2D, gap: number, trend: number, width: number,
): void {
  // A dead zone around zero trend avoids flickering colour on noise from
  // the eased power signal.
  const colour = trend > 0.05 ? GROWING : trend < -0.05 ? SHRINKING : NEUTRAL;
  const arrow = trend > 0.05 ? '▲' : trend < -0.05 ? '▼' : '─';

  ctx.textAlign = 'center';
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `600 18px ${MONO}`;
  ctx.fillText('GAP', width / 2, 14);

  ctx.fillStyle = colour;
  ctx.font = `800 72px ${MONO}`;
  ctx.fillText(`${arrow} ${gap.toFixed(1)} m`, width / 2, 34);
}

function drawShakeProgress(
  ctx: CanvasRenderingContext2D, s: Session, width: number,
): void {
  if (s.dogs === 0) return;

  const threshold = shakeThreshold(s.profile);
  const trying = s.powerCurrent >= threshold;
  const progress = Math.min(1, s.shakeHoldS / SHAKE_HOLD_DURATION_S);

  const barW = Math.min(420, width * 0.5);
  const barH = 26;
  const x = width / 2 - barW / 2;
  const y = 128;

  ctx.textAlign = 'center';
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `700 16px ${MONO}`;
  ctx.fillText(
    trying ? 'SHAKING...' : `SPRINT TO SHAKE — ${Math.round(threshold)} W`,
    width / 2, y - 22,
  );

  ctx.fillStyle = BAR_TRACK;
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = progress > 0.99 ? BAR_FILL_HOT : trying ? BAR_FILL : BAR_TRACK;
  ctx.fillRect(x, y, barW * progress, barH);
  ctx.strokeStyle = TEXT_DIM;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, barH);
}

function drawDogCount(
  ctx: CanvasRenderingContext2D, dogs: number, width: number,
): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT;
  ctx.font = `700 28px ${MONO}`;
  ctx.fillText(`${dogs} dog${dogs === 1 ? '' : 's'} on you`, 20, 20);
}

function drawSecondary(
  ctx: CanvasRenderingContext2D, s: Session, width: number, trainerLabel: string,
): void {
  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `500 16px ${MONO}`;
  ctx.fillText(`${Math.round(s.powerCurrent)} W`, width - 20, 20);
  ctx.fillText(`${(s.speed * 3.6).toFixed(1)} km/h`, width - 20, 40);
  ctx.fillText(`${Math.round(s.distance)} m`, width - 20, 60);
  ctx.fillText(`${Math.round(s.elapsed)} s`, width - 20, 80);
  ctx.fillText(trainerLabel, width - 20, 100);
}
