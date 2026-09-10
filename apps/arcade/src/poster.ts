/**
 * Painting a game's poster onto its card.
 *
 * The art on a card is drawn by the game, with the game's own palette and
 * the game's own drawing code — so a card cannot advertise a scene the game
 * no longer looks like. This file is only the frame around that: it sizes
 * the canvas for the display, hands over a context, and draws a generated
 * panel for any game that has not written a poster yet.
 */
import type { GameModule, GamePalette } from '@paperboy/game-api';

/**
 * The heavy condensed stack, shared with Velodrome's own instruments. System
 * faces only: this project ships no web fonts.
 */
export const DISPLAY_STACK =
  '"Haettenschweiler", "Arial Narrow", "Roboto Condensed", "Oswald", ' +
  'Impact, system-ui, sans-serif';

/** The shape of the art on a card. Wide, like a cabinet's side panel. */
export const POSTER_RATIO = 0.62;

/**
 * The panel a game without a `poster` gets: flat bands of its own three
 * colours, cut on the diagonal, with a halftone across the lower half and
 * its initial dropped in big. Printed rather than apologetic — a future game
 * that ships without art should still look like it belongs on the wall.
 */
export function fallbackPoster(
  ctx: CanvasRenderingContext2D,
  width: number, height: number,
  palette: GamePalette,
  name: string,
): void {
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, width, height);

  // Three diagonal bands. The slant is the whole gesture; keep it consistent.
  const slant = width * 0.28;
  const band = (top: number, depth: number, colour: string): void => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, height * top);
    ctx.lineTo(width, height * top - slant * 0.4);
    ctx.lineTo(width, height * (top + depth) - slant * 0.4);
    ctx.lineTo(0, height * (top + depth));
    ctx.closePath();
    ctx.fill();
  };
  band(0.46, 0.2, palette.accent);
  band(0.68, 0.06, palette.detail);

  // Halftone: the cheapest possible mark of an ink screen, and it stops the
  // flat colour reading as an empty div.
  ctx.fillStyle = palette.detail;
  ctx.globalAlpha = 0.28;
  const step = Math.max(6, height * 0.06);
  for (let y = height * 0.08; y < height * 0.44; y += step) {
    for (let x = step * 0.5; x < width; x += step) {
      const r = step * 0.18 * (1 - (y / height) * 0.9);
      if (r <= 0.2) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // The initial, sat on the bands and cropped by the frame like a poster.
  const letter = name.trim().charAt(0).toUpperCase();
  if (letter !== '') {
    ctx.save();
    ctx.font = `700 ${Math.round(height * 0.78)}px ${DISPLAY_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = palette.detail;
    ctx.globalAlpha = 0.5;
    ctx.fillText(letter, width * 0.06, height * 0.94);
    ctx.restore();
  }
}

/**
 * Draws one card's art at the size the layout gave it.
 *
 * Returns false when the canvas has no box yet — a hidden overlay, a card
 * still laying out — so the caller can leave it and come back rather than
 * baking a zero-sized bitmap into the page.
 */
export function paintPoster(
  canvas: HTMLCanvasElement, game: GameModule, dpr: number,
): boolean {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (cssWidth <= 0 || cssHeight <= 0) return false;

  const scale = Math.min(2, Math.max(1, dpr));
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);

  const ctx = canvas.getContext('2d');
  if (ctx === null) return false;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // The game draws into a box it does not own, so it is clipped and its
  // state is fenced: a poster that forgot a restore() cannot leak a
  // transform onto the next card.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cssWidth, cssHeight);
  ctx.clip();
  if (game.poster === undefined) {
    fallbackPoster(ctx, cssWidth, cssHeight, game.palette, game.name);
  } else {
    game.poster(ctx, cssWidth, cssHeight);
  }
  ctx.restore();
  return true;
}
