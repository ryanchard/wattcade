import { describe, expect, it } from 'vitest';
import {
  INITIAL_SCORE_STATE, MAX_MULTIPLIER, applyScoreEvent,
} from '../src/scoring.js';
import type { ScoreEvent, ScoreState } from '../src/scoring.js';

const run = (...events: ScoreEvent[]): ScoreState =>
  events.reduce(applyScoreEvent, INITIAL_SCORE_STATE);

describe('applyScoreEvent', () => {
  it('starts at zero with a 1x multiplier', () => {
    expect(INITIAL_SCORE_STATE.score).toBe(0);
    expect(INITIAL_SCORE_STATE.multiplier).toBe(1);
  });

  it('does not mutate the state it is given', () => {
    const before = { ...INITIAL_SCORE_STATE };
    applyScoreEvent(INITIAL_SCORE_STATE, { type: 'mailbox' });
    expect(INITIAL_SCORE_STATE).toEqual(before);
  });

  it('scores a mailbox at 500 and raises the multiplier', () => {
    const s = run({ type: 'mailbox' });
    expect(s.score).toBe(500);
    expect(s.multiplier).toBe(2);
  });

  it('scores a porch at 250 and raises the multiplier', () => {
    const s = run({ type: 'porch' });
    expect(s.score).toBe(250);
    expect(s.multiplier).toBe(2);
  });

  it('multiplies successive deliveries', () => {
    // 500*1 + 500*2 + 500*3 = 3000
    const s = run({ type: 'mailbox' }, { type: 'mailbox' }, { type: 'mailbox' });
    expect(s.score).toBe(3000);
    expect(s.multiplier).toBe(4);
  });

  it('caps the multiplier at 8', () => {
    const s = run(...Array(20).fill({ type: 'mailbox' } as ScoreEvent));
    expect(s.multiplier).toBe(MAX_MULTIPLIER);
  });

  it('resets the multiplier when a paper lands on the lawn', () => {
    const s = run({ type: 'mailbox' }, { type: 'mailbox' }, { type: 'lawn' });
    expect(s.multiplier).toBe(1);
    expect(s.score).toBe(1500);
  });

  it('resets the multiplier when a subscriber house is passed undelivered', () => {
    const s = run({ type: 'mailbox' }, { type: 'houseMissed' });
    expect(s.multiplier).toBe(1);
  });

  it('resets the multiplier on a crash', () => {
    const s = run({ type: 'mailbox' }, { type: 'mailbox' }, { type: 'crash' });
    expect(s.multiplier).toBe(1);
  });

  it('scores a non-subscriber window without touching the multiplier', () => {
    const s = run({ type: 'mailbox' }, { type: 'windowNonSubscriber' });
    expect(s.multiplier).toBe(2);   // unchanged by the window
    expect(s.score).toBe(500 + 100 * 2);
  });

  it('penalises a subscriber window flatly and resets the multiplier', () => {
    // Build to 4x, then smash a subscriber window: -250 unmultiplied.
    const s = run(
      { type: 'mailbox' }, { type: 'mailbox' }, { type: 'mailbox' },
      { type: 'windowSubscriber' },
    );
    expect(s.score).toBe(3000 - 250);
    expect(s.multiplier).toBe(1);
  });

  it('awards the block bonus unmultiplied', () => {
    const s = run(
      { type: 'mailbox' }, { type: 'mailbox' }, { type: 'blockCleared' },
    );
    expect(s.score).toBe(1500 + 1000);
    expect(s.multiplier).toBe(3);   // the bonus does not build the combo
  });

  it('never lets the score go negative', () => {
    const s = run({ type: 'windowSubscriber' }, { type: 'windowSubscriber' });
    expect(s.score).toBe(0);
  });

  it('counts delivered papers but not window smashes', () => {
    const s = run(
      { type: 'mailbox' }, { type: 'porch' },
      { type: 'windowNonSubscriber' }, { type: 'lawn' },
    );
    expect(s.papersDelivered).toBe(2);
  });

  it('tracks the current streak alongside the multiplier', () => {
    const s = run({ type: 'mailbox' }, { type: 'porch' }, { type: 'mailbox' });
    expect(s.streak).toBe(3);
    expect(applyScoreEvent(s, { type: 'crash' }).streak).toBe(0);
  });
});
