/**
 * The card art.
 *
 * Nothing here can tell whether a poster is any good — that needs eyes. What
 * it can do is hold the contract the hub relies on: every poster draws
 * something, at any size it is given, identically every time, and leaves the
 * context exactly as it found it. A poster that leaked a transform or a
 * clip would quietly corrupt the next card along, and on a page of five
 * cards that is the bug you would spend an afternoon on.
 */
import { describe, expect, it } from 'vitest';
import type { GamePalette } from '@paperboy/game-api';
import { CATALOG } from '../src/catalog.js';
import { fallbackPoster } from '../src/poster.js';

interface Recorder {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: string[];
  /** save() minus restore(). Anything but zero at the end is a leak. */
  depth(): number;
}

/**
 * A canvas context that records instead of drawing. Deliberately hand-rolled
 * rather than a mocking library: the whole point is to know exactly which
 * calls are real and which are counted.
 */
function recorder(): Recorder {
  const calls: string[] = [];
  let depth = 0;

  const gradient = {
    addColorStop(): void { calls.push('addColorStop'); },
  };
  const note = (name: string) => (): void => { calls.push(name); };

  const base: Record<string, unknown> = {
    save(): void { depth += 1; calls.push('save'); },
    restore(): void { depth -= 1; calls.push('restore'); },
    createLinearGradient(): unknown { calls.push('createLinearGradient'); return gradient; },
    createRadialGradient(): unknown { calls.push('createRadialGradient'); return gradient; },
    measureText(): unknown { return { width: 10 }; },
    getTransform(): unknown { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
  };
  for (const name of [
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect',
    'fill', 'stroke', 'fillRect', 'clearRect', 'strokeRect', 'clip',
    'translate', 'rotate', 'scale', 'setTransform', 'fillText', 'strokeText',
    'quadraticCurveTo', 'bezierCurveTo', 'setLineDash', 'drawImage', 'arcTo',
  ]) {
    base[name] = note(name);
  }

  const ctx = new Proxy(base, {
    get(target, prop): unknown {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      // Any property read that is not a method is a style read; give back
      // something plausible rather than undefined.
      return '#000000';
    },
    set(target, prop, value): boolean {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, calls, depth: () => depth };
}

const PALETTE: GamePalette = {
  base: '#123456', accent: '#abcdef', detail: '#fedcba',
};

/** The sizes a card actually gets: wide, narrow, and awkward. */
const SIZES: ReadonlyArray<readonly [number, number]> = [
  [320, 200], [180, 112], [640, 400], [96, 300],
];

describe('every poster in the catalog', () => {
  it('exists, because five cards with generated fallbacks is not a design', () => {
    for (const game of CATALOG) {
      expect(game.poster, `${game.id} has no poster`).toBeTypeOf('function');
    }
  });

  it('draws something at every size a card can be', () => {
    for (const game of CATALOG) {
      for (const [w, h] of SIZES) {
        const r = recorder();
        game.poster?.(r.ctx, w, h);
        const drew = r.calls.filter(
          (c) => c === 'fill' || c === 'fillRect' || c === 'stroke' || c === 'fillText',
        ).length;
        expect(drew, `${game.id} at ${w}x${h}`).toBeGreaterThan(8);
      }
    }
  });

  it('leaves the context as it found it', () => {
    // Five posters share one canvas per card, and the hub draws them in a
    // loop. A poster that forgot a restore() would tip the next one over.
    for (const game of CATALOG) {
      const r = recorder();
      game.poster?.(r.ctx, 320, 200);
      expect(r.depth(), `${game.id} leaked a save()`).toBe(0);
    }
  });

  it('draws the same picture every time it is asked', () => {
    // A poster is a still life. Anything random in one would make the card
    // flicker on every resize.
    for (const game of CATALOG) {
      const a = recorder();
      const b = recorder();
      game.poster?.(a.ctx, 320, 200);
      game.poster?.(b.ctx, 320, 200);
      expect(b.calls, game.id).toEqual(a.calls);
    }
  });
});

describe('fallbackPoster', () => {
  it('gives a game with no poster of its own something printed to wear', () => {
    const r = recorder();
    fallbackPoster(r.ctx, 320, 200, PALETTE, 'Something New');
    expect(r.calls).toContain('fillRect');
    expect(r.calls).toContain('fillText');
    expect(r.depth()).toBe(0);
  });

  it('survives a game with no name to take an initial from', () => {
    const r = recorder();
    fallbackPoster(r.ctx, 320, 200, PALETTE, '   ');
    expect(r.calls).not.toContain('fillText');
    expect(r.depth()).toBe(0);
  });

  it('draws at a size too small to fit its own halftone', () => {
    const r = recorder();
    fallbackPoster(r.ctx, 24, 12, PALETTE, 'X');
    expect(r.calls).toContain('fillRect');
  });
});
