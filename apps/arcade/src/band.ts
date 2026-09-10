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
  /** Cadence as the trainer last reported it, or null when it reports none. */
  readonly cadenceRpm: number | null;
  /**
   * The virtual gear the shell is applying, or null when this game is
   * single-speed and the gear is doing nothing. Shown next to the watts it
   * changes, because a rider who just shifted needs to see what they changed.
   */
  readonly gear: number | null;
  readonly elapsedS: number;
  readonly lines: readonly HudLine[];
}

/**
 * Cadence for the band. Null gets an em dash rather than a zero, because a
 * trainer that reports no cadence and a rider who has stopped pedalling are
 * different facts and only one of them is the rider's fault. Every game reads
 * this same figure from this one place, so the number can never disagree with
 * itself between games.
 */
export function formatCadence(rpm: number | null): string {
  if (rpm === null || !Number.isFinite(rpm)) return '—';
  return String(Math.round(rpm));
}

/**
 * The gear for the band. Null gets an em dash, the same as an absent cadence
 * and for the same reason: a single-speed game is not in gear 0, it is a game
 * that does not have gears, and a number would invite a rider to try to move
 * it.
 */
export function formatGear(gear: number | null): string {
  if (gear === null || !Number.isFinite(gear)) return '—';
  return String(Math.round(gear));
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

  // Right: cadence, watts and the clock, tabular so none of them jitters as
  // it counts. Laid out right to left, each figure clearing the one before it,
  // so a four-digit wattage cannot shunt the cadence into the game's own HUD.
  ctx.textAlign = 'right';
  ctx.font = `600 14px ${MONO}`;
  ctx.fillStyle = TEXT;
  let cursor = width - 16;
  const clockText = clock(model.elapsedS);
  ctx.fillText(clockText, cursor, mid);
  cursor -= ctx.measureText(clockText).width + 22;
  const wattsText = `${Math.round(model.watts)} W`;
  ctx.fillText(wattsText, cursor, mid);
  cursor -= ctx.measureText(wattsText).width + 22;
  // Dimmed when there is no reading, so "no cadence sensor" looks like the
  // absence it is rather than a number the rider should be trying to move.
  ctx.fillStyle = model.cadenceRpm === null ? DIM : TEXT;
  const cadenceText = `${formatCadence(model.cadenceRpm)} rpm`;
  ctx.fillText(cadenceText, cursor, mid);
  cursor -= ctx.measureText(cadenceText).width + 22;
  // Dimmed for a single-speed game, so "this game has no gears" looks like
  // the absence it is rather than a control the rider is failing to find.
  ctx.fillStyle = model.gear === null ? DIM : TEXT;
  ctx.fillText(`gear ${formatGear(model.gear)}`, cursor, mid);

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
