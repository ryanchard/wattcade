export interface RunResult {
  seed: number;
  score: number;
  distanceM: number;
  durationMs: number;
  avgPower: number;
  kilojoules: number;
  papersDelivered: number;
}

export interface Stats {
  highScore: number;
  bestDistanceM: number;
  lifetimePapers: number;
  runs: number;
  perSeedBest: Record<string, number>;
}

export const STORAGE_KEY = 'paperboy.stats.v1';

export const EMPTY_STATS: Stats = Object.freeze({
  highScore: 0,
  bestDistanceM: 0,
  lifetimePapers: 0,
  runs: 0,
  perSeedBest: {},
});

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export function loadStats(storage: Storage): Stats {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ...EMPTY_STATS, perSeedBest: {} };
  }
  if (raw === null) return { ...EMPTY_STATS, perSeedBest: {} };

  try {
    const parsed = JSON.parse(raw) as Partial<Stats>;
    const perSeed: Record<string, number> = {};
    if (typeof parsed.perSeedBest === 'object' && parsed.perSeedBest !== null) {
      for (const [k, v] of Object.entries(parsed.perSeedBest)) {
        perSeed[k] = num(v);
      }
    }
    return {
      highScore: num(parsed.highScore),
      bestDistanceM: num(parsed.bestDistanceM),
      lifetimePapers: num(parsed.lifetimePapers),
      runs: num(parsed.runs),
      perSeedBest: perSeed,
    };
  } catch {
    return { ...EMPTY_STATS, perSeedBest: {} };
  }
}

export function recordRun(result: RunResult, storage: Storage): Stats {
  const prev = loadStats(storage);
  const key = String(result.seed);
  const next: Stats = {
    highScore: Math.max(prev.highScore, result.score),
    bestDistanceM: Math.max(prev.bestDistanceM, result.distanceM),
    lifetimePapers: prev.lifetimePapers + result.papersDelivered,
    runs: prev.runs + 1,
    perSeedBest: {
      ...prev.perSeedBest,
      [key]: Math.max(prev.perSeedBest[key] ?? 0, result.score),
    },
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled store must not end the rider's run.
  }
  return next;
}

export function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k) { return map.get(k) ?? null; },
    key(i) { return [...map.keys()][i] ?? null; },
    removeItem(k) { map.delete(k); },
    setItem(k, v) { map.set(k, v); },
  };
}
