import type { HouseSpec } from './route.js';

export interface Landing {
  distance: number;
  lateral: number;
}

export type LandingBand = 'window' | 'porch' | 'mailbox' | 'lawn' | 'street';

export interface LandingOutcome {
  band: LandingBand;
  house: HouseSpec | null;
}

/** How far along the street a paper may land and still count for a house. */
export const HOUSE_MATCH_RADIUS_M = 6;
/** Beyond this lateral the paper is in the road and counts for nothing. */
export const STREET_LATERAL = 3.7;
export const WINDOW_LATERAL = 1.4;
export const PORCH_LATERAL = 2.6;
// Tightened from an initial 0.8 / 0.5: at those widths, across every house
// the generator produces (porch 1.6-2.2, mailbox 2.9-3.3), a throw landing
// anywhere in the 1.40-3.60 lateral band scored SOMETHING -- 'lawn' was
// reachable only in the narrow 3.61-3.69 sliver (~4% of the throwable
// band). That trivialises throwing and makes the combo multiplier -- the
// game's main replay hook -- almost impossible to break. At 0.45 / 0.30, a
// miss is genuinely reachable: roughly 35-45% lawn, 26% mailbox, 29-39%
// porch across the generator's house range. Widening these again collapses
// the lawn outcome back to a sliver; if you touch these values, check the
// "a miss is reachable" property test in landing.test.ts still passes.
export const PORCH_TOLERANCE_M = 0.45;
export const MAILBOX_TOLERANCE_M = 0.3;

export function classifyLanding(
  landing: Landing,
  houses: readonly HouseSpec[],
): LandingOutcome {
  let nearest: HouseSpec | null = null;
  let best = HOUSE_MATCH_RADIUS_M;
  for (const h of houses) {
    const gap = Math.abs(h.distance - landing.distance);
    if (gap <= best) {
      best = gap;
      nearest = h;
    }
  }

  const l = landing.lateral;
  if (l >= STREET_LATERAL) return { band: 'street', house: nearest };
  if (nearest === null) return { band: 'lawn', house: null };

  if (l < WINDOW_LATERAL) return { band: 'window', house: nearest };
  if (l < PORCH_LATERAL) {
    return Math.abs(l - nearest.porchLateral) <= PORCH_TOLERANCE_M
      ? { band: 'porch', house: nearest }
      : { band: 'lawn', house: nearest };
  }
  return Math.abs(l - nearest.mailboxLateral) <= MAILBOX_TOLERANCE_M
    ? { band: 'mailbox', house: nearest }
    : { band: 'lawn', house: nearest };
}
