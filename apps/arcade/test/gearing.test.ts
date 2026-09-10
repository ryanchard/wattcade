/**
 * The virtual gear.
 *
 * Two of these are safety tests and the rest are the reason the feature
 * exists. The safety ones: no gear may reach past the ±8% clamp, and no gear
 * may put a `cw` on the wire that the wire cannot carry. The rest check the
 * thing the rider actually asked for — that a tall gear is felt at the speeds
 * these games run at, including the slow ones, which is why the mapping is
 * not a `cw` multiplier alone.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@paperboy/game-core';
import { CATALOG } from '../src/catalog.js';
import { MAX_GRADE_PERCENT } from '@paperboy/trainer';
import type { SimulationParams } from '@paperboy/trainer';
import {
  GEAR_KEY, GEAR_MAX, GEAR_MIN, GEAR_STEP, MAX_CW, NEUTRAL_GEAR, applyGear,
  clampGear, gearGrade, gearRatio, loadGear, saveGear, shiftDown, shiftUp,
} from '../src/gearing.js';

/** What Velodrome and Paperboy ask for on the flat. */
const OPEN: SimulationParams = { grade: 0, headwind: 0, crr: 0.005, cw: 0.51 };

const ALL_GEARS = Array.from(
  { length: GEAR_MAX - GEAR_MIN + 1 }, (_, i) => GEAR_MIN + i,
);

/**
 * The trainer's own sum, near enough: gravity, rolling and drag, times speed.
 * `cw` is FTMS's wind resistance coefficient in kg/m, so the drag force is
 * half of it times the square of the speed.
 *
 * This is here to answer one question the numbers alone cannot — does a tall
 * gear actually ask for more watts at the speed the rider is turning? — and
 * it is deliberately not imported from the physics package, so that a change
 * to the game's model cannot quietly change what this test believes.
 */
function wattsAt(p: SimulationParams, speed: number, massKg = 85): number {
  const g = 9.80665;
  const gravity = massKg * g * (p.grade / 100);
  const rolling = p.crr * massKg * g;
  const drag = 0.5 * p.cw * speed * speed;
  return (gravity + rolling + drag) * speed;
}

describe('clampGear', () => {
  it('keeps a gear inside the block', () => {
    expect(clampGear(0)).toBe(GEAR_MIN);
    expect(clampGear(-40)).toBe(GEAR_MIN);
    expect(clampGear(99)).toBe(GEAR_MAX);
  });

  it('snaps a fraction to a whole gear', () => {
    expect(clampGear(6.4)).toBe(6);
    expect(clampGear(6.5)).toBe(7);
  });

  it('reads nonsense as neutral rather than as gear one', () => {
    expect(clampGear(Number.NaN)).toBe(NEUTRAL_GEAR);
    expect(clampGear(Number.POSITIVE_INFINITY)).toBe(NEUTRAL_GEAR);
  });
});

describe('gearRatio', () => {
  it('is exactly one at neutral', () => {
    expect(gearRatio(NEUTRAL_GEAR)).toBe(1);
  });

  it('is one step taller per gear, in both directions', () => {
    expect(gearRatio(NEUTRAL_GEAR + 1)).toBeCloseTo(GEAR_STEP, 10);
    expect(gearRatio(NEUTRAL_GEAR + 2)).toBeCloseTo(GEAR_STEP ** 2, 10);
    expect(gearRatio(NEUTRAL_GEAR - 1)).toBeCloseTo(1 / GEAR_STEP, 10);
  });

  it('rises with every gear and never doubles back', () => {
    for (let g = GEAR_MIN; g < GEAR_MAX; g++) {
      expect(gearRatio(g + 1)).toBeGreaterThan(gearRatio(g));
    }
  });

  it('has enough range to be worth having', () => {
    // A rider who cannot reach the number they want in neutral has to be able
    // to reach it somewhere, and the top gear is where.
    expect(gearRatio(GEAR_MAX)).toBeGreaterThan(3);
    expect(gearRatio(GEAR_MIN)).toBeLessThan(0.7);
  });
});

describe('gearGrade', () => {
  it('adds nothing at or below neutral', () => {
    for (let g = GEAR_MIN; g <= NEUTRAL_GEAR; g++) {
      expect(gearGrade(g)).toBe(0);
    }
  });

  it('tilts the road up, never down', () => {
    // A low gear thins the air. It must not dig a descent into a road the
    // game said was flat, or a game's climb into a coast.
    for (const g of ALL_GEARS) expect(gearGrade(g)).toBeGreaterThanOrEqual(0);
  });

  it('leaves the games room for a hill of their own', () => {
    expect(gearGrade(GEAR_MAX)).toBeLessThan(MAX_GRADE_PERCENT / 2);
  });
});

describe('applyGear', () => {
  it('changes nothing at all in neutral', () => {
    // The same object, not merely an equal one: a rider who never shifts is
    // riding exactly what the game's author tuned.
    expect(applyGear(OPEN, NEUTRAL_GEAR)).toBe(OPEN);
  });

  it('scales the requested drag by the gear ratio', () => {
    const geared = applyGear(OPEN, 8);
    expect(geared.cw).toBeCloseTo(OPEN.cw * gearRatio(8), 10);
    expect(geared.cw).toBeGreaterThan(OPEN.cw);
  });

  it('thins the air in a low gear', () => {
    const geared = applyGear(OPEN, GEAR_MIN);
    expect(geared.cw).toBeLessThan(OPEN.cw);
    expect(geared.grade).toBe(OPEN.grade);
  });

  it('adds the gear grade on top of whatever the game asked for', () => {
    const hill: SimulationParams = { ...OPEN, grade: 3 };
    expect(applyGear(hill, 7).grade).toBeCloseTo(3 + gearGrade(7), 10);
  });

  it('leaves rolling resistance and headwind alone', () => {
    // crr is the surface the game chose — grass against tarmac, dogs — and a
    // gear that changed it would be changing the game rather than the load.
    const wanted: SimulationParams = {
      grade: 2, headwind: 3.5, crr: 0.0091, cw: 0.44,
    };
    for (const g of ALL_GEARS) {
      const geared = applyGear(wanted, g);
      expect(geared.crr).toBe(wanted.crr);
      expect(geared.headwind).toBe(wanted.headwind);
    }
  });

  it('cannot reach past the grade clamp, in any gear, from any legal request', () => {
    const requested = [-8, -6, -2, 0, 2, 5, 6, 7.9, 8];
    for (const g of ALL_GEARS) {
      for (const grade of requested) {
        const out = applyGear({ ...OPEN, grade }, g);
        expect(
          Math.abs(out.grade),
          `gear ${g} on a ${grade}% road`,
        ).toBeLessThanOrEqual(MAX_GRADE_PERCENT);
      }
    }
  });

  it('never moves a grade further from flat than the game already asked for', () => {
    // A game handing over nonsense must not find that gearing is its way of
    // getting nonsense onto the wire. (Nonsense from a game is the encoder's
    // problem, and it clamps too; what matters here is that no gear makes it
    // worse.)
    for (const g of ALL_GEARS) {
      for (const grade of [-100, 20, 100]) {
        const out = applyGear({ ...OPEN, grade }, g);
        expect(Math.abs(out.grade))
          .toBeLessThanOrEqual(Math.max(MAX_GRADE_PERCENT, Math.abs(grade)));
      }
    }
  });

  it('saturates at the clamp on a game that is already climbing', () => {
    // Paperboy's steepest is 6%. The top gear asks for more than the clamp
    // allows and gets the clamp, which is the whole point of the clamp.
    expect(applyGear({ ...OPEN, grade: 6 }, GEAR_MAX).grade)
      .toBe(MAX_GRADE_PERCENT);
  });

  it('cannot put a cw on the wire that the wire cannot carry', () => {
    // FTMS encodes cw in one byte at 0.01 kg/m. Past 2.55 the encoder would
    // clamp it silently, so a tall gear would stop being taller without
    // anybody being told.
    for (const g of ALL_GEARS) {
      const out = applyGear({ ...OPEN, cw: 2.4 }, g);
      expect(out.cw).toBeLessThanOrEqual(MAX_CW);
      expect(out.cw).toBeGreaterThanOrEqual(0);
    }
  });

  it('never asks for negative drag', () => {
    expect(applyGear({ ...OPEN, cw: -1 }, GEAR_MAX).cw).toBe(0);
  });
});

describe('what a gear is worth on the road', () => {
  const power = (gear: number, speed: number): number =>
    wattsAt(applyGear(OPEN, gear), speed);

  it('asks for more watts in every taller gear, at every speed these games run', () => {
    for (const speed of [3, 5, 8, 10, 15, 20]) {
      for (let g = GEAR_MIN; g < GEAR_MAX; g++) {
        expect(
          power(g + 1, speed),
          `gear ${g + 1} at ${speed} m/s should be harder than gear ${g}`,
        ).toBeGreaterThan(power(g, speed));
      }
    }
  });

  it('bites hard at velodrome speed', () => {
    // The velodrome runs 10-20 m/s. The top gear must be a different sport.
    expect(power(GEAR_MAX, 15) / power(NEUTRAL_GEAR, 15)).toBeGreaterThan(3);
  });

  it('bites hard at slow speeds too, which is the whole reason for the grade', () => {
    expect(power(GEAR_MAX, 4) / power(NEUTRAL_GEAR, 4)).toBeGreaterThan(3);
  });

  it('gets its low-speed bite from the grade and its high-speed bite from the drag', () => {
    // The argument for the design, as an assertion. Drag goes as v², so a
    // cw-only gear does most of its work where the rider is already fast and
    // almost none of it where they are not.
    const dragOnly: SimulationParams = {
      ...OPEN, cw: OPEN.cw * gearRatio(GEAR_MAX),
    };
    const full = applyGear(OPEN, GEAR_MAX);
    const share = (speed: number): number =>
      (wattsAt(dragOnly, speed) - wattsAt(OPEN, speed))
      / (wattsAt(full, speed) - wattsAt(OPEN, speed));

    // Slow: less than half of the top gear's bite comes from the air, so a
    // cw-only mapping would be a gear the rider could barely feel.
    expect(share(4)).toBeLessThan(0.5);
    // Fast: nearly all of it does, which is what a real gear feels like.
    expect(share(15)).toBeGreaterThan(0.7);
  });

  it('offers a lower gear that is genuinely lower', () => {
    expect(power(GEAR_MIN, 12)).toBeLessThan(0.8 * power(NEUTRAL_GEAR, 12));
  });
});

describe('shifting', () => {
  it('moves one gear at a time', () => {
    expect(shiftUp(5)).toBe(6);
    expect(shiftDown(5)).toBe(4);
  });

  it('stops at the ends of the block rather than running off them', () => {
    expect(shiftUp(GEAR_MAX)).toBe(GEAR_MAX);
    expect(shiftDown(GEAR_MIN)).toBe(GEAR_MIN);
  });

  it('walks the whole block and back', () => {
    let gear = NEUTRAL_GEAR;
    for (let i = 0; i < 40; i++) gear = shiftUp(gear);
    expect(gear).toBe(GEAR_MAX);
    for (let i = 0; i < 40; i++) gear = shiftDown(gear);
    expect(gear).toBe(GEAR_MIN);
  });
});

describe('keeping the gear between rides', () => {
  it('starts a new rider in neutral', () => {
    expect(loadGear(createMemoryStorage())).toBe(NEUTRAL_GEAR);
  });

  it('remembers the gear the rider left it in', () => {
    const store = createMemoryStorage();
    saveGear(store, 9);
    expect(loadGear(store)).toBe(9);
  });

  it('shares the rider profile’s storage without colliding with it', () => {
    const store = createMemoryStorage();
    saveGear(store, 7);
    expect(store.getItem(GEAR_KEY)).toBe('7');
  });

  it('clamps what it saves as well as what it reads', () => {
    const store = createMemoryStorage();
    saveGear(store, 400);
    expect(loadGear(store)).toBe(GEAR_MAX);
  });

  it('reads a corrupted key as neutral rather than as gear one', () => {
    const store = createMemoryStorage();
    store.setItem(GEAR_KEY, 'top');
    expect(loadGear(store)).toBe(NEUTRAL_GEAR);
    store.setItem(GEAR_KEY, '');
    expect(loadGear(store)).toBe(NEUTRAL_GEAR);
  });

  it('survives storage being switched off entirely', () => {
    const off = {
      getItem(): string { throw new Error('denied'); },
      setItem(): void { throw new Error('denied'); },
      removeItem(): void { throw new Error('denied'); },
      clear(): void { throw new Error('denied'); },
      key(): string | null { throw new Error('denied'); },
      length: 0,
    } as unknown as Storage;
    expect(loadGear(off)).toBe(NEUTRAL_GEAR);
    expect(() => { saveGear(off, 8); }).not.toThrow();
  });
});

describe('which games have gears', () => {
  const single = CATALOG.filter((g) => g.singleSpeed === true).map((g) => g.id);

  it('leaves the two cadence games single-speed', () => {
    // Cadence is the steering wheel in both. A gear that made spinning
    // expensive would make steering cost a sprint, which is the exact trade
    // both games were built to avoid.
    expect(single.sort()).toEqual(['fish', 'spincycle']);
  });

  it('gives every game about effort a gear', () => {
    for (const game of CATALOG.filter((g) => g.needsResistance)) {
      expect(game.singleSpeed, game.id).not.toBe(true);
    }
  });
});
