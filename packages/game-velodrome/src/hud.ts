import { DISPLAY_FONT, INK, KIT, LABEL_FONT, PALETTE } from './palette.js';
import { metresRemaining } from './race.js';
import type { RaceState } from './race.js';
import { drawTrackMap } from './render.js';
import { drawTabular } from './text.js';

/**
 * The numbers ARE the typography here: watts, distance, gap. Heavy, condensed,
 * and laid out on fixed digit slots so nothing jitters as it changes. Big
 * enough to read while breathing hard. Everything else stays quiet.
 *
 * The lap count is not here — it lives in the middle of the oval, top right,
 * where the loop already says where you are on it. One lap counter, not two.
 *
 * There is deliberately no draft indicator. Whether the rider is sheltered is
 * told by the air on the boards and by the trainer under them; adding a badge
 * here would let a rider read the icon instead of feeling the wheel.
 */

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

  // --- what is left of the race, top centre.
  const toGo = Math.round(metresRemaining(s.player.distance));
  c.fillStyle = INK.text;
  drawTabular(
    c, String(toGo), w / 2, unit * 7.2,
    `800 ${unit * 6}px ${DISPLAY_FONT}`, 'center',
  );
  label(c, 'metres to go', w / 2, unit * 9, 'center');

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

  // --- the oval, top right. Big enough to take in without looking away for
  // long, because it is the only thing that says this is a velodrome and not
  // a road, and it carries the lap.
  const map = Math.min(unit * 22, w * 0.30);
  drawTrackMap(c, s, w - unit * 2 - map, unit * 2.4, map);

  c.restore();
}
