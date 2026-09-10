import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { advance, createRace } from '../src/race.js';
import { CHAMPION } from '../src/rivals.js';
import { createRenderState, renderScene, updateRenderState } from '../src/render.js';
import { drawHud } from '../src/hud.js';

interface Rec { calls: string[]; bad: string[] }

function stub(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { calls: [], bad: [] };
  const grad = {
    addColorStop(offset: number): void {
      if (!Number.isFinite(offset)) rec.bad.push('addColorStop');
    },
  };
  const target: Record<string, unknown> = {
    font: '', textAlign: 'left', textBaseline: 'alphabetic', letterSpacing: '0px',
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', globalAlpha: 1,
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]): unknown => {
        rec.calls.push(prop);
        for (const a of args) {
          if (typeof a === 'number' && !Number.isFinite(a)) rec.bad.push(`${prop}(${String(a)})`);
        }
        if (prop === 'measureText') return { width: 10 };
        if (prop.startsWith('create')) return grad;
        return undefined;
      };
    },
    set(t, prop: string, value: unknown) {
      if (typeof value === 'number' && !Number.isFinite(value)) rec.bad.push(`set ${prop}`);
      if (typeof value === 'string' && value.includes('NaN')) rec.bad.push(`set ${prop}=${value}`);
      t[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy(target, handler) as unknown as CanvasRenderingContext2D, rec };
}

describe('the whole picture', () => {
  for (const [w, h] of [[1400, 800], [640, 400], [900, 1100]] as const) {
    it(`draws a race at ${w}x${h} without a single non-finite coordinate`, () => {
      const s = createRace({ ...DEFAULT_RIDER, ftpWatts: 240 }, CHAMPION);
      const r = createRenderState();
      const { ctx, rec } = stub();
      for (let i = 0; i < 400; i++) {
        s.player.powerTarget = 300;
        s.player.powerCurrent = 300;
        advance(s, 1 / 30);
        // Sweep the gap across everything the camera has to handle.
        s.gap = Math.sin(i / 40) * 260;
        updateRenderState(r, s, w, h, 1 / 30);
        renderScene(ctx, s, r, w, h);
        drawHud(ctx, s, w, h);
      }
      expect(rec.bad).toEqual([]);
      expect(rec.calls.length).toBeGreaterThan(1000);
    });
  }
});
