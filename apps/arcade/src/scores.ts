/**
 * The high score table — three letters and a number, per game.
 *
 * An arcade does not remember you as a statistics panel. It remembers you as
 * RJC, second on Paperboy, since Tuesday. So this is deliberately not the
 * same thing as `stats.ts`: stats are how much riding has happened, and this
 * is who did the best of it.
 *
 * Two rules keep the board honest, and both are here rather than in the
 * markup so they can be tested:
 *
 *  - A run the rider stopped posts nothing. They got off the bike; that is
 *    not a score.
 *  - A game with no score of its own is ranked on the clock, and only when
 *    it hands over a `rankTimeS` — which Velodrome does only for a race the
 *    rider actually finished. Ranking a defeat by the winner's time would
 *    put every loss above every win.
 *
 * Pure over a `Storage`, and clock-free: the caller passes the timestamp, so
 * the whole file is testable without a browser or a fake date.
 */
import type { RunResult } from '@paperboy/game-api';

export const SCORES_KEY = 'wattcade.scores.v1';
export const INITIALS_KEY = 'wattcade.initials.v1';

/** Places on each game's board. Five is what a cabinet shows. */
export const BOARD_SIZE = 5;

/** What an untouched board says, and what an empty entry box falls back to. */
export const DEFAULT_INITIALS = 'AAA';

/** Which end of the list wins. */
export type Ranking = 'high' | 'low';

export interface ScoreEntry {
  /** Exactly three characters, so the board cannot lose its alignment. */
  readonly initials: string;
  /** The number the entry is ranked by. */
  readonly value: number;
  /** The game's own wording of that number: "1240", "820 m", "7 fish". */
  readonly display: string;
  /** When it was set. Also the entry's identity, for a later rename. */
  readonly at: number;
}

export interface GameBoard {
  readonly ranking: Ranking;
  readonly entries: readonly ScoreEntry[];
}

export type ScoreBoards = Record<string, GameBoard>;

export const EMPTY_BOARD: GameBoard = Object.freeze({
  ranking: 'high' as Ranking, entries: Object.freeze([]),
});

/** A four-lap time, to the tenth: "4:12.3". */
export function formatLapTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const rest = (s - minutes * 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${rest}`;
}

/**
 * Three characters, upper case, letters and digits only. Anything else is
 * dropped rather than corrected, and a rider who types nothing gets the
 * board's own default instead of a blank row.
 */
export function normaliseInitials(raw: string): string {
  const kept = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return kept === '' ? DEFAULT_INITIALS : kept.padEnd(3, ' ');
}

/** What this run posts to the board, or null when it posts nothing. */
export function postable(
  result: RunResult,
): { value: number; display: string; ranking: Ranking } | null {
  if (result.stopped) return null;
  if (result.score !== null && Number.isFinite(result.score)) {
    return { value: result.score, display: result.headline, ranking: 'high' };
  }
  const time = result.rankTimeS;
  if (time !== undefined && Number.isFinite(time) && time > 0) {
    return { value: time, display: formatLapTime(time), ranking: 'low' };
  }
  return null;
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

function readEntry(raw: unknown): ScoreEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<ScoreEntry>;
  if (typeof r.initials !== 'string' || typeof r.display !== 'string') return null;
  return {
    initials: normaliseInitials(r.initials),
    value: num(r.value),
    display: r.display.slice(0, 16),
    at: num(r.at),
  };
}

function readBoard(raw: unknown): GameBoard {
  if (typeof raw !== 'object' || raw === null) return EMPTY_BOARD;
  const r = raw as { ranking?: unknown; entries?: unknown };
  const entries = Array.isArray(r.entries)
    ? r.entries.map(readEntry).filter((e): e is ScoreEntry => e !== null)
    : [];
  return {
    ranking: r.ranking === 'low' ? 'low' : 'high',
    entries: entries.slice(0, BOARD_SIZE),
  };
}

export function loadBoards(store: Storage): ScoreBoards {
  let raw: string | null = null;
  try {
    raw = store.getItem(SCORES_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: ScoreBoards = {};
    for (const [id, value] of Object.entries(parsed)) out[id] = readBoard(value);
    return out;
  } catch {
    return {};
  }
}

export function boardFor(boards: ScoreBoards, gameId: string): GameBoard {
  return boards[gameId] ?? EMPTY_BOARD;
}

function save(store: Storage, boards: ScoreBoards): void {
  try {
    store.setItem(SCORES_KEY, JSON.stringify(boards));
  } catch {
    // Storage off. The board is empty next time and the ride still happened.
  }
}

function sorted(board: GameBoard): ScoreEntry[] {
  const sign = board.ranking === 'low' ? 1 : -1;
  return [...board.entries].sort((a, b) => {
    const byValue = (a.value - b.value) * sign;
    // An equalled score does not push the rider who got there first down.
    return byValue !== 0 ? byValue : a.at - b.at;
  });
}

export interface Posted {
  readonly boards: ScoreBoards;
  /** 1-based place on that game's board, or null when it did not make it. */
  readonly place: number | null;
  /** The entry as stored, so its initials can be edited afterwards. */
  readonly entry: ScoreEntry | null;
}

/**
 * Puts a finished run on its game's board. Returns the new boards and where
 * the run landed, so the results card can say "second on Paperboy" rather
 * than leaving the rider to go and look.
 */
export function recordScore(
  store: Storage, gameId: string, initials: string, result: RunResult, at: number,
): Posted {
  const boards = loadBoards(store);
  const post = postable(result);
  if (post === null) return { boards, place: null, entry: null };

  const entry: ScoreEntry = {
    initials: normaliseInitials(initials),
    value: post.value,
    display: post.display,
    at,
  };
  const previous = boardFor(boards, gameId);
  const merged: GameBoard = {
    ranking: post.ranking,
    entries: [...previous.entries, entry],
  };
  const ranked = sorted(merged).slice(0, BOARD_SIZE);
  const next: ScoreBoards = { ...boards, [gameId]: { ranking: post.ranking, entries: ranked } };
  save(store, next);

  const index = ranked.findIndex((e) => e.at === entry.at && e.value === entry.value);
  return {
    boards: next,
    place: index === -1 ? null : index + 1,
    entry: index === -1 ? null : entry,
  };
}

/**
 * Changes the initials on an entry already on the board, found by the
 * timestamp it was posted with. This is how a rider gets to type their
 * initials AFTER seeing where they came — which is the order an arcade does
 * it in, and the only order that lets the card say the place first.
 */
export function renameEntry(
  store: Storage, gameId: string, at: number, initials: string,
): ScoreBoards {
  const boards = loadBoards(store);
  const board = boardFor(boards, gameId);
  if (!board.entries.some((e) => e.at === at)) return boards;
  const next: ScoreBoards = {
    ...boards,
    [gameId]: {
      ranking: board.ranking,
      entries: board.entries.map((e) => (
        e.at === at ? { ...e, initials: normaliseInitials(initials) } : e
      )),
    },
  };
  save(store, next);
  return next;
}

/** The initials the rider used last, so they type them once and not again. */
export function loadInitials(store: Storage): string {
  try {
    const raw = store.getItem(INITIALS_KEY);
    return raw === null ? DEFAULT_INITIALS : normaliseInitials(raw);
  } catch {
    return DEFAULT_INITIALS;
  }
}

export function saveInitials(store: Storage, initials: string): void {
  try {
    store.setItem(INITIALS_KEY, normaliseInitials(initials));
  } catch {
    // Storage off. They type three letters again next time.
  }
}

/** "1st", "2nd", "3rd" — the board is short enough that this stays small. */
export function ordinal(place: number): string {
  const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
  return `${place}${suffix}`;
}
