import { describe, expect, it } from 'vitest';
import {
  HOUSE_MATCH_RADIUS_M, PORCH_LATERAL, STREET_LATERAL, WINDOW_LATERAL,
  classifyLanding,
} from '../src/landing.js';
import type { HouseSpec } from '../src/route.js';

const spec: HouseSpec = {
  id: 'h', distance: 100, subscriber: true,
  mailboxLateral: 3.1, porchLateral: 1.9, windowLateral: 0.9,
};
const at = (lateral: number, distance = 100) =>
  classifyLanding({ distance, lateral }, [spec]);

describe('band boundaries', () => {
  it('treats exactly the street threshold as street', () => {
    expect(at(STREET_LATERAL).band).toBe('street');
  });

  it('treats just inside the street threshold as a mailbox miss', () => {
    expect(at(STREET_LATERAL - 0.001).band).toBe('lawn');
  });

  it('treats exactly the window threshold as porch territory', () => {
    expect(at(WINDOW_LATERAL).band).not.toBe('window');
  });

  it('treats just inside the window threshold as a window', () => {
    expect(at(WINDOW_LATERAL - 0.001).band).toBe('window');
  });

  it('treats exactly the porch threshold as mailbox territory', () => {
    expect(at(PORCH_LATERAL).band).not.toBe('porch');
  });
});

describe('mailbox and porch tolerances', () => {
  it('accepts a mailbox hit at the edge of tolerance', () => {
    expect(at(spec.mailboxLateral + 0.3).band).toBe('mailbox');
  });

  it('rejects a mailbox hit just outside tolerance', () => {
    expect(at(spec.mailboxLateral - 0.31).band).toBe('lawn');
  });

  it('accepts a porch hit at the edge of tolerance', () => {
    // Not +0.45 (== PORCH_TOLERANCE_M) -- floating point makes
    // |2.35 - 1.9| evaluate to 0.45000000000000018, which fails the <=
    // comparison. 0.44 keeps this test about the tolerance, not about
    // float representation.
    expect(at(spec.porchLateral + 0.44).band).toBe('porch');
  });
});

describe('a miss must be reachable', () => {
  // The combo multiplier only means anything if throwing at a house can
  // actually miss. Pin that a genuine 'lawn' outcome exists in both the
  // porch and mailbox bands for a standard house, so nobody can widen
  // PORCH_TOLERANCE_M / MAILBOX_TOLERANCE_M back toward "always scores"
  // without a test failing.
  it('has a lawn gap in the mailbox band', () => {
    expect(at(spec.mailboxLateral - 0.31).band).toBe('lawn');
  });

  it('has a lawn gap in the porch band', () => {
    expect(at(spec.porchLateral + 0.46).band).toBe('lawn');
  });
});

describe('house matching along the street', () => {
  it('matches a house at exactly the radius', () => {
    expect(at(3.1, 100 + HOUSE_MATCH_RADIUS_M).house).toBe(spec);
  });

  it('does not match a house beyond the radius', () => {
    expect(at(3.1, 100 + HOUSE_MATCH_RADIUS_M + 0.01).house).toBeNull();
  });

  it('returns a lawn landing when no house matches', () => {
    expect(at(3.1, 500).band).toBe('lawn');
  });

  it('handles an empty street without throwing', () => {
    expect(classifyLanding({ distance: 10, lateral: 3.1 }, []).band).toBe('lawn');
  });
});
