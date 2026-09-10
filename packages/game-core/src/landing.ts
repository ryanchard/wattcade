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
export const PORCH_TOLERANCE_M = 0.8;
export const MAILBOX_TOLERANCE_M = 0.5;

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
