import { describe, expect, it } from 'vitest';
import {
  ATTACKER, CHAMPION, DIESEL, FEINTER, FLYER, LADDER, WHEELSUCKER,
  CHAMPION_COVER_CEILING, SHELTER_MIN_FRACTION,
  createMoveMemory, moveOutput, rivalById, rivalPowerFraction,
} from '../src/rivals.js';
import type { RivalContext, RivalMove } from '../src/rivals.js';

function ctx(over: Partial<RivalContext> = {}): RivalContext {
  return {
    t: 0, progress: 0, gap: 0, closingRate: 0, playerEffort: 1,
    shelterSaving: 0, battery: 1, playerBattery: 1, ...over,
  };
}

describe('the ladder', () => {
  it('has six rivals, each with a name, a tell and a counter', () => {
    expect(LADDER).toHaveLength(6);
    for (const spec of LADDER) {
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.line.length).toBeGreaterThan(0);
      expect(spec.tell.length).toBeGreaterThan(0);
      expect(spec.counter.length).toBeGreaterThan(0);
    }
  });

  it('has unique ids and looks them up', () => {
    const ids = new Set(LADDER.map((r) => r.id));
    expect(ids.size).toBe(6);
    expect(rivalById('feinter')).toBe(FEINTER);
    expect(rivalById('nobody')).toBeNull();
  });
});

describe('move shapes', () => {
  const fake: RivalMove =
    { at: 0, kind: 'fake', amplitude: 0.5, riseS: 0.8, durationS: 2.6 };
  const real: RivalMove =
    { at: 0, kind: 'real', amplitude: 0.5, riseS: 2.5, durationS: 14 };
  const surge: RivalMove =
    { at: 0, kind: 'surge', amplitude: 0.5, riseS: 1, durationS: 9 };

  it('a fake decays away within a couple of seconds — that is the tell', () => {
    expect(moveOutput(fake, 0.8)).toBeCloseTo(0.5, 6);
    // Already collapsing one second after the peak...
    expect(moveOutput(fake, 1.8)).toBeLessThan(0.15);
    // ...and gone entirely by the end.
    expect(moveOutput(fake, 2.6)).toBe(0);
    expect(moveOutput(fake, 5)).toBe(0);
  });

  it('a real move keeps building after its peak', () => {
    const atPeak = moveOutput(real, 2.5);
    const later = moveOutput(real, 8);
    const latest = moveOutput(real, 13.9);
    expect(later).toBeGreaterThan(atPeak);
    expect(latest).toBeGreaterThan(later);
    expect(moveOutput(real, 14)).toBe(0);
  });

  it('fake and real are indistinguishable during the rise', () => {
    // Both are climbing at t = 0.4 s; only time separates them.
    expect(moveOutput(fake, 0.4)).toBeGreaterThan(0);
    expect(moveOutput(real, 0.4)).toBeGreaterThan(0);
  });

  it('a surge holds its amplitude then stops', () => {
    expect(moveOutput(surge, 1)).toBeCloseTo(0.5, 6);
    expect(moveOutput(surge, 5)).toBeCloseTo(0.5, 6);
    expect(moveOutput(surge, 9)).toBe(0);
  });

  it('contributes nothing before it fires', () => {
    expect(moveOutput(fake, -1)).toBe(0);
  });
});

describe('the Diesel', () => {
  it('never varies its power, whatever the player does', () => {
    const memory = createMoveMemory(DIESEL);
    const samples = [0, 0.25, 0.5, 0.75, 0.99].map((progress) =>
      rivalPowerFraction(
        DIESEL,
        ctx({ progress, t: progress * 90, gap: progress * 10 - 5, playerEffort: 1.6 }),
        memory,
      ));
    for (const f of samples) expect(f).toBeCloseTo(samples[0]!, 10);
  });
});

describe('the Flyer', () => {
  it('opens far above anything anyone sustains, and fades to well under', () => {
    const memory = createMoveMemory(FLYER);
    const open = rivalPowerFraction(FLYER, ctx({ progress: 0.02 }), memory);
    const late = rivalPowerFraction(FLYER, ctx({ progress: 0.95 }), memory);
    expect(open).toBeGreaterThan(1.35);
    expect(late).toBeLessThan(0.65);
  });

  it('fades monotonically after the opening — no second wind', () => {
    const memory = createMoveMemory(FLYER);
    let previous = Infinity;
    for (let p = 0.15; p <= 1.0001; p += 0.05) {
      const f = rivalPowerFraction(FLYER, ctx({ progress: p }), memory);
      expect(f).toBeLessThanOrEqual(previous + 1e-9);
      previous = f;
    }
  });
});

describe('the Attacker', () => {
  it('surges five times with a soft patch behind each', () => {
    const memory = createMoveMemory(ATTACKER);
    const base = rivalPowerFraction(ATTACKER, ctx({ progress: 0.05, t: 0 }), memory);

    // Fire the first attack and hold it.
    const attacking = rivalPowerFraction(
      ATTACKER, ctx({ progress: 0.12, t: 10 }), memory,
    );
    const peak = rivalPowerFraction(
      ATTACKER, ctx({ progress: 0.14, t: 14 }), memory,
    );
    expect(peak).toBeGreaterThan(base + 0.4);
    expect(attacking).toBeLessThan(peak);

    // ...then the recovery that punishes anyone who covered it flat out.
    const recovering = rivalPowerFraction(
      ATTACKER, ctx({ progress: 0.2, t: 23 }), memory,
    );
    expect(recovering).toBeLessThan(base);

    expect(ATTACKER.moves).toHaveLength(5);
  });
});

describe('the Feinter', () => {
  it('fires the bluffs and the real moves off the same schedule', () => {
    expect(FEINTER.moves.filter((m) => m.kind === 'fake')).toHaveLength(4);
    expect(FEINTER.moves.filter((m) => m.kind === 'real')).toHaveLength(2);
  });

  it('a bluff is gone by the time you could have answered it', () => {
    const memory = createMoveMemory(FEINTER);
    const before = rivalPowerFraction(FEINTER, ctx({ progress: 0.05, t: 0 }), memory);
    // The bluff fires here; it contributes nothing at the instant it starts.
    rivalPowerFraction(FEINTER, ctx({ progress: 0.10, t: 10 }), memory);
    const bluffPeak = rivalPowerFraction(
      FEINTER, ctx({ progress: 0.105, t: 10.8 }), memory,
    );
    const threeSecondsLater = rivalPowerFraction(
      FEINTER, ctx({ progress: 0.12, t: 13 }), memory,
    );
    expect(bluffPeak).toBeGreaterThan(before + 0.4);
    expect(threeSecondsLater).toBeLessThan(before + 0.05);
  });

  it('the real move is still climbing when a bluff would have died', () => {
    const memory = createMoveMemory(FEINTER);
    // Walk the schedule up to the first real move at progress 0.40.
    rivalPowerFraction(FEINTER, ctx({ progress: 0.05, t: 0 }), memory);
    const fired = rivalPowerFraction(FEINTER, ctx({ progress: 0.40, t: 40 }), memory);
    const atThree = rivalPowerFraction(FEINTER, ctx({ progress: 0.42, t: 43 }), memory);
    const atTen = rivalPowerFraction(FEINTER, ctx({ progress: 0.5, t: 50 }), memory);
    expect(atThree).toBeGreaterThan(fired);
    expect(atTen).toBeGreaterThan(atThree);
  });
});

describe('the Wheelsucker', () => {
  it('soft-pedals rather than lead when the player drops in behind', () => {
    const memory = createMoveMemory(WHEELSUCKER);
    const f = rivalPowerFraction(
      WHEELSUCKER, ctx({ progress: 0.4, t: 40, gap: -3 }), memory,
    );
    expect(f).toBeCloseTo(SHELTER_MIN_FRACTION, 6);
  });

  it('backs off the instant it comes level, so it cannot come past', () => {
    const memory = createMoveMemory(WHEELSUCKER);
    const f = rivalPowerFraction(
      WHEELSUCKER, ctx({ progress: 0.4, t: 40, gap: 0.4 }), memory,
    );
    expect(f).toBeCloseTo(SHELTER_MIN_FRACTION, 6);
  });

  it('chases back up when it slips out of the shelter', () => {
    const memory = createMoveMemory(WHEELSUCKER);
    const holding = rivalPowerFraction(
      WHEELSUCKER, ctx({ progress: 0.4, t: 40, gap: 2 }), memory,
    );
    const dropped = rivalPowerFraction(
      WHEELSUCKER, ctx({ progress: 0.4, t: 40, gap: 8, closingRate: 1.5 }), memory,
    );
    expect(dropped).toBeGreaterThan(holding);
  });

  it('jumps very late, and the jump overrides keeping station', () => {
    const memory = createMoveMemory(WHEELSUCKER);
    const before = rivalPowerFraction(
      WHEELSUCKER, ctx({ progress: 0.89, t: 80, gap: 2 }), memory,
    );
    const jumping = rivalPowerFraction(
      WHEELSUCKER, ctx({ progress: 0.91, t: 82, gap: 2 }), memory,
    );
    expect(before).toBeLessThan(1.2);
    expect(jumping).toBeCloseTo(WHEELSUCKER.jump!.fraction, 6);
  });
});

describe('the Champion', () => {
  it('covers an attack, up to a ceiling a strong rider can beat', () => {
    const memory = createMoveMemory(CHAMPION);
    const steady = rivalPowerFraction(
      CHAMPION, ctx({ progress: 0.3, t: 30, playerEffort: 1.0, gap: 0 }), memory,
    );
    const covering = rivalPowerFraction(
      CHAMPION, ctx({ progress: 0.3, t: 30, playerEffort: 1.3, gap: 0 }), memory,
    );
    const enormous = rivalPowerFraction(
      CHAMPION, ctx({ progress: 0.3, t: 30, playerEffort: 1.9, gap: 0 }), memory,
    );
    expect(covering).toBeGreaterThan(steady);
    expect(enormous).toBeLessThanOrEqual(CHAMPION_COVER_CEILING + 1e-9);
  });

  it('attacks when the player eases', () => {
    const memory = createMoveMemory(CHAMPION);
    const steady = rivalPowerFraction(
      CHAMPION, ctx({ progress: 0.3, t: 30, playerEffort: 1.0 }), memory,
    );
    const punishing = rivalPowerFraction(
      CHAMPION, ctx({ progress: 0.3, t: 30, playerEffort: 0.7 }), memory,
    );
    expect(punishing).toBeGreaterThan(steady);
  });

  it('sprints in the last 100 m only when the race is still close', () => {
    const close = rivalPowerFraction(
      CHAMPION,
      ctx({ progress: 0.95, t: 95, gap: 4, playerEffort: 1.0 }),
      createMoveMemory(CHAMPION),
    );
    const gone = rivalPowerFraction(
      CHAMPION,
      ctx({ progress: 0.95, t: 95, gap: 120, playerEffort: 1.0 }),
      createMoveMemory(CHAMPION),
    );
    expect(close).toBeGreaterThan(1.5);
    expect(gone).toBeLessThan(1.3);
  });
});

describe('power bounds', () => {
  it('never goes negative and never exceeds the ceiling', () => {
    for (const spec of LADDER) {
      const memory = createMoveMemory(spec);
      for (let p = 0; p <= 1.0001; p += 0.02) {
        for (const effort of [0, 1, 3]) {
          for (const gap of [-40, -2, 0, 2, 40]) {
            const f = rivalPowerFraction(
              spec,
              ctx({ progress: p, t: p * 100, gap, playerEffort: effort }),
              memory,
            );
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThanOrEqual(2.2);
          }
        }
      }
    }
  });
});
