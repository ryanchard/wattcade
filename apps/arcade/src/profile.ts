/**
 * The rider's own numbers: entered once in the hub, shared by every game.
 *
 * Pure over a `Storage`, so it is testable and so a private window with
 * storage switched off costs the rider their saved numbers and nothing else.
 */
import type { RiderProfile } from '@paperboy/game-api';
import { wPrimeCapacity } from '@paperboy/game-core';
import { DEFAULT_RIDER, sprintWatts } from '@paperboy/trainer';

export const PROFILE_KEY = 'arcade.rider.v1';

/** Velodrome's old standalone key, read once so nobody re-types their FTP. */
export const LEGACY_VELODROME_KEY = 'velodrome.rider';

export const FTP_MIN = 60;
export const FTP_MAX = 600;
export const MASS_MIN = 35;
export const MASS_MAX = 200;
/** A sprint below this is not a sprint; above it is a power meter fault. */
export const SPRINT_MIN = 100;
export const SPRINT_MAX = 2500;
/** The anaerobic store, in KILOJOULES, which is the unit riders see it in.
 * The bounds are `W_PRIME_MIN_J`/`W_PRIME_MAX_J` from `@paperboy/game-core`,
 * expressed in the same unit as the box. */
export const WPRIME_MIN_KJ = 4;
export const WPRIME_MAX_KJ = 50;

/** The rider's store in whole kilojoules — what the profile box shows,
 * whether it came from their own figure or from the seed. */
export function wPrimeKilojoules(profile: RiderProfile): number {
  return Math.round(wPrimeCapacity(profile) / 1000);
}

export function clampNumber(
  value: unknown, lo: number, hi: number, fallback: number,
): number {
  // An empty input box is not a zero. `Number('')` is 0, which is finite,
  // and would clamp a rider who cleared the field down to the legal minimum
  // instead of leaving their number where it was.
  if (typeof value === 'string' && value.trim() === '') return fallback;
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function fromStored(raw: string | null, base: RiderProfile): RiderProfile {
  if (raw === null) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<RiderProfile>;
    const ftpWatts = clampNumber(parsed.ftpWatts, FTP_MIN, FTP_MAX, base.ftpWatts);
    return {
      ...base,
      ftpWatts,
      massKg: clampNumber(parsed.massKg, MASS_MIN, MASS_MAX, base.massKg),
      // A rider who has never entered a sprint number gets one estimated from
      // their FTP rather than an empty box: an estimate is honest and a blank
      // is a decision they have not been asked to make yet.
      sprintWatts: clampNumber(
        parsed.sprintWatts, SPRINT_MIN, SPRINT_MAX,
        Math.round(sprintWatts({ ...base, ftpWatts, sprintWatts: undefined })),
      ),
      // Absent stays absent, so a rider who has never touched the box keeps
      // getting a store seeded from whatever their FTP and sprint are NOW.
      // Only a figure they entered themselves is worth freezing.
      ...(typeof parsed.wPrimeJoules === 'number'
        && Number.isFinite(parsed.wPrimeJoules)
        ? {
          wPrimeJoules: Math.min(
            WPRIME_MAX_KJ * 1000,
            Math.max(WPRIME_MIN_KJ * 1000, parsed.wPrimeJoules),
          ),
        }
        : {}),
    };
  } catch {
    return base;
  }
}

export function loadProfile(store: Storage): RiderProfile {
  const base: RiderProfile = { ...DEFAULT_RIDER };
  try {
    const mine = store.getItem(PROFILE_KEY);
    if (mine !== null) return fromStored(mine, base);
    return fromStored(store.getItem(LEGACY_VELODROME_KEY), base);
  } catch {
    return base;
  }
}

export function saveProfile(store: Storage, profile: RiderProfile): void {
  try {
    store.setItem(PROFILE_KEY, JSON.stringify({
      ftpWatts: profile.ftpWatts,
      massKg: profile.massKg,
      sprintWatts: profile.sprintWatts,
      ...(profile.wPrimeJoules === undefined
        ? {} : { wPrimeJoules: profile.wPrimeJoules }),
    }));
  } catch {
    // Storage off. The ride still runs, which is the part that matters.
  }
}

/**
 * Applies whatever the rider typed into the three boxes, clamped. Values that
 * are not numbers leave the existing one alone rather than resetting it.
 */
export function withEntries(
  profile: RiderProfile,
  entries: { ftp?: unknown; mass?: unknown; sprint?: unknown; wprime?: unknown },
): RiderProfile {
  const ftpWatts = entries.ftp === undefined
    ? profile.ftpWatts
    : clampNumber(entries.ftp, FTP_MIN, FTP_MAX, profile.ftpWatts);
  const next: RiderProfile = {
    ...profile,
    ftpWatts,
    massKg: entries.mass === undefined
      ? profile.massKg
      : clampNumber(entries.mass, MASS_MIN, MASS_MAX, profile.massKg),
    sprintWatts: entries.sprint === undefined
      ? profile.sprintWatts
      : clampNumber(
        entries.sprint, SPRINT_MIN, SPRINT_MAX,
        Math.round(sprintWatts(profile)),
      ),
  };
  return withWPrimeEntry(profile, next, entries.wprime);
}

/**
 * The store box, which is the one field that is normally derived.
 *
 * Every box is committed together whenever any one of them changes, so a
 * naive read would freeze the seeded store the first time a rider nudged
 * their FTP — and then their store would stop tracking the two numbers it is
 * supposed to be seeded from. A submitted value that still rounds to the
 * store the rider is currently racing on therefore means "I did not touch
 * this", and leaves the profile deriving it.
 */
function withWPrimeEntry(
  before: RiderProfile, next: RiderProfile, entry: unknown,
): RiderProfile {
  if (entry === undefined) return next;
  const shown = Math.round(wPrimeCapacity(before) / 1000);
  const typed = clampNumber(entry, WPRIME_MIN_KJ, WPRIME_MAX_KJ, shown);
  if (Math.round(typed) === shown) {
    // Untouched. Keep whatever the profile had — including nothing at all.
    return next;
  }
  return { ...next, wPrimeJoules: Math.round(typed) * 1000 };
}
