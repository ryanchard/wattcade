/**
 * The safety tests. This is the file the whole restructure exists for: when
 * every game owned its own write loop, a panic key shipped whose zero was
 * overwritten before the trainer's next flush, and the emergency stop did
 * nothing. These assert the two properties that make that impossible — the
 * value sent is flat whenever nobody is being asked to push, and exactly one
 * write leaves per frame.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  GameModule, GameSession, HudLine, RunResult, SimulationParams,
} from '@paperboy/game-api';
import type {
  TrainerSample, TrainerSource, TrainerStatus, Unsubscribe,
} from '@paperboy/trainer';
import {
  FIXED_DT, FLAT_SIMULATION, MAX_FRAME_S, MAX_SUBSTEPS, NO_KEYS, POWER_TAU_S,
  advanceRide, clearRide, createRide, effectiveSimulation, finishRide,
  isUnderLoad, releaseRide, setCadence, setHidden, setPaused, setPower, startRide,
  stopRide, tickRide, togglePaused,
} from '../src/ride.js';
import type { FrameInput, Ride } from '../src/ride.js';

/** A distinctive, definitely-not-flat load. */
const STEEP: SimulationParams = { grade: 6, headwind: 2, crr: 0.009, cw: 0.44 };

class FakeSession implements GameSession {
  advanced: Array<{ dt: number; watts: number }> = [];
  animated: number[] = [];
  cadences: Array<number | null> = [];
  keyFrames = 0;
  over = false;
  stopped = false;
  ended = 0;
  /** Substeps to run before declaring the run finished, or null for never. */
  endAfter: number | null = null;

  get isOver(): boolean { return this.over; }

  advance(dtSeconds: number, powerWatts: number): void {
    this.advanced.push({ dt: dtSeconds, watts: powerWatts });
    if (this.endAfter !== null && this.advanced.length >= this.endAfter) {
      this.over = true;
    }
  }

  animate(dtSeconds: number): void { this.animated.push(dtSeconds); }
  setCadence(rpm: number | null): void { this.cadences.push(rpm); }
  handleKeys(): void { this.keyFrames += 1; }
  render(): void { /* nothing to draw in a test */ }
  simulation(): SimulationParams { return STEEP; }
  stop(): void { this.stopped = true; this.over = true; }
  onEnd(): void { this.ended += 1; }
  result(): RunResult {
    return {
      headline: '1', summary: 'done', lines: [],
      durationS: 1, distanceM: 2, avgPower: 3, score: 4, stopped: this.stopped,
    };
  }
  hud(): readonly HudLine[] { return []; }
}

function moduleWith(controls: GameModule['controls']): GameModule {
  return {
    id: 'test', name: 'Test', blurb: '', needsResistance: true, controls,
    palette: { base: '#000', accent: '#fff', detail: '#888' },
    create: () => new FakeSession(),
  };
}

const SILENT = moduleWith([]);
const KEYED = moduleWith([{ keys: 'space', action: 'do a thing' }]);

class CountingSource implements TrainerSource {
  readonly kind = 'replay' as const;
  readonly canControlResistance = true;
  writes: SimulationParams[] = [];
  async start(): Promise<void> { /* not used */ }
  async stop(): Promise<void> { /* not used */ }
  onSample(_fn: (s: TrainerSample) => void): Unsubscribe { return () => {}; }
  onStatus(_fn: (s: TrainerStatus) => void): Unsubscribe { return () => {}; }
  setSimulation(p: SimulationParams): void { this.writes.push(p); }
}

function frame(dtSeconds: number): FrameInput {
  return { dtSeconds, keys: NO_KEYS, width: 800, height: 600 };
}

function riding(game: GameModule = SILENT): { ride: Ride; session: FakeSession } {
  const ride = createRide();
  const session = new FakeSession();
  startRide(ride, game, session);
  return { ride, session };
}

describe('effectiveSimulation', () => {
  it('is flat when no game is running', () => {
    expect(effectiveSimulation(createRide())).toBe(FLAT_SIMULATION);
  });

  it('is what the game asked for while the rider is riding', () => {
    const { ride } = riding();
    expect(effectiveSimulation(ride)).toBe(STEEP);
  });

  it('is flat while paused', () => {
    const { ride } = riding();
    setPaused(ride, true);
    expect(effectiveSimulation(ride)).toBe(FLAT_SIMULATION);
    setPaused(ride, false);
    expect(effectiveSimulation(ride)).toBe(STEEP);
  });

  it('is flat while the document is hidden', () => {
    const { ride } = riding();
    setHidden(ride, true);
    expect(effectiveSimulation(ride)).toBe(FLAT_SIMULATION);
  });

  it('is flat once the run is over', () => {
    const { ride, session } = riding();
    session.over = true;
    expect(effectiveSimulation(ride)).toBe(FLAT_SIMULATION);
  });

  it('is flat once the page has let the trainer go', () => {
    const { ride } = riding();
    releaseRide(ride);
    expect(effectiveSimulation(ride)).toBe(FLAT_SIMULATION);
  });

  it('is flat after leaving a game for the hub', () => {
    const { ride } = riding();
    clearRide(ride);
    expect(effectiveSimulation(ride)).toBe(FLAT_SIMULATION);
  });

  it('stays flat while any one reason to be flat still holds', () => {
    // Un-pausing a hidden tab must not put resistance back on.
    const { ride } = riding();
    setPaused(ride, true);
    setHidden(ride, true);
    setPaused(ride, false);
    expect(effectiveSimulation(ride)).toBe(FLAT_SIMULATION);
    setHidden(ride, false);
    expect(effectiveSimulation(ride)).toBe(STEEP);
  });

  it('has an actually flat FLAT_SIMULATION', () => {
    // Guards against somebody "tidying" the constant into something with a
    // grade in it, which no other test here would notice.
    expect(FLAT_SIMULATION.grade).toBe(0);
    expect(FLAT_SIMULATION.headwind).toBe(0);
  });
});

describe('tickRide', () => {
  it('writes exactly once per frame while riding', () => {
    const { ride } = riding();
    const source = new CountingSource();
    for (let i = 0; i < 10; i++) tickRide(ride, source, frame(1 / 60));
    expect(source.writes).toHaveLength(10);
  });

  it('writes exactly once per frame with no game running', () => {
    // The rider is on the hub with a trainer still paired. It must be being
    // told flat, repeatedly, not left holding the last grade it was given.
    const ride = createRide();
    const source = new CountingSource();
    for (let i = 0; i < 5; i++) tickRide(ride, source, frame(1 / 60));
    expect(source.writes).toEqual(Array.from({ length: 5 }, () => FLAT_SIMULATION));
  });

  it('writes exactly once on a frame that runs no substeps', () => {
    const { ride } = riding();
    const source = new CountingSource();
    // Shorter than FIXED_DT, so nothing is simulated — but the trainer must
    // still hear from us exactly once.
    tickRide(ride, source, frame(FIXED_DT / 2));
    expect(source.writes).toHaveLength(1);
  });

  it('writes exactly once on a frame that runs the maximum substeps', () => {
    const { ride } = riding();
    const source = new CountingSource();
    tickRide(ride, source, frame(10));
    expect(source.writes).toHaveLength(1);
  });

  it('sends flat on the very first frame after the safety stop', () => {
    const { ride } = riding();
    const source = new CountingSource();
    tickRide(ride, source, frame(1 / 60));
    expect(source.writes.at(-1)).toBe(STEEP);

    stopRide(ride);
    tickRide(ride, source, frame(1 / 60));
    expect(source.writes.at(-1)).toBe(FLAT_SIMULATION);
    expect(source.writes).toHaveLength(2);
  });

  it('sends flat on the very first frame after pausing', () => {
    const { ride } = riding();
    const source = new CountingSource();
    togglePaused(ride);
    tickRide(ride, source, frame(1 / 60));
    expect(source.writes).toEqual([FLAT_SIMULATION]);
  });

  it('survives having no source at all', () => {
    const { ride } = riding();
    expect(() => tickRide(ride, null, frame(1 / 60))).not.toThrow();
  });

  it('advances the session before it writes, never after', () => {
    // ControlPointWriter coalesces simulation writes, so a write made after
    // the world moved is the only one that can be correct.
    const { ride, session } = riding();
    const order: string[] = [];
    const spyAdvance = vi.spyOn(session, 'advance')
      .mockImplementation(() => { order.push('advance'); });
    const source = new CountingSource();
    const spyWrite = vi.spyOn(source, 'setSimulation')
      .mockImplementation(() => { order.push('write'); });

    tickRide(ride, source, frame(1 / 60));

    expect(order.at(-1)).toBe('write');
    expect(order.filter((o) => o === 'write')).toHaveLength(1);
    expect(order.filter((o) => o === 'advance').length).toBeGreaterThan(0);
    spyAdvance.mockRestore();
    spyWrite.mockRestore();
  });
});

describe('stopRide', () => {
  it('ends the run through the game rather than by writing anything', () => {
    const { ride, session } = riding();
    stopRide(ride);
    expect(session.stopped).toBe(true);
    expect(isUnderLoad(ride)).toBe(false);
  });

  it('does nothing when there is no run, or the run already ended', () => {
    expect(() => stopRide(createRide())).not.toThrow();
    const { ride, session } = riding();
    session.over = true;
    stopRide(ride);
    expect(session.stopped).toBe(false);
  });
});

describe('advanceRide', () => {
  it('runs whole substeps and carries the remainder', () => {
    const { ride, session } = riding();
    // One 144 Hz frame is shorter than one 120 Hz substep: nothing runs, but
    // the time is kept rather than thrown away.
    advanceRide(ride, frame(1 / 144));
    expect(session.advanced).toHaveLength(0);
    expect(ride.accumulator).toBeCloseTo(1 / 144, 12);
    advanceRide(ride, frame(1 / 144));
    expect(session.advanced).toHaveLength(1);
  });

  it('always advances by the fixed timestep, never the frame time', () => {
    const { ride, session } = riding();
    advanceRide(ride, frame(1 / 30));
    expect(session.advanced.every((a) => a.dt === FIXED_DT)).toBe(true);
  });

  it('caps a long frame and drops the backlog rather than replaying it', () => {
    const { ride, session } = riding();
    advanceRide(ride, frame(30));
    expect(session.advanced).toHaveLength(MAX_SUBSTEPS);
    expect(ride.accumulator).toBe(0);
  });

  it('simulates a long-but-honest frame in full', () => {
    // MAX_FRAME_S at FIXED_DT is exactly MAX_SUBSTEPS, so the clamp and the
    // cap agree and a slow frame is not silently slowed further.
    expect(Math.round(MAX_FRAME_S / FIXED_DT)).toBe(MAX_SUBSTEPS);
  });

  it('does not advance while paused, hidden, over or released', () => {
    for (const spoil of [
      (r: Ride) => setPaused(r, true),
      (r: Ride) => setHidden(r, true),
      (r: Ride) => releaseRide(r),
    ]) {
      const { ride, session } = riding();
      spoil(ride);
      advanceRide(ride, frame(1));
      expect(session.advanced).toHaveLength(0);
    }
    const { ride, session } = riding();
    session.over = true;
    advanceRide(ride, frame(1));
    expect(session.advanced).toHaveLength(0);
  });

  it('stops stepping the moment the run ends mid-frame', () => {
    const { ride, session } = riding();
    session.endAfter = 3;
    advanceRide(ride, frame(1));
    expect(session.advanced).toHaveLength(3);
  });

  it('eases power toward the target rather than stepping to it', () => {
    const { ride, session } = riding();
    setPower(ride, 300);
    advanceRide(ride, frame(FIXED_DT));
    const first = session.advanced[0]!.watts;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(300);
    // The same ease every game used to apply for itself.
    expect(first).toBeCloseTo(300 * (1 - Math.exp(-FIXED_DT / POWER_TAU_S)), 12);
  });

  it('gives animate real frame time and advance fixed time', () => {
    const { ride, session } = riding();
    advanceRide(ride, frame(1 / 30));
    expect(session.animated).toEqual([1 / 30]);
  });

  it('clamps the frame it hands to animate as well', () => {
    const { ride, session } = riding();
    advanceRide(ride, frame(9));
    expect(session.animated).toEqual([MAX_FRAME_S]);
  });

  it('forwards keys only to a game that asked for them', () => {
    const quiet = riding(SILENT);
    advanceRide(quiet.ride, frame(1 / 60));
    expect(quiet.session.keyFrames).toBe(0);

    const keyed = riding(KEYED);
    advanceRide(keyed.ride, frame(1 / 60));
    expect(keyed.session.keyFrames).toBe(1);
  });
});

describe('setPower', () => {
  it('clamps an implausible reading rather than letting it through', () => {
    const ride = createRide();
    setPower(ride, 99999);
    expect(ride.powerTarget).toBe(2000);
  });

  it('treats a missing or nonsense reading as zero', () => {
    const ride = createRide();
    setPower(ride, 200);
    for (const bad of [null, Number.NaN, -5]) {
      setPower(ride, bad);
      expect(ride.powerTarget).toBe(0);
    }
  });
});

describe('setCadence', () => {
  it('passes a plausible reading straight through, unsmoothed', () => {
    const ride = createRide();
    setCadence(ride, 93);
    expect(ride.cadenceRpm).toBe(93);
  });

  it('starts with no reading rather than with zero', () => {
    expect(createRide().cadenceRpm).toBeNull();
  });

  it('keeps "no sensor" distinct from "not pedalling"', () => {
    const ride = createRide();
    setCadence(ride, 0);
    expect(ride.cadenceRpm).toBe(0);
    setCadence(ride, null);
    expect(ride.cadenceRpm).toBeNull();
  });

  it('treats a glitched reading as no reading rather than clamping it', () => {
    const ride = createRide();
    for (const bad of [Number.NaN, -3, 9999, Number.POSITIVE_INFINITY]) {
      setCadence(ride, bad);
      expect(ride.cadenceRpm).toBeNull();
    }
  });

  it('reaches the session once per frame, however many substeps it runs', () => {
    const { ride, session } = riding();
    setCadence(ride, 88);
    advanceRide(ride, frame(1 / 60));
    expect(session.cadences).toEqual([88]);
    expect(session.advanced.length).toBeGreaterThan(1);
  });

  it('tells a session there is no reading rather than saying nothing', () => {
    const { ride, session } = riding();
    advanceRide(ride, frame(1 / 60));
    expect(session.cadences).toEqual([null]);
  });

  it('does not reach a session while the run is not under load', () => {
    const { ride, session } = riding();
    setCadence(ride, 88);
    setPaused(ride, true);
    advanceRide(ride, frame(1 / 60));
    expect(session.cadences).toEqual([]);
  });
});

describe('finishRide', () => {
  it('returns nothing while the run is still going', () => {
    const { ride } = riding();
    expect(finishRide(ride, storage())).toBeNull();
  });

  it('lets the game write its records exactly once', () => {
    const { ride, session } = riding();
    session.over = true;
    const store = storage();
    expect(finishRide(ride, store)).not.toBeNull();
    expect(finishRide(ride, store)).toBeNull();
    expect(session.ended).toBe(1);
  });

  it('starts a fresh run un-ended', () => {
    const { ride, session } = riding();
    session.over = true;
    finishRide(ride, storage());
    const next = new FakeSession();
    startRide(ride, SILENT, next);
    expect(ride.ended).toBe(false);
    expect(finishRide(ride, storage())).toBeNull();
  });
});

function storage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k) { return map.get(k) ?? null; },
    key(i) { return [...map.keys()][i] ?? null; },
    removeItem(k) { map.delete(k); },
    setItem(k, v) { map.set(k, v); },
  };
}
