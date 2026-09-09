// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardSource } from '../src/sources/keyboardSource.js';
import type { TrainerSample } from '../src/types.js';

function harness() {
  const target = new EventTarget();
  const source = new KeyboardSource({ target, intervalMs: 100 });
  const samples: TrainerSample[] = [];
  source.onSample((s) => samples.push(s));
  const press = () =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
  const release = () =>
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
  return { source, samples, press, release };
}

describe('KeyboardSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('declares itself unable to control resistance', () => {
    expect(new KeyboardSource().canControlResistance).toBe(false);
  });

  it('emits zero power at rest', async () => {
    const h = harness();
    await h.source.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.samples.length).toBeGreaterThan(0);
    expect(h.samples.at(-1)!.power).toBe(0);
  });

  it('ramps power up while the key is held', async () => {
    const h = harness();
    await h.source.start();
    h.press();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.samples.at(-1)!.power).toBeGreaterThan(100);
  });

  it('decays power after the key is released', async () => {
    const h = harness();
    await h.source.start();
    h.press();
    await vi.advanceTimersByTimeAsync(1000);
    const peak = h.samples.at(-1)!.power!;
    h.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.samples.at(-1)!.power!).toBeLessThan(peak);
  });

  it('never exceeds the configured maximum', async () => {
    const target = new EventTarget();
    const source = new KeyboardSource({ target, intervalMs: 100, maxWatts: 300 });
    const samples: TrainerSample[] = [];
    source.onSample((s) => samples.push(s));
    await source.start();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Math.max(...samples.map((s) => s.power!))).toBeLessThanOrEqual(300);
  });

  it('reports a plausible cadence that is zero at zero power', async () => {
    const h = harness();
    await h.source.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.samples.at(-1)!.cadence).toBe(0);
    h.press();
    await vi.advanceTimersByTimeAsync(1000);
    const c = h.samples.at(-1)!.cadence!;
    expect(c).toBeGreaterThan(60);
    expect(c).toBeLessThanOrEqual(110);
  });

  it('accepts setSimulation as a no-op', async () => {
    const h = harness();
    await h.source.start();
    expect(() =>
      h.source.setSimulation({ grade: 5, headwind: 0, crr: 0.004, cw: 0.51 }),
    ).not.toThrow();
  });

  it('stops emitting after stop()', async () => {
    const h = harness();
    await h.source.start();
    await vi.advanceTimersByTimeAsync(300);
    await h.source.stop();
    const n = h.samples.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.samples.length).toBe(n);
  });
});
