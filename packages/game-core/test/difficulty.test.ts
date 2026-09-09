import { describe, expect, it } from 'vitest';
import { difficultyAt } from '../src/difficulty.js';

describe('difficultyAt', () => {
  it('starts gently on the first block', () => {
    const d = difficultyAt(0);
    expect(d.hazardBudget).toBeLessThanOrEqual(3);
    expect(d.subscriberRatio).toBeGreaterThan(0.6);
  });

  it('never decreases hazard budget as blocks advance', () => {
    let prev = -Infinity;
    for (let i = 0; i < 60; i++) {
      const b = difficultyAt(i).hazardBudget;
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('never decreases traffic speed as blocks advance', () => {
    let prev = -Infinity;
    for (let i = 0; i < 60; i++) {
      const s = difficultyAt(i).trafficSpeed;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('caps every dimension so late blocks stay playable', () => {
    const late = difficultyAt(500);
    expect(late.hazardBudget).toBeLessThanOrEqual(10);
    expect(late.trafficSpeed).toBeLessThanOrEqual(16);
    expect(late.subscriberRatio).toBeGreaterThanOrEqual(0.35);
    expect(late.maxGradePercent).toBeLessThanOrEqual(8);
  });

  it('never exceeds the trainer grade clamp', () => {
    for (let i = 0; i < 500; i++) {
      expect(difficultyAt(i).maxGradePercent).toBeLessThanOrEqual(8);
    }
  });

  it('always leaves houses to deliver to', () => {
    for (let i = 0; i < 500; i++) {
      expect(difficultyAt(i).housesPerBlock).toBeGreaterThanOrEqual(4);
    }
  });
});
