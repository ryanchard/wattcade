import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ReplaySource, parseCapture } from '../src/sources/replaySource.js';
import type { Capture } from '../src/sources/replaySource.js';
import type { TrainerSample } from '../src/types.js';
import { parseIndoorBikeData } from '../src/ftms/indoorBikeData.js';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function decodeAll(cap: Capture) {
  return cap.frames.map((f) => {
    const bytes = new Uint8Array(f.hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(f.hex.slice(i * 2, i * 2 + 2), 16);
    }
    return parseIndoorBikeData(new DataView(bytes.buffer));
  });
}

/** flags 0x0044, speed 3000, cadence 180, power 250. */
const FRAME_HEX = '4400b80bb400fa00';

const twoFrames: Capture = {
  version: 1,
  device: 'KICKR TEST',
  recordedAt: '2026-09-10T10:00:00.000Z',
  frames: [
    { t: 1000, hex: FRAME_HEX },
    { t: 1500, hex: FRAME_HEX },
  ],
};

describe('ReplaySource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('declares itself unable to control resistance', () => {
    expect(new ReplaySource(twoFrames).canControlResistance).toBe(false);
  });

  it('replays frames decoded through the real parser', async () => {
    const src = new ReplaySource(twoFrames);
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.power).toBe(250);
    expect(samples[0]!.cadence).toBe(90);
  });

  it('honours the original inter-frame timing', async () => {
    const src = new ReplaySource(twoFrames);
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(samples).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(samples).toHaveLength(2);
  });

  it('compresses timing when a rate above 1 is given', async () => {
    const src = new ReplaySource(twoFrames, { rate: 5 });
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(samples).toHaveLength(2);
  });

  it('loops back to the start when looping is enabled', async () => {
    const src = new ReplaySource(twoFrames, { loop: true });
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(samples.length).toBeGreaterThan(4);
  });

  it('stops emitting after stop()', async () => {
    const src = new ReplaySource(twoFrames, { loop: true });
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(1000);
    await src.stop();
    const n = samples.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(samples.length).toBe(n);
  });
});

describe('parseCapture', () => {
  it('accepts a well-formed capture', () => {
    expect(parseCapture(twoFrames).frames).toHaveLength(2);
  });

  it('rejects a capture with the wrong version', () => {
    expect(() => parseCapture({ ...twoFrames, version: 2 })).toThrow(/version/i);
  });

  it('rejects a capture with no frames array', () => {
    expect(() => parseCapture({ version: 1, device: 'x', recordedAt: 'y' }))
      .toThrow(/frames/i);
  });

  it('rejects a frame with odd-length hex, naming the frame index', () => {
    expect(() =>
      parseCapture({
        ...twoFrames,
        frames: [{ t: 1000, hex: FRAME_HEX }, { t: 1500, hex: 'abc' }],
      }),
    ).toThrow(/frame 1\b.*(odd|hex)/i);
  });

  it('rejects a frame with non-hex characters, naming the frame index', () => {
    expect(() =>
      parseCapture({
        ...twoFrames,
        frames: [{ t: 1000, hex: 'zzzzzzzzzzzzzzzz' }],
      }),
    ).toThrow(/frame 0\b.*hex/i);
  });

  it('rejects a frame missing hex entirely, naming the frame index', () => {
    expect(() =>
      parseCapture({
        ...twoFrames,
        frames: [{ t: 1000, hex: FRAME_HEX }, { t: 1500 }],
      }),
    ).toThrow(/frame 1\b.*hex/i);
  });

  it('rejects a frame with a non-numeric t, naming the frame index', () => {
    expect(() =>
      parseCapture({
        ...twoFrames,
        frames: [{ t: '1000', hex: FRAME_HEX }],
      }),
    ).toThrow(/frame 0\b.*t\b/i);
  });

  it('still accepts the existing valid fixtures', () => {
    expect(parseCapture(twoFrames).frames).toHaveLength(2);
    const cap = parseCapture(
      JSON.parse(readFileSync(fixture('sample-capture.json'), 'utf8')),
    );
    expect(cap.frames).toHaveLength(120);
  });
});

describe('synthetic capture', () => {
  it('round-trips through the parser with plausible values', () => {
    const cap = parseCapture(
      JSON.parse(readFileSync(fixture('sample-capture.json'), 'utf8')),
    );
    expect(cap.frames.length).toBe(120);

    const decoded = decodeAll(cap);
    for (const d of decoded) {
      expect(d.instantaneousPower).toBeGreaterThanOrEqual(0);
      expect(d.instantaneousPower).toBeLessThan(600);
      expect(d.instantaneousCadence).toBeLessThanOrEqual(110);
      expect(d.instantaneousSpeed).toBeGreaterThan(0);
      expect(d.instantaneousSpeed).toBeLessThan(30);
    }
    // The generated ride surges, so it must not be a flat line -- otherwise
    // this fixture would pass even against a parser that returned constants.
    const powers = decoded.map((d) => d.instantaneousPower ?? 0);
    expect(Math.max(...powers) - Math.min(...powers)).toBeGreaterThan(50);
  });
});

const REAL_CAPTURE = fixture('kickr-capture.json');

// Skipped until someone runs the Milestone 0 probe (see
// tools/ble-probe/README.md) and commits a capture. It then activates by
// itself -- no code change needed.
describe.skipIf(!existsSync(REAL_CAPTURE))('recorded KICKR capture', () => {
  it('decodes every frame to plausible values', () => {
    const cap = parseCapture(JSON.parse(readFileSync(REAL_CAPTURE, 'utf8')));
    expect(cap.frames.length).toBeGreaterThan(50);

    for (const d of decodeAll(cap)) {
      if (d.instantaneousPower !== null) {
        expect(d.instantaneousPower).toBeGreaterThanOrEqual(-50);
        expect(d.instantaneousPower).toBeLessThan(2000);
      }
      if (d.instantaneousCadence !== null) {
        expect(d.instantaneousCadence).toBeLessThan(200);
      }
      if (d.instantaneousSpeed !== null) {
        expect(d.instantaneousSpeed).toBeLessThan(30);
      }
    }
  });
});
