/**
 * The status band.
 *
 * The band is the one place watts and cadence are drawn for every game, which
 * is the whole reason it exists: five games cannot disagree about a number
 * none of them owns. These tests hold that the cadence figure is really there
 * in every case the trainer can produce, that "no reading" reads as an absence
 * rather than as a zero, and that the three right-hand figures never overlap.
 */
import { describe, expect, it } from 'vitest';
import { BAND_HEIGHT, drawBand, formatCadence } from '../src/band.js';
import type { BandModel } from '../src/band.js';
import type { TrainerView } from '../src/trainerStatus.js';

const TRAINER: TrainerView = {
  mode: 'controls',
  headline: 'KICKR, resistance control',
  detail: 'Grade and drag are yours to feel.',
  canControlResistance: true,
};

interface Drawn {
  readonly text: string;
  readonly x: number;
  readonly font: string;
  readonly align: string;
  readonly fill: string;
}

interface Recorder {
  readonly ctx: CanvasRenderingContext2D;
  readonly texts: Drawn[];
  depth(): number;
}

/** A context that records the text it is asked to draw, and nothing else. */
function recorder(): Recorder {
  const texts: Drawn[] = [];
  let depth = 0;

  const base: Record<string, unknown> = {
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save(): void { depth += 1; },
    restore(): void { depth -= 1; },
    fillRect(): void { /* the band's own ground */ },
    // Monospace: every glyph is one cell wide, which is exactly the property
    // the band relies on to keep digits from jittering.
    measureText(t: string): unknown { return { width: t.length * 8 }; },
  };
  const ctx = new Proxy(base, {
    get(target, prop: string): unknown {
      if (prop === 'fillText') {
        return (text: string, x: number): void => {
          texts.push({
            text,
            x,
            font: String(target['font']),
            align: String(target['textAlign']),
            fill: String(target['fillStyle']),
          });
        };
      }
      return target[prop];
    },
    set(target, prop: string, value: unknown): boolean {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, texts, depth: () => depth };
}

function model(over: Partial<BandModel> = {}): BandModel {
  return {
    trainer: TRAINER,
    watts: 212,
    cadenceRpm: 88,
    elapsedS: 65,
    lines: [],
    ...over,
  };
}

function draw(over: Partial<BandModel> = {}): Recorder {
  const r = recorder();
  drawBand(r.ctx, model(over), 960, 540);
  return r;
}

function find(r: Recorder, needle: string): Drawn {
  const hit = r.texts.find((t) => t.text.includes(needle));
  expect(hit, `expected the band to draw "${needle}"`).toBeDefined();
  return hit!;
}

describe('formatCadence', () => {
  it('rounds a reading to whole rpm', () => {
    expect(formatCadence(87.4)).toBe('87');
    expect(formatCadence(87.5)).toBe('88');
  });

  it('keeps zero, because not pedalling is a real reading', () => {
    expect(formatCadence(0)).toBe('0');
  });

  it('shows a dash for no reading, never a zero', () => {
    expect(formatCadence(null)).toBe('—');
    expect(formatCadence(Number.NaN)).toBe('—');
  });
});

describe('drawBand', () => {
  it('draws cadence alongside watts', () => {
    const r = draw({ watts: 212, cadenceRpm: 88 });
    expect(find(r, 'rpm').text).toBe('88 rpm');
    expect(find(r, 'W').text).toBe('212 W');
  });

  it('draws the cadence figure in the watts typography', () => {
    const r = draw();
    const rpm = find(r, 'rpm');
    const watts = find(r, 'W');
    expect(rpm.font).toBe(watts.font);
    expect(rpm.align).toBe(watts.align);
  });

  it('shows a dash rather than zero when the trainer reports no cadence', () => {
    const r = draw({ cadenceRpm: null });
    expect(find(r, 'rpm').text).toBe('— rpm');
  });

  it('shows a zero cadence as a zero', () => {
    const r = draw({ cadenceRpm: 0 });
    expect(find(r, 'rpm').text).toBe('0 rpm');
  });

  it('dims the placeholder and lights a real reading', () => {
    const absent = find(draw({ cadenceRpm: null }), 'rpm');
    const present = find(draw({ cadenceRpm: 88 }), 'rpm');
    expect(absent.fill).not.toBe(present.fill);
    expect(present.fill).toBe(find(draw({ cadenceRpm: 88 }), 'W').fill);
  });

  it('keeps the three right-hand figures clear of one another', () => {
    // Right-aligned, so each figure occupies [x - width, x]. A four-digit
    // wattage is the case that would collide if the layout were fixed-offset.
    const r = draw({ watts: 1240, cadenceRpm: 120, elapsedS: 3599 });
    const right = ['rpm', 'W', ':'].map((n) => find(r, n));
    for (const a of right) {
      for (const b of right) {
        if (a === b) continue;
        const overlap = a.x > b.x - b.text.length * 8 && a.x - a.text.length * 8 < b.x;
        expect(overlap, `"${a.text}" overlaps "${b.text}"`).toBe(false);
      }
    }
  });

  it('leaves the context balanced', () => {
    const r = draw();
    expect(r.depth()).toBe(0);
  });

  it('still draws the game rows and the trainer headline', () => {
    const r = draw({ lines: [{ label: 'Lap', value: '2/4' }] });
    expect(find(r, 'Lap').text).toBe('Lap 2/4');
    expect(find(r, 'KICKR')).toBeDefined();
    expect(BAND_HEIGHT).toBeGreaterThan(0);
  });
});
