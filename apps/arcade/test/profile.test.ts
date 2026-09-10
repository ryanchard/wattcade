import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@paperboy/game-core';
import { DEFAULT_RIDER, DEFAULT_SPRINT_MULTIPLE, sprintWatts } from '@paperboy/trainer';
import {
  SPRINT_MULTIPLE_FALLBACK, seededWPrimeJoules, wPrimeCapacity,
} from '@paperboy/game-core';
import {
  LEGACY_VELODROME_KEY, PROFILE_KEY, WPRIME_MAX_KJ, WPRIME_MIN_KJ,
  loadProfile, saveProfile, withEntries, wPrimeKilojoules,
} from '../src/profile.js';

describe('loadProfile', () => {
  it('falls back to the default rider when nothing is stored', () => {
    expect(loadProfile(createMemoryStorage())).toEqual(DEFAULT_RIDER);
  });

  it('round-trips FTP, sprint and weight', () => {
    const store = createMemoryStorage();
    saveProfile(store, { ...DEFAULT_RIDER, ftpWatts: 265, massKg: 72, sprintWatts: 1240 });
    const back = loadProfile(store);
    expect(back.ftpWatts).toBe(265);
    expect(back.massKg).toBe(72);
    expect(back.sprintWatts).toBe(1240);
  });

  it('clamps stored numbers that are out of any human range', () => {
    const store = createMemoryStorage();
    store.setItem(PROFILE_KEY, JSON.stringify({ ftpWatts: 9000, massKg: 2, sprintWatts: 1e9 }));
    const back = loadProfile(store);
    expect(back.ftpWatts).toBe(600);
    expect(back.massKg).toBe(35);
    expect(back.sprintWatts).toBe(2500);
  });

  it('estimates a sprint from FTP for a rider who has never entered one', () => {
    // A blank box is a decision the rider has not been asked to make; an
    // estimate is at least honest about what it is.
    const store = createMemoryStorage();
    store.setItem(PROFILE_KEY, JSON.stringify({ ftpWatts: 300, massKg: 80 }));
    expect(loadProfile(store).sprintWatts).toBe(300 * DEFAULT_SPRINT_MULTIPLE);
  });

  it('picks up the numbers Velodrome saved before the arcade existed', () => {
    const store = createMemoryStorage();
    store.setItem(LEGACY_VELODROME_KEY, JSON.stringify({ ftpWatts: 240, massKg: 68 }));
    const back = loadProfile(store);
    expect(back.ftpWatts).toBe(240);
    expect(back.massKg).toBe(68);
  });

  it('prefers its own key over the legacy one', () => {
    const store = createMemoryStorage();
    store.setItem(LEGACY_VELODROME_KEY, JSON.stringify({ ftpWatts: 240 }));
    store.setItem(PROFILE_KEY, JSON.stringify({ ftpWatts: 310 }));
    expect(loadProfile(store).ftpWatts).toBe(310);
  });

  it('survives corrupt stored JSON', () => {
    const store = createMemoryStorage();
    store.setItem(PROFILE_KEY, 'not json {{{');
    expect(loadProfile(store)).toEqual(DEFAULT_RIDER);
  });
});

describe('withEntries', () => {
  it('takes the strings the inputs actually produce', () => {
    const next = withEntries(DEFAULT_RIDER, { ftp: '275', mass: '71', sprint: '1180' });
    expect(next.ftpWatts).toBe(275);
    expect(next.massKg).toBe(71);
    expect(next.sprintWatts).toBe(1180);
  });

  it('leaves a field alone when nothing was typed into it', () => {
    const next = withEntries({ ...DEFAULT_RIDER, ftpWatts: 275 }, { mass: '71' });
    expect(next.ftpWatts).toBe(275);
  });

  it('keeps a blank or nonsense entry from wiping a good number', () => {
    const start = { ...DEFAULT_RIDER, ftpWatts: 275 };
    expect(withEntries(start, { ftp: '' }).ftpWatts).toBe(275);
    expect(withEntries(start, { ftp: 'abc' }).ftpWatts).toBe(275);
  });

  it('does not carry a stale sprint estimate over a raised FTP', () => {
    // The sprint the rider can see in the box is what they get; raising FTP
    // alone does not silently move it.
    const start = { ...DEFAULT_RIDER, ftpWatts: 200, sprintWatts: 700 };
    const next = withEntries(start, { ftp: '400' });
    expect(next.ftpWatts).toBe(400);
    expect(sprintWatts(next)).toBe(700);
  });
});

describe('the anaerobic store on the profile', () => {
  const OWNER = { ...DEFAULT_RIDER, ftpWatts: 235, sprintWatts: 1184 };

  it('is seeded from FTP and sprint rather than asked for', () => {
    expect(loadProfile(createMemoryStorage()).wPrimeJoules).toBeUndefined();
    expect(wPrimeKilojoules(OWNER)).toBe(22);
  });

  it('grows with the sprint-to-FTP ratio', () => {
    const diesel = { ...DEFAULT_RIDER, ftpWatts: 235, sprintWatts: 600 };
    expect(wPrimeKilojoules(OWNER)).toBeGreaterThan(wPrimeKilojoules(diesel));
  });

  it('keeps tracking FTP and sprint until the rider touches the box', () => {
    // Every box is committed together, so submitting the store unchanged
    // must not freeze it.
    const start = { ...DEFAULT_RIDER, ftpWatts: 200, sprintWatts: 700 };
    const shown = String(wPrimeKilojoules(start));
    const next = withEntries(start, { ftp: '300', wprime: shown });
    expect(next.wPrimeJoules).toBeUndefined();
    expect(wPrimeCapacity(next)).toBe(seededWPrimeJoules(next));
    expect(wPrimeCapacity(next)).toBeGreaterThan(wPrimeCapacity(start));
  });

  it('takes a figure the rider has actually measured', () => {
    const next = withEntries(OWNER, { wprime: '26' });
    expect(next.wPrimeJoules).toBe(26000);
    expect(wPrimeCapacity(next)).toBe(26000);
  });

  it('clamps a typed store to something a body could hold', () => {
    expect(withEntries(OWNER, { wprime: '900' }).wPrimeJoules)
      .toBe(WPRIME_MAX_KJ * 1000);
    expect(withEntries(OWNER, { wprime: '1' }).wPrimeJoules)
      .toBe(WPRIME_MIN_KJ * 1000);
  });

  it('round-trips a measured store and never persists a derived one', () => {
    const store = createMemoryStorage();
    saveProfile(store, OWNER);
    expect(store.getItem(PROFILE_KEY)).not.toContain('wPrimeJoules');
    expect(loadProfile(store).wPrimeJoules).toBeUndefined();

    saveProfile(store, { ...OWNER, wPrimeJoules: 26000 });
    expect(loadProfile(store).wPrimeJoules).toBe(26000);
  });

  it('clamps a stored store that is out of any human range', () => {
    const store = createMemoryStorage();
    store.setItem(PROFILE_KEY, JSON.stringify({ wPrimeJoules: 9e9 }));
    expect(loadProfile(store).wPrimeJoules).toBe(WPRIME_MAX_KJ * 1000);
    store.setItem(PROFILE_KEY, JSON.stringify({ wPrimeJoules: 'nope' }));
    expect(loadProfile(store).wPrimeJoules).toBeUndefined();
  });

  it('estimates a sprint the same way the trainer physics does', () => {
    // game-core restates the multiple rather than importing it, so that the
    // fatigue model stays dependency-free. This is the assertion that keeps
    // the two copies from drifting.
    expect(SPRINT_MULTIPLE_FALLBACK).toBe(DEFAULT_SPRINT_MULTIPLE);
  });
});
