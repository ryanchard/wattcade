import { parseIndoorBikeData } from '../ftms/indoorBikeData.js';
import type {
  SimulationParams,
  TrainerSample,
  TrainerSource,
  TrainerStatus,
  Unsubscribe,
} from '../types.js';

export interface CaptureFrame {
  t: number;
  hex: string;
}

export interface Capture {
  version: 1;
  device: string;
  recordedAt: string;
  frames: CaptureFrame[];
}

export interface ReplaySourceOptions {
  loop?: boolean;
  rate?: number;
}

const HEX_RE = /^[0-9a-fA-F]*$/;

function validateFrame(raw: unknown, index: number): CaptureFrame {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Capture frame ${index} must be an object.`);
  }
  const f = raw as Partial<CaptureFrame>;
  if (typeof f.t !== 'number' || !Number.isFinite(f.t)) {
    throw new Error(`Capture frame ${index} has a non-numeric "t".`);
  }
  if (typeof f.hex !== 'string') {
    throw new Error(`Capture frame ${index} is missing a string "hex".`);
  }
  if (f.hex.length % 2 !== 0) {
    throw new Error(
      `Capture frame ${index} has an odd-length "hex" (${f.hex.length} chars).`,
    );
  }
  if (!HEX_RE.test(f.hex)) {
    throw new Error(`Capture frame ${index} has non-hex characters in "hex".`);
  }
  return { t: f.t, hex: f.hex };
}

export function parseCapture(json: unknown): Capture {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Capture must be an object.');
  }
  const c = json as Partial<Capture>;
  if (c.version !== 1) {
    throw new Error(`Unsupported capture version: ${String(c.version)}`);
  }
  if (!Array.isArray(c.frames)) {
    throw new Error('Capture is missing a frames array.');
  }
  const frames = c.frames.map((f, i) => validateFrame(f, i));
  return {
    version: 1,
    device: typeof c.device === 'string' ? c.device : 'unknown',
    recordedAt: typeof c.recordedAt === 'string' ? c.recordedAt : '',
    frames,
  };
}

function hexToView(hex: string): DataView {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new DataView(bytes.buffer);
}

/**
 * Replays a recorded Bluetooth FTMS session in real time, decoding each
 * frame through the real parser. This is what lets the game be developed
 * and tuned against a real ride without being on the bike.
 *
 * There is no physical trainer behind this source: it cannot accept
 * resistance control, and `setSimulation` is a silent no-op.
 */
export class ReplaySource implements TrainerSource {
  readonly kind = 'replay' as const;
  readonly canControlResistance = false;

  #frames: CaptureFrame[];
  #device: string;
  #loop: boolean;
  #rate: number;
  #index = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;

  #sampleListeners = new Set<(s: TrainerSample) => void>();
  #statusListeners = new Set<(s: TrainerStatus) => void>();

  constructor(capture: Capture, options: ReplaySourceOptions = {}) {
    this.#frames = capture.frames;
    this.#device = capture.device;
    this.#loop = options.loop ?? false;
    this.#rate = options.rate ?? 1;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#index = 0;
    this.#statusListeners.forEach((fn) =>
      fn({
        kind: 'connected',
        deviceName: `${this.#device} (replay)`,
        canControlResistance: false,
        message: null,
      }),
    );
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#statusListeners.forEach((fn) =>
      fn({
        kind: 'disconnected',
        deviceName: null,
        canControlResistance: false,
        message: null,
      }),
    );
  }

  onSample(fn: (s: TrainerSample) => void): Unsubscribe {
    this.#sampleListeners.add(fn);
    return () => this.#sampleListeners.delete(fn);
  }

  onStatus(fn: (s: TrainerStatus) => void): Unsubscribe {
    this.#statusListeners.add(fn);
    return () => this.#statusListeners.delete(fn);
  }

  setSimulation(_p: SimulationParams): void {
    // Nothing to push resistance to.
  }

  #schedule(delayMs: number): void {
    this.#timer = setTimeout(() => this.#emitNext(), delayMs / this.#rate);
  }

  #emitNext(): void {
    if (!this.#running) return;
    const frame = this.#frames[this.#index];
    if (frame === undefined) {
      if (!this.#loop) return;
      this.#index = 0;
      this.#schedule(500);
      return;
    }

    const data = parseIndoorBikeData(hexToView(frame.hex));
    const sample: TrainerSample = {
      t: Date.now(),
      power: data.instantaneousPower,
      cadence: data.instantaneousCadence,
      speed: data.instantaneousSpeed,
      distance: data.totalDistance,
    };
    this.#sampleListeners.forEach((fn) => fn(sample));

    const next = this.#frames[this.#index + 1];
    this.#index += 1;
    if (next === undefined) {
      // Last frame with looping off: nothing more to schedule.
      if (!this.#loop) return;
      this.#schedule(500);
      return;
    }
    this.#schedule(Math.max(0, next.t - frame.t));
  }
}
