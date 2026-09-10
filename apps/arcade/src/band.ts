/**
 * The status band: a strip along the bottom of the screen that says the same
 * things in the same places in every game.
 *
 * The shell reserves this height and renders the game into what is left, so a
 * game never has to know the band exists and the band never lands on top of a
 * game's own HUD.
 */
import type { HudLine } from '@paperboy/game-api';
import type { TrainerView } from './trainerStatus.js';

/** Height of the band, in CSS pixels. */
export const BAND_HEIGHT = 34;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const GROUND = '#0B0D10';
const TEXT = '#E8E6E1';
const DIM = 'rgba(232, 230, 225, 0.55)';
/** Amber, for a trainer that reads watts but cannot push back. */
const WARN = '#E0A756';
const BAD = '#E0614A';

function statusColour(view: TrainerView): string {
  switch (view.mode) {
    case 'controls': return TEXT;
    case 'readonly':
    case 'keyboard': return WARN;
    case 'lost': return BAD;
    default: return DIM;
  }
}

export interface BandModel {
  readonly trainer: TrainerView;
  readonly watts: number;
  readonly elapsedS: number;
  readonly lines: readonly HudLine[];
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function drawBand(
  ctx: CanvasRenderingContext2D, model: BandModel, width: number, height: number,
): void {
  const top = height - BAND_HEIGHT;
  ctx.save();
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, top, width, BAND_HEIGHT);
  ctx.fillStyle = 'rgba(232, 230, 225, 0.12)';
  ctx.fillRect(0, top, width, 1);

  ctx.textBaseline = 'middle';
  const mid = top + BAND_HEIGHT / 2;

  // Left: what the trainer can do. Plain words, in every game, always here.
  ctx.textAlign = 'left';
  ctx.font = `500 13px ${MONO}`;
  ctx.fillStyle = statusColour(model.trainer);
  ctx.fillText(model.trainer.headline, 16, mid);

  // Right: watts and the clock, tabular so neither jitters as it counts.
  ctx.textAlign = 'right';
  ctx.font = `600 14px ${MONO}`;
  ctx.fillStyle = TEXT;
  const right = width - 16;
  ctx.fillText(clock(model.elapsedS), right, mid);
  const clockWidth = ctx.measureText(clock(model.elapsedS)).width;
  ctx.fillText(`${Math.round(model.watts)} W`, right - clockWidth - 22, mid);

  // Middle: whatever this game asked the shell to show.
  if (model.lines.length > 0) {
    ctx.textAlign = 'center';
    ctx.font = `500 13px ${MONO}`;
    ctx.fillStyle = DIM;
    const text = model.lines
      .map((l) => `${l.label} ${l.value}`)
      .join('   ·   ');
    ctx.fillText(text, width / 2, mid);
  }

  ctx.restore();
}

/**
 * The paused banner. It says what is true — the trainer is already flat —
 * because a rider who cannot feel resistance needs to know whether that is
 * the pause or a fault.
 */
export function drawPaused(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(11, 13, 16, 0.72)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT;
  ctx.font = `700 34px ${MONO}`;
  ctx.fillText('Paused', width / 2, height / 2 - 16);
  ctx.fillStyle = DIM;
  ctx.font = `400 15px ${MONO}`;
  ctx.fillText('The trainer is flat. P to ride on, Esc to stop.', width / 2, height / 2 + 20);
  ctx.restore();
}
