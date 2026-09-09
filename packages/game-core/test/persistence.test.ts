import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_STATS, STORAGE_KEY, createMemoryStorage, loadStats, recordRun,
} from '../src/persistence.js';
import type { RunResult } from '../src/persistence.js';

const result = (over: Partial<RunResult> = {}): RunResult => ({
  seed: 42, score: 1000, distanceM: 800, durationMs: 120_000,
  avgPower: 190, kilojoules: 23, papersDelivered: 12, ...over,
});

describe('persistence', () => {
  let storage: Storage;
  beforeEach(() => { storage = createMemoryStorage(); });

  it('returns empty stats when nothing is stored', () => {
    expect(loadStats(storage)).toEqual(EMPTY_STATS);
  });

  it('returns empty stats when the stored value is corrupt', () => {
    storage.setItem(STORAGE_KEY, 'not json {{{');
    expect(loadStats(storage)).toEqual(EMPTY_STATS);
  });

  it('returns empty stats when the stored value is the wrong shape', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ highScore: 'lots' }));
    expect(loadStats(storage).highScore).toBe(0);
  });

  it('records a first run', () => {
    const s = recordRun(result(), storage);
    expect(s.highScore).toBe(1000);
    expect(s.bestDistanceM).toBe(800);
    expect(s.lifetimePapers).toBe(12);
    expect(s.runs).toBe(1);
  });

  it('persists across loads', () => {
    recordRun(result(), storage);
    expect(loadStats(storage).highScore).toBe(1000);
  });

  it('keeps the best score, not the latest', () => {
    recordRun(result({ score: 1000 }), storage);
    const s = recordRun(result({ score: 400 }), storage);
    expect(s.highScore).toBe(1000);
    expect(s.runs).toBe(2);
  });

  it('accumulates lifetime papers across runs', () => {
    recordRun(result({ papersDelivered: 12 }), storage);
    const s = recordRun(result({ papersDelivered: 8 }), storage);
    expect(s.lifetimePapers).toBe(20);
  });

  it('tracks a personal best per seed', () => {
    recordRun(result({ seed: 1, score: 500 }), storage);
    recordRun(result({ seed: 2, score: 900 }), storage);
    const s = recordRun(result({ seed: 1, score: 700 }), storage);
    expect(s.perSeedBest['1']).toBe(700);
    expect(s.perSeedBest['2']).toBe(900);
  });

  it('does not lower a per-seed best', () => {
    recordRun(result({ seed: 1, score: 900 }), storage);
    const s = recordRun(result({ seed: 1, score: 100 }), storage);
    expect(s.perSeedBest['1']).toBe(900);
  });

  it('survives a storage that throws on write', () => {
    const hostile: Storage = {
      ...createMemoryStorage(),
      setItem() { throw new Error('QuotaExceededError'); },
    };
    expect(() => recordRun(result(), hostile)).not.toThrow();
  });
});
