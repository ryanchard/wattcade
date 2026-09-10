import { describe, expect, it } from 'vitest';
import {
  HOUSE_MATCH_RADIUS_M, PORCH_LATERAL, PORCH_TOLERANCE_M, STREET_LATERAL,
  WINDOW_LATERAL, classifyLanding,
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
    expect(at(spec.mailboxLateral + 0.5).band).toBe('mailbox');
  });

  it('rejects a mailbox hit just outside tolerance', () => {
    // The low edge (mailboxLateral - tolerance) lands exactly on
    // PORCH_LATERAL for this fixture, which routes into the porch check
    // instead of ever reaching the mailbox tolerance test. Probe the high
    // edge instead, which stays unambiguously in mailbox territory.
    expect(at(spec.mailboxLateral + 0.51).band).toBe('lawn');
  });

  it('accepts a porch hit at the edge of tolerance', () => {
    // spec.porchLateral (1.9) + PORCH_TOLERANCE_M (0.8) = 2.7, which
    // overflows past PORCH_LATERAL (2.6) into mailbox territory (and, at
    // 0.4m from mailboxLateral, is well inside the mailbox tolerance too)
    // -- so it can never read back as 'porch'. Use a house whose porch
    // tolerance window fits entirely inside the porch zone instead.
    const near = { ...spec, porchLateral: 1.5 };
    const edge = near.porchLateral + PORCH_TOLERANCE_M;
    expect(classifyLanding({ distance: 100, lateral: edge }, [near]).band)
      .toBe('porch');
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
