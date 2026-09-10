import { FADE_FROM_FRACTION, wPrimeFraction } from '@paperboy/game-core';
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
const BATTERY_FILL = '#6fa8d8';
/** Where the battery turns red, half again above the model's own fade
 * threshold, so the warning arrives while there is still a shake in it. */
const BATTERY_WARN_BELOW = FADE_FROM_FRACTION * 1.5;

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
): void {
  ctx.save();
  ctx.textBaseline = 'top';

  drawGap(ctx, s.gap, gapTrendMps, width);
  drawShakeProgress(ctx, s, width);
  drawDogCount(ctx, s.dogs, width);
  drawBattery(ctx, s, width);

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
  const trying = s.powerEffective >= threshold;
  const progress = Math.min(1, s.shakeHoldS / SHAKE_HOLD_DURATION_S);

  const barW = Math.min(420, width * 0.5);
  const barH = 26;
  const x = width / 2 - barW / 2;
  const y = 128;

  ctx.textAlign = 'center';
  // A rider whose store is gone cannot reach the threshold however hard they
  // push, so the prompt has to say so — otherwise the shake bar simply stops
  // filling and nothing on screen explains why.
  const empty = s.powerCurrent >= threshold && s.powerEffective < threshold;
  ctx.fillStyle = empty ? SHRINKING : TEXT_DIM;
  ctx.font = `700 16px ${MONO}`;
  ctx.fillText(
    empty
      ? 'NOTHING LEFT TO SHAKE WITH'
      : trying ? 'SHAKING...' : `SPRINT TO SHAKE — ${Math.round(threshold)} W`,
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

/**
 * The anaerobic store, top left, under the dog count.
 *
 * The gap says whether the pack is coming. This says whether you have another
 * sprint in you to stop it — and nothing else on screen can, because an
 * emptying store looks exactly like a full one right up until the shake bar
 * refuses to fill.
 */
function drawBattery(
  ctx: CanvasRenderingContext2D, s: Session, width: number,
): void {
  const left = wPrimeFraction(s.wPrime);
  const low = left < BATTERY_WARN_BELOW;
  const barW = Math.min(220, width * 0.28);
  const x = 20;
  const y = 62;

  ctx.textAlign = 'left';
  ctx.fillStyle = low ? SHRINKING : TEXT_DIM;
  ctx.font = `700 14px ${MONO}`;
  ctx.fillText(`BATTERY ${Math.round(left * 100)}%`, x, y);

  ctx.fillStyle = BAR_TRACK;
  ctx.fillRect(x, y + 20, barW, 12);
  ctx.fillStyle = low ? SHRINKING : BATTERY_FILL;
  ctx.fillRect(x, y + 20, barW * left, 12);
  ctx.fillStyle = TEXT_DIM;
  ctx.fillRect(x + barW * BATTERY_WARN_BELOW, y + 17, 1.5, 18);
}
