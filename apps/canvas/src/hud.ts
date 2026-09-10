import { PALETTE } from './render/palette.js';
import type { Session } from './session.js';

export function drawHud(
  ctx: CanvasRenderingContext2D,
  s: Session,
  width: number,
  trainerLabel: string,
): void {
  const w = s.world;
  ctx.save();
  ctx.font = '600 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = PALETTE.hud;

  ctx.fillText(`${w.score.score}`, 20, 18);
  if (w.score.multiplier > 1) {
    ctx.fillStyle = PALETTE.subscriberGlow;
    ctx.fillText(`x${w.score.multiplier}`, 20, 44);
  }

  ctx.fillStyle = PALETTE.hud;
  ctx.fillText(`${w.rider.papers} papers`, 160, 18);
  ctx.fillText('♦'.repeat(w.rider.lives), 160, 44);

  ctx.textAlign = 'right';
  ctx.fillText(`${(w.rider.speed * 3.6).toFixed(1)} km/h`, width - 20, 18);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = '400 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`${Math.round(s.powerCurrent)} W`, width - 20, 46);
  ctx.fillText(`${Math.round(w.rider.distance)} m`, width - 20, 64);
  ctx.fillText(trainerLabel, width - 20, 82);
  ctx.restore();
}
