/**
 * What a fish needs to know, in the order it needs to know it.
 *
 * Your size is first and biggest, because it is the number every decision in
 * the game is measured against. Next to it is a size bar: your own length
 * drawn against the rungs of the ladder, so you can see which rungs you have
 * already grown past without doing arithmetic at threshold.
 *
 * The cadence tape says where in the water your legs are pointing you, which
 * matters most in the second before you commit to a gap.
 */
import { CADENCE_MISSING_BODY, CADENCE_MISSING_HEADLINE } from '@paperboy/game-core';
import {
  CADENCE_HIGH_RPM, CADENCE_LOW_RPM, FISH_TIERS, TANK_DEPTH_M, depthFor,
} from './session.js';
import type { FishSession } from './session.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const TEXT = '#eaf7ff';
const TEXT_DIM = 'rgba(234, 247, 255, 0.6)';
const TRACK = 'rgba(234, 247, 255, 0.18)';
const YOU = '#ff9d4d';
const SAFE = '#8ff0c4';
const DANGER = '#e0503f';
const PANEL = 'rgba(5, 32, 58, 0.95)';

export function drawHud(
  ctx: CanvasRenderingContext2D, s: FishSession, width: number, height: number,
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  drawSize(ctx, s);
  drawTape(ctx, s, width, height);
  if (s.cadence.missing) drawCadenceMissing(ctx, width, height);
  ctx.restore();
}

function drawSize(ctx: CanvasRenderingContext2D, s: FishSession): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText('YOU ARE', 24, 18);

  ctx.fillStyle = YOU;
  ctx.font = `800 44px ${MONO}`;
  ctx.fillText(`${s.size.toFixed(2)} m`, 24, 34);

  ctx.fillStyle = TEXT_DIM;
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText(`${s.eaten} eaten · ${Math.round(s.distance)} m swum`, 24, 84);

  drawLadder(ctx, s, 24, 110);
}

/**
 * The absolute size ladder, with the rungs you have grown past filled in.
 * This is what makes the difficulty curve legible: the sea does not get
 * harder, you get bigger, and here is the proof.
 */
function drawLadder(
  ctx: CanvasRenderingContext2D, s: FishSession, x: number, y: number,
): void {
  const cell = 22;
  const gap = 5;
  for (let i = 0; i < FISH_TIERS.length; i++) {
    const tier = FISH_TIERS[i] ?? 0;
    const past = tier < s.size;
    const cx = x + i * (cell + gap);
    const h = 6 + (i / (FISH_TIERS.length - 1)) * 16;
    ctx.fillStyle = past ? SAFE : DANGER;
    ctx.globalAlpha = past ? 0.9 : 0.5;
    ctx.fillRect(cx, y + (22 - h), cell, h);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `600 12px ${MONO}`;
  ctx.fillText('smaller than you', x, y + 28);
}

function drawTape(
  ctx: CanvasRenderingContext2D, s: FishSession, width: number, height: number,
): void {
  const rpm = s.cadence.rpm;
  const barW = 12;
  const barH = Math.min(300, height * 0.44);
  const x = width - 84;
  const y = (height - barH) / 2;

  ctx.textAlign = 'center';
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `600 13px ${MONO}`;
  ctx.fillText('CADENCE', x + barW / 2, y - 42);
  ctx.fillText(`${CADENCE_HIGH_RPM}`, x + barW / 2, y - 20);
  ctx.fillText(`${CADENCE_LOW_RPM}`, x + barW / 2, y + barH + 8);

  ctx.fillStyle = TRACK;
  ctx.fillRect(x, y, barW, barH);

  // The tape runs top-to-bottom the same way the water does, so the marker
  // sits at the height the cadence is asking for. No mental rotation.
  const depthToY = (depth: number): number =>
    y + (depth / TANK_DEPTH_M) * barH;

  if (rpm === null) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `700 18px ${MONO}`;
    ctx.fillText('—', x + barW / 2, y + barH / 2 - 10);
    return;
  }

  const markY = depthToY(depthFor(rpm));
  ctx.fillStyle = YOU;
  ctx.fillRect(x - 6, markY - 3, barW + 12, 6);

  // Where you actually are, which lags the mark by a fraction of a second.
  ctx.strokeStyle = 'rgba(234, 247, 255, 0.8)';
  ctx.lineWidth = 2;
  const nowY = depthToY(s.depth);
  ctx.beginPath();
  ctx.moveTo(x - 10, nowY);
  ctx.lineTo(x + barW + 10, nowY);
  ctx.stroke();

  ctx.fillStyle = TEXT;
  ctx.font = `800 20px ${MONO}`;
  ctx.fillText(`${Math.round(rpm)}`, x + barW / 2, y + barH + 26);
}

export function drawCadenceMissing(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const w = Math.min(620, width - 60);
  const h = 168;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(5, 32, 58, 0.6)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = PANEL;
  ctx.strokeStyle = SAFE;
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT;
  ctx.font = `800 26px ${MONO}`;
  ctx.fillText(CADENCE_MISSING_HEADLINE, width / 2, y + 26);

  ctx.fillStyle = TEXT_DIM;
  ctx.font = `600 15px ${MONO}`;
  wrap(ctx, CADENCE_MISSING_BODY, width / 2, y + 68, w - 56, 22);
  ctx.restore();
}

function wrap(
  ctx: CanvasRenderingContext2D, text: string, cx: number, top: number,
  maxWidth: number, lineHeight: number,
): void {
  const words = text.split(' ');
  let line = '';
  let y = top;
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    if (ctx.measureText(next).width > maxWidth && line !== '') {
      ctx.fillText(line, cx, y);
      y += lineHeight;
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') ctx.fillText(line, cx, y);
}
