export type ScoreEvent =
  | { type: 'mailbox' }
  | { type: 'porch' }
  | { type: 'lawn' }
  | { type: 'windowNonSubscriber' }
  | { type: 'windowSubscriber' }
  | { type: 'houseMissed' }
  | { type: 'crash' }
  | { type: 'blockCleared' };

export interface ScoreState {
  score: number;
  multiplier: number;
  streak: number;
  papersDelivered: number;
}

export const MAX_MULTIPLIER = 8;

export const POINTS = {
  mailbox: 500,
  porch: 250,
  windowNonSubscriber: 100,
  windowSubscriberPenalty: 250,
  blockBonus: 1000,
} as const;

export const INITIAL_SCORE_STATE: ScoreState = Object.freeze({
  score: 0,
  multiplier: 1,
  streak: 0,
  papersDelivered: 0,
});

export function applyScoreEvent(s: ScoreState, e: ScoreEvent): ScoreState {
  const build = (points: number, delivered: boolean): ScoreState => ({
    score: s.score + points * s.multiplier,
    multiplier: Math.min(MAX_MULTIPLIER, s.multiplier + 1),
    streak: s.streak + 1,
    papersDelivered: s.papersDelivered + (delivered ? 1 : 0),
  });

  const breakCombo = (points: number): ScoreState => ({
    score: Math.max(0, s.score + points),
    multiplier: 1,
    streak: 0,
    papersDelivered: s.papersDelivered,
  });

  switch (e.type) {
    case 'mailbox':
      return build(POINTS.mailbox, true);
    case 'porch':
      return build(POINTS.porch, true);
    case 'lawn':
    case 'houseMissed':
    case 'crash':
      return breakCombo(0);
    case 'windowSubscriber':
      return breakCombo(-POINTS.windowSubscriberPenalty);
    case 'windowNonSubscriber':
      // Scores, but is neither a delivery nor a combo breaker.
      return {
        ...s,
        score: s.score + POINTS.windowNonSubscriber * s.multiplier,
      };
    case 'blockCleared':
      return { ...s, score: s.score + POINTS.blockBonus };
  }
}
