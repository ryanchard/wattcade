import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@paperboy/game-core';
import type { RunResult } from '@paperboy/game-api';
import {
  STATS_KEY, formatDuration, loadStats, recordRun, statsFor, totals,
} from '../src/stats.js';

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    headline: '0', summary: '', lines: [],
    durationS: 60, distanceM: 500, avgPower: 180, score: 100, stopped: false,
    ...over,
  };
}

describe('recordRun', () => {
  it('counts rides and keeps the best score per game', () => {
    const store = createMemoryStorage();
    recordRun(store, 'paperboy', run({ score: 100 }));
    recordRun(store, 'paperboy', run({ score: 400 }));
    recordRun(store, 'paperboy', run({ score: 250 }));
    const stats = statsFor(loadStats(store), 'paperboy');
    expect(stats.runs).toBe(3);
    expect(stats.bestScore).toBe(400);
  });

  it('keeps games apart', () => {
    const store = createMemoryStorage();
    recordRun(store, 'paperboy', run({ score: 400 }));
    recordRun(store, 'pack', run({ score: 900 }));
    expect(statsFor(loadStats(store), 'paperboy').bestScore).toBe(400);
    expect(statsFor(loadStats(store), 'pack').bestScore).toBe(900);
  });

  it('leaves bestScore null for a game that has no score', () => {
    const store = createMemoryStorage();
    recordRun(store, 'velodrome', run({ score: null, distanceM: 1000 }));
    const stats = statsFor(loadStats(store), 'velodrome');
    expect(stats.bestScore).toBeNull();
    expect(stats.bestDistanceM).toBe(1000);
    expect(stats.runs).toBe(1);
  });

  it('adds up time ridden across every game', () => {
    const store = createMemoryStorage();
    recordRun(store, 'paperboy', run({ durationS: 120 }));
    recordRun(store, 'pack', run({ durationS: 300 }));
    expect(totals(loadStats(store))).toEqual({ runs: 2, secondsRidden: 420 });
  });

  it('counts a stopped ride as a ride', () => {
    // The rider was still on the bike. Not counting it would quietly
    // under-report exactly the sessions where they hit the safety stop.
    const store = createMemoryStorage();
    recordRun(store, 'pack', run({ stopped: true }));
    expect(statsFor(loadStats(store), 'pack').runs).toBe(1);
  });
});

describe('loadStats', () => {
  it('is empty for a rider who has never ridden', () => {
    expect(loadStats(createMemoryStorage())).toEqual({});
  });

  it('survives corrupt stored JSON rather than throwing on startup', () => {
    const store = createMemoryStorage();
    store.setItem(STATS_KEY, '{{ not json');
    expect(loadStats(store)).toEqual({});
  });

  it('repairs a stored entry with the wrong shape', () => {
    const store = createMemoryStorage();
    store.setItem(STATS_KEY, JSON.stringify({ pack: { runs: 'seven' } }));
    expect(statsFor(loadStats(store), 'pack').runs).toBe(0);
  });
});

describe('formatDuration', () => {
  it('says it the way a rider would', () => {
    expect(formatDuration(40)).toBe('40 s');
    expect(formatDuration(725)).toBe('12 m');
    expect(formatDuration(15120)).toBe('4 h 12 m');
  });
});
