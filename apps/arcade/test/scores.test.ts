/**
 * The board. Two of these tests are the whole reason it is not just a sort:
 * a ride the rider stopped posts nothing, and a race decided by somebody
 * else crossing the line first is not a time.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@paperboy/game-core';
import type { RunResult } from '@paperboy/game-api';
import {
  BOARD_SIZE, DEFAULT_INITIALS, SCORES_KEY, boardFor, formatLapTime,
  loadBoards, loadInitials, normaliseInitials, ordinal, postable, recordScore,
  renameEntry, saveInitials,
} from '../src/scores.js';

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    headline: '100', summary: '', lines: [],
    durationS: 60, distanceM: 500, avgPower: 180, score: 100, stopped: false,
    ...over,
  };
}

describe('normaliseInitials', () => {
  it('gives three characters whatever it is handed', () => {
    expect(normaliseInitials('rjc')).toBe('RJC');
    expect(normaliseInitials('ryan')).toBe('RYA');
    expect(normaliseInitials('r j')).toBe('RJ ');
    expect(normaliseInitials('<>&')).toBe(DEFAULT_INITIALS);
    expect(normaliseInitials('')).toBe(DEFAULT_INITIALS);
  });
});

describe('postable', () => {
  it('takes the game at its word: its score, and its own wording of it', () => {
    expect(postable(run({ score: 820, headline: '820 m' })))
      .toEqual({ value: 820, display: '820 m', ranking: 'high' });
  });

  it('posts nothing for a ride the rider stopped', () => {
    // They got off the bike. That is not a score.
    expect(postable(run({ stopped: true }))).toBeNull();
  });

  it('ranks a scoreless game on the clock, lowest first', () => {
    const posted = postable(run({ score: null, rankTimeS: 252.4 }));
    expect(posted).toEqual({ value: 252.4, display: '4:12.4', ranking: 'low' });
  });

  it('posts nothing for a scoreless game that handed over no time', () => {
    // Velodrome does this for a race it lost: the clock stopped when the
    // rival finished, and ranking that would put every defeat above every win.
    expect(postable(run({ score: null }))).toBeNull();
  });
});

describe('recordScore', () => {
  it('puts a run on the board and says where it landed', () => {
    const store = createMemoryStorage();
    const posted = recordScore(store, 'paperboy', 'RJC', run({ score: 400 }), 1);
    expect(posted.place).toBe(1);
    expect(boardFor(posted.boards, 'paperboy').entries[0]?.initials).toBe('RJC');
  });

  it('ranks a scored game highest first', () => {
    const store = createMemoryStorage();
    recordScore(store, 'paperboy', 'AAA', run({ score: 100 }), 1);
    recordScore(store, 'paperboy', 'BBB', run({ score: 900 }), 2);
    const third = recordScore(store, 'paperboy', 'CCC', run({ score: 400 }), 3);
    expect(third.place).toBe(2);
    expect(boardFor(third.boards, 'paperboy').entries.map((e) => e.initials))
      .toEqual(['BBB', 'CCC', 'AAA']);
  });

  it('ranks a timed game lowest first', () => {
    const store = createMemoryStorage();
    const timed = (t: number) => run({ score: null, rankTimeS: t });
    recordScore(store, 'velodrome', 'AAA', timed(260), 1);
    const faster = recordScore(store, 'velodrome', 'BBB', timed(248), 2);
    expect(faster.place).toBe(1);
    expect(boardFor(faster.boards, 'velodrome').ranking).toBe('low');
  });

  it('does not push a rider off the top with an equalled score', () => {
    const store = createMemoryStorage();
    recordScore(store, 'pack', 'AAA', run({ score: 500 }), 1);
    const tied = recordScore(store, 'pack', 'BBB', run({ score: 500 }), 2);
    expect(tied.place).toBe(2);
  });

  it('keeps only the places a cabinet shows', () => {
    const store = createMemoryStorage();
    for (let i = 0; i < BOARD_SIZE + 4; i++) {
      recordScore(store, 'fish', 'AAA', run({ score: i }), i + 1);
    }
    expect(boardFor(loadBoards(store), 'fish').entries).toHaveLength(BOARD_SIZE);
  });

  it('says so, and changes nothing, when a run does not make the board', () => {
    const store = createMemoryStorage();
    for (let i = 0; i < BOARD_SIZE; i++) {
      recordScore(store, 'fish', 'AAA', run({ score: 1000 + i }), i + 1);
    }
    const missed = recordScore(store, 'fish', 'ZZZ', run({ score: 1 }), 99);
    expect(missed.place).toBeNull();
    expect(missed.entry).toBeNull();
    expect(boardFor(missed.boards, 'fish').entries).toHaveLength(BOARD_SIZE);
  });

  it('leaves the board alone entirely for a stopped ride', () => {
    const store = createMemoryStorage();
    const posted = recordScore(store, 'pack', 'RJC', run({ stopped: true }), 1);
    expect(posted.place).toBeNull();
    expect(boardFor(loadBoards(store), 'pack').entries).toEqual([]);
  });

  it('keeps games apart', () => {
    const store = createMemoryStorage();
    recordScore(store, 'paperboy', 'AAA', run({ score: 400 }), 1);
    recordScore(store, 'pack', 'BBB', run({ score: 900 }), 2);
    expect(boardFor(loadBoards(store), 'paperboy').entries).toHaveLength(1);
    expect(boardFor(loadBoards(store), 'pack').entries[0]?.initials).toBe('BBB');
  });
});

describe('renameEntry', () => {
  it('lets the rider correct their initials after seeing the place', () => {
    const store = createMemoryStorage();
    recordScore(store, 'paperboy', DEFAULT_INITIALS, run({ score: 400 }), 7);
    const boards = renameEntry(store, 'paperboy', 7, 'rjc');
    expect(boardFor(boards, 'paperboy').entries[0]?.initials).toBe('RJC');
    expect(boardFor(loadBoards(store), 'paperboy').entries[0]?.initials).toBe('RJC');
  });

  it('does nothing for an entry that is not on the board', () => {
    const store = createMemoryStorage();
    recordScore(store, 'paperboy', 'AAA', run({ score: 400 }), 7);
    const boards = renameEntry(store, 'paperboy', 999, 'ZZZ');
    expect(boardFor(boards, 'paperboy').entries[0]?.initials).toBe('AAA');
  });
});

describe('loadBoards', () => {
  it('is empty for a rider who has never posted', () => {
    expect(loadBoards(createMemoryStorage())).toEqual({});
  });

  it('survives corrupt stored JSON rather than throwing on startup', () => {
    const store = createMemoryStorage();
    store.setItem(SCORES_KEY, '{{ not json');
    expect(loadBoards(store)).toEqual({});
  });

  it('drops stored entries with the wrong shape and keeps the rest', () => {
    const store = createMemoryStorage();
    store.setItem(SCORES_KEY, JSON.stringify({
      pack: { ranking: 'high', entries: [7, null, { initials: 'RJC', display: '9 m', value: 9, at: 1 }] },
    }));
    expect(boardFor(loadBoards(store), 'pack').entries).toHaveLength(1);
  });
});

describe('initials memory', () => {
  it('remembers the last three letters so they are typed once', () => {
    const store = createMemoryStorage();
    expect(loadInitials(store)).toBe(DEFAULT_INITIALS);
    saveInitials(store, 'rjc');
    expect(loadInitials(store)).toBe('RJC');
  });
});

describe('formatting', () => {
  it('says a lap time the way a track does', () => {
    expect(formatLapTime(252.44)).toBe('4:12.4');
    expect(formatLapTime(9.2)).toBe('0:09.2');
  });

  it('says a place the way a person would', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
  });
});
