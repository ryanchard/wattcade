/**
 * Numbers are the typography in this game, and canvas has no
 * font-variant-numeric. So tabular figures are laid out by hand here, once,
 * for everything that draws a number: the HUD panel and the scene's own
 * off-screen gap marker both come through this.
 */

const digitCache = new WeakMap<CanvasRenderingContext2D, Map<string, number>>();

/** Widest digit for a given font — the slot every digit is centred in. */
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
 * it becomes "13". Returns the total width drawn. */
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
