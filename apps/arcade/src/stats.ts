/**
 * What the rider has done, across all the games. Each game keeps its own
 * records through its `onEnd`; this is the shell's flat, comparable summary,
 * so the hub can say "eleven rides, four hours" without asking three
 * different games three different questions.
 */
import type { RunResult } from '@paperboy/game-api';

export const STATS_KEY = 'arcade.stats.v1';

export interface GameStats {
  runs: number;
  /** Best comparable score, for games that have one. */
  bestScore: number | null;
  bestDistanceM: number;
  secondsRidden: number;
}

export type ArcadeStats = Record<string, GameStats>;

export const EMPTY_GAME_STATS: GameStats = Object.freeze({
  runs: 0, bestScore: null, bestDistanceM: 0, secondsRidden: 0,
});

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

function readGame(raw: unknown): GameStats {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_GAME_STATS };
  const r = raw as Partial<GameStats>;
  return {
    runs: num(r.runs),
    bestScore:
      typeof r.bestScore === 'number' && Number.isFinite(r.bestScore)
        ? r.bestScore : null,
    bestDistanceM: num(r.bestDistanceM),
    secondsRidden: num(r.secondsRidden),
  };
}

export function loadStats(store: Storage): ArcadeStats {
  let raw: string | null = null;
  try {
    raw = store.getItem(STATS_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: ArcadeStats = {};
    for (const [id, value] of Object.entries(parsed)) out[id] = readGame(value);
    return out;
  } catch {
    return {};
  }
}

export function statsFor(stats: ArcadeStats, gameId: string): GameStats {
  return stats[gameId] ?? { ...EMPTY_GAME_STATS };
}

export function recordRun(
  store: Storage, gameId: string, result: RunResult,
): ArcadeStats {
  const stats = loadStats(store);
  const prev = statsFor(stats, gameId);
  const next: ArcadeStats = {
    ...stats,
    [gameId]: {
      runs: prev.runs + 1,
      bestScore: result.score === null
        ? prev.bestScore
        : Math.max(prev.bestScore ?? result.score, result.score),
      bestDistanceM: Math.max(prev.bestDistanceM, Math.round(result.distanceM)),
      secondsRidden: prev.secondsRidden + Math.max(0, result.durationS),
    },
  };
  try {
    store.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled store must not end the rider's run.
  }
  return next;
}

export interface Totals {
  runs: number;
  secondsRidden: number;
}

export function totals(stats: ArcadeStats): Totals {
  let runs = 0;
  let secondsRidden = 0;
  for (const game of Object.values(stats)) {
    runs += game.runs;
    secondsRidden += game.secondsRidden;
  }
  return { runs, secondsRidden };
}

/** "4 h 12 m", "12 m", "40 s" — never "0.7 hours". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} m`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}
