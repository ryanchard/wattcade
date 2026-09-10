import { DISPLAY_FONT, INK, KIT, LABEL_FONT, PALETTE } from './palette.js';
import { RACE_LAPS, lapNumber, metresRemaining } from './race.js';
import type { RaceState } from './race.js';
import { drawTrackMap } from './render.js';

/**
 * The numbers ARE the typography here: laps, gap, watts. Heavy, condensed,
 * and laid out on fixed digit slots so nothing jitters as it changes. Big
 * enough to read while breathing hard. Everything else stays quiet.
 *
 * There is deliberately no draft indicator. Whether the rider is sheltered is
 * told by the air on the boards and by the trainer under them; adding a badge
 * here would let a rider read the icon instead of feeling the wheel.
 */

const digitCache = new WeakMap<CanvasRenderingContext2D, Map<string, number>>();

/** Widest digit for a given font — canvas has no font-variant-numeric, so
 * tabular figures have to be laid out by hand. */
function digitWidth(c: CanvasRenderingContext2D, font: string): number {
  let cache = digitCache.get(c);
  if (cache === undefined) {
    cache = new Map();
    digitCache.set(c, cache);
  }
  const hit = cache.get(font);
  if (hit !== undefined) return hit;
  const previous = c.font;
  c.font = font;
  let width = 0;
  for (const d of '0123456789') width = Math.max(width, c.measureText(d).width);
  c.font = previous;
  cache.set(font, width);
  return width;
}

export type TabularAlign = 'left' | 'right' | 'center';

/** Draw text with every digit on a fixed-width slot. Non-digits keep their
 * natural width, so "-12 m" spaces correctly and "12" does not shuffle when
 * it becomes "13". */
export function drawTabular(
  c: CanvasRenderingContext2D, text: string, x: number, y: number,
  font: string, align: TabularAlign = 'left',
): number {
  c.font = font;
  const slot = digitWidth(c, font);
  const widths: number[] = [];
  let total = 0;
  for (const ch of text) {
    const w = ch >= '0' && ch <= '9' ? slot : c.measureText(ch).width;
    widths.push(w);
    total += w;
  }

  let cursor = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  const previousAlign = c.textAlign;
  c.textAlign = 'left';
  let i = 0;
  for (const ch of text) {
    const w = widths[i]!;
    // Digits are centred inside their slot; everything else is drawn as-is.
    const dx = ch >= '0' && ch <= '9' ? (w - c.measureText(ch).width) / 2 : 0;
    c.fillText(ch, cursor + dx, y);
    cursor += w;
    i += 1;
  }
  c.textAlign = previousAlign;
  return total;
}

function label(
  c: CanvasRenderingContext2D, text: string, x: number, y: number,
  align: CanvasTextAlign = 'left', colour: string = INK.textDim,
): void {
  c.font = `600 11px ${LABEL_FONT}`;
  c.textAlign = align;
  c.fillStyle = colour;
  c.letterSpacing = '0.14em';
  c.fillText(text.toUpperCase(), x, y);
  c.letterSpacing = '0px';
  c.textAlign = 'left';
}

export function drawHud(
  c: CanvasRenderingContext2D, s: RaceState, w: number, h: number,
): void {
  const unit = Math.max(10, Math.min(w, h * 1.6) / 100);
  c.save();
  c.textBaseline = 'alphabetic';

  // --- watts, top left. The one number a rider actually steers with.
  const watts = Math.round(s.player.powerCurrent);
  c.fillStyle = INK.text;
  drawTabular(c, String(watts), unit * 2, unit * 7.6, `800 ${unit * 6.4}px ${DISPLAY_FONT}`);
  label(c, 'watts', unit * 2, unit * 9.4);

  // A quiet reference mark: where FTP sits, so the number means something.
  const ftpRatio = s.player.powerCurrent / Math.max(1, s.profile.ftpWatts);
  const barW = unit * 13;
  const barY = unit * 10.4;
  c.fillStyle = 'rgba(255, 244, 220, 0.12)';
  c.fillRect(unit * 2, barY, barW, unit * 0.5);
  c.fillStyle = ftpRatio > 1 ? PALETTE.sprintLine : PALETTE.boards;
  c.fillRect(unit * 2, barY, Math.min(barW, barW * (ftpRatio / 1.6)), unit * 0.5);
  c.fillStyle = INK.textFaint;
  c.fillRect(unit * 2 + barW / 1.6, barY - unit * 0.25, 1.5, unit);

  // --- laps, top centre.
  const lap = lapNumber(s.player.distance);
  c.fillStyle = INK.text;
  drawTabular(
    c, `${lap}/${RACE_LAPS}`, w / 2, unit * 7.2,
    `800 ${unit * 6}px ${DISPLAY_FONT}`, 'center',
  );
  label(c, 'lap', w / 2, unit * 9, 'center');

  const toGo = Math.round(metresRemaining(s.player.distance));
  c.fillStyle = INK.textDim;
  drawTabular(
    c, `${toGo} m to go`, w / 2, unit * 11,
    `600 ${unit * 2}px ${DISPLAY_FONT}`, 'center',
  );

  // --- the gap, bottom centre. Big, signed, and always in the same place.
  const gap = s.gap;
  const leading = gap >= 0;
  const magnitude = Math.abs(gap);
  const shown = magnitude < 100 ? magnitude.toFixed(1) : String(Math.round(magnitude));
  c.fillStyle = leading ? INK.text : PALETTE.sprintLine;
  drawTabular(
    c, shown, w / 2, h - unit * 5.6,
    `800 ${unit * 7}px ${DISPLAY_FONT}`, 'center',
  );
  label(
    c, leading ? 'metres ahead' : 'metres down', w / 2, h - unit * 3.8,
    'center', leading ? INK.textDim : 'rgba(194, 55, 47, 0.85)',
  );

  // --- speed, bottom left.
  const kph = s.player.speed * 3.6;
  c.fillStyle = INK.text;
  drawTabular(
    c, kph.toFixed(1), unit * 2, h - unit * 4.2,
    `800 ${unit * 4}px ${DISPLAY_FONT}`,
  );
  label(c, 'km/h', unit * 2, h - unit * 2.6);

  // --- the rival, bottom right.
  c.textAlign = 'right';
  c.fillStyle = INK.text;
  c.font = `700 ${unit * 2.4}px ${DISPLAY_FONT}`;
  c.fillText(s.spec.name.toUpperCase(), w - unit * 2, h - unit * 4.2);
  label(c, 'the rival', w - unit * 2, h - unit * 2.6, 'right');
  c.textAlign = 'left';

  // A stripe of the rival's colour, so the dot on the map and the rider on
  // the boards are unmistakably the same person.
  c.fillStyle = KIT.rivalAccent;
  c.fillRect(w - unit * 2, h - unit * 3.6, unit * 0.4, unit * 0.4);

  // --- the oval, top right.
  drawTrackMap(c, s, w - unit * 2 - unit * 16, unit * 4, unit * 16);
  label(c, 'the loop', w - unit * 2, unit * 3, 'right', INK.textFaint);

  c.restore();
}
