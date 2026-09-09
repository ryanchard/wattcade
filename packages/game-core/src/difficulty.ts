export const BLOCK_LENGTH_M = 120;

export interface Difficulty {
  housesPerBlock: number;
  hazardBudget: number;
  trafficSpeed: number;
  subscriberRatio: number;
  maxGradePercent: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function difficultyAt(blockIndex: number): Difficulty {
  const i = Math.max(0, blockIndex);
  return {
    housesPerBlock: 6,
    hazardBudget: clamp(2 + Math.floor(i * 0.6), 2, 10),
    trafficSpeed: clamp(6 + i * 0.45, 6, 16),
    subscriberRatio: clamp(0.72 - i * 0.02, 0.35, 0.72),
    // Held below the 8% trainer clamp so terrain never saturates resistance.
    maxGradePercent: clamp(1 + i * 0.25, 1, 6),
  };
}
