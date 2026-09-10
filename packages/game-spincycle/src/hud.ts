/**
 * The one thing a rider must be able to read while gasping: what their legs
 * are currently doing to the machine.
 *
 * So the cadence tape is the HUD. It is a strip of the rpm range with the
 * level band marked on it and a needle where you actually are — the same
 * information as the number, but positional, which is far quicker to read
 * than digits when you are at threshold. The word underneath (CLIMB / LEVEL /
 * SINK) is the belt and braces.
 */
import { CADENCE_MISSING_BODY, CADENCE_MISSING_HEADLINE } from '@paperboy/game-core';
import {
  CADENCE_DEADBAND_RPM, NEUTRAL_CADENCE_RPM, climbRate,
} from './session.js';
import type { SpinSession } from './session.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const INK = '#3a2f29';
const INK_DIM = 'rgba(58, 47, 41, 0.55)';
const PAPER = 'rgba(246, 236, 214, 0.92)';
const TAPE_TRACK = 'rgba(58, 47, 41, 0.16)';
const TAPE_LEVEL = 'rgba(120, 151, 91, 0.55)';
const CLIMB_COLOUR = '#2f7d4f';
const SINK_COLOUR = '#c2503d';

/** Ends of the tape. Wider than the useful range so the needle never pins. */
const TAPE_LO_RPM = 40;
const TAPE_HI_RPM = 120;

export function drawHud(
  ctx: CanvasRenderingContext2D, s: SpinSession, width: number, height: number,
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  drawDistance(ctx, s, width);
  drawTape(ctx, s, width);
  if (s.cadence.missing) drawCadenceMissing(ctx, width, height);
  ctx.restore();
}

function drawDistance(
  ctx: CanvasRenderingContext2D, s: SpinSession, width: number,
): void {
  ctx.textAlign = 'right';
  ctx.fillStyle = INK_DIM;
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText('FLOWN', width - 22, 18);
  ctx.fillStyle = INK;
  ctx.font = `800 46px ${MONO}`;
  ctx.fillText(`${Math.round(s.distance)} m`, width - 22, 34);
  ctx.fillStyle = INK_DIM;
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText(
    `${s.cleared} cleared · ${(s.speed * 3.6).toFixed(0)} km/h`, width - 22, 84,
  );
}

function drawTape(
  ctx: CanvasRenderingContext2D, s: SpinSession, width: number,
): void {
  const rpm = s.cadence.rpm;
  const barW = Math.min(460, width * 0.4);
  const barH = 20;
  const x = 24;
  const y = 46;
  const at = (v: number): number =>
    x + ((v - TAPE_LO_RPM) / (TAPE_HI_RPM - TAPE_LO_RPM)) * barW;

  ctx.textAlign = 'left';
  ctx.fillStyle = INK_DIM;
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText('CADENCE', x, 22);

  ctx.fillStyle = TAPE_TRACK;
  ctx.fillRect(x, y, barW, barH);

  // The band that holds you level, drawn as somewhere to aim at.
  const lo = at(NEUTRAL_CADENCE_RPM - CADENCE_DEADBAND_RPM);
  const hi = at(NEUTRAL_CADENCE_RPM + CADENCE_DEADBAND_RPM);
  ctx.fillStyle = TAPE_LEVEL;
  ctx.fillRect(lo, y, Math.max(3, hi - lo), barH);

  ctx.strokeStyle = INK_DIM;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, barW, barH);

  ctx.fillStyle = INK_DIM;
  ctx.font = `600 12px ${MONO}`;
  ctx.fillText('50', at(50) - 8, y + barH + 6);
  ctx.fillText('80', at(80) - 8, y + barH + 6);
  ctx.fillText('110', at(110) - 12, y + barH + 6);

  if (rpm === null) {
    ctx.fillStyle = INK_DIM;
    ctx.font = `700 22px ${MONO}`;
    ctx.fillText('— —', x + barW + 16, y - 4);
    return;
  }

  const rate = climbRate(rpm);
  const colour = rate > 0 ? CLIMB_COLOUR : rate < 0 ? SINK_COLOUR : INK;
  const needle = Math.max(x, Math.min(x + barW, at(rpm)));

  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(needle, y - 3);
  ctx.lineTo(needle - 7, y - 14);
  ctx.lineTo(needle + 7, y - 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(needle - 2, y, 4, barH);

  ctx.font = `800 26px ${MONO}`;
  ctx.fillStyle = INK;
  ctx.fillText(`${Math.round(rpm)}`, x + barW + 16, y - 4);
  ctx.font = `700 16px ${MONO}`;
  ctx.fillStyle = colour;
  ctx.fillText(
    rate > 0 ? `CLIMB ${rate.toFixed(1)}` : rate < 0 ? `SINK ${(-rate).toFixed(1)}` : 'LEVEL',
    x + barW + 16, y + 24,
  );
}

/**
 * Said plainly, in the middle of the screen, because a rider whose trainer
 * has no cadence sensor is otherwise looking at a game that appears broken.
 * The world is held still behind this — see `advance` — so there is nothing
 * to miss while reading it.
 */
export function drawCadenceMissing(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const w = Math.min(620, width - 60);
  const h = 168;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(58, 47, 41, 0.35)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = `800 26px ${MONO}`;
  ctx.fillText(CADENCE_MISSING_HEADLINE, width / 2, y + 26);

  ctx.fillStyle = INK_DIM;
  ctx.font = `600 15px ${MONO}`;
  wrap(ctx, CADENCE_MISSING_BODY, width / 2, y + 68, w - 56, 22);
  ctx.restore();
}

/** Word wrap, because a two-line explanation that runs off the edge is not
 * an explanation. */
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
