import type {
  SimulationParams,
  TrainerSample,
  TrainerSource,
  TrainerStatus,
  Unsubscribe,
} from '../types.js';

export interface KeyboardSourceOptions {
  target?: EventTarget;
  key?: string;
  maxWatts?: number;
  rampWattsPerSecond?: number;
  decayWattsPerSecond?: number;
  intervalMs?: number;
}

export class KeyboardSource implements TrainerSource {
  readonly kind = 'keyboard' as const;
  readonly canControlResistance = false;

  #target: EventTarget;
  #key: string;
  #maxWatts: number;
  #ramp: number;
  #decay: number;
  #intervalMs: number;

  #power = 0;
  #held = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  #sampleListeners = new Set<(s: TrainerSample) => void>();
  #statusListeners = new Set<(s: TrainerStatus) => void>();

  #onKeyDown = (e: Event) => {
    if ((e as KeyboardEvent).key.toLowerCase() === this.#key) this.#held = true;
  };
  #onKeyUp = (e: Event) => {
    if ((e as KeyboardEvent).key.toLowerCase() === this.#key) this.#held = false;
  };

  constructor(options: KeyboardSourceOptions = {}) {
    this.#target = options.target ?? globalThis;
    this.#key = (options.key ?? 'w').toLowerCase();
    this.#maxWatts = options.maxWatts ?? 340;
    this.#ramp = options.rampWattsPerSecond ?? 260;
    this.#decay = options.decayWattsPerSecond ?? 320;
    this.#intervalMs = options.intervalMs ?? 250;
  }

  async start(): Promise<void> {
    if (this.#timer !== null) return;
    this.#target.addEventListener('keydown', this.#onKeyDown);
    this.#target.addEventListener('keyup', this.#onKeyUp);
    this.#timer = setInterval(() => this.#tick(), this.#intervalMs);
    this.#emitStatus({
      kind: 'connected',
      deviceName: 'Keyboard (simulated)',
      canControlResistance: false,
      message: 'Hold W to pedal',
    });
  }

  async stop(): Promise<void> {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#target.removeEventListener('keydown', this.#onKeyDown);
    this.#target.removeEventListener('keyup', this.#onKeyUp);
    this.#held = false;
    this.#power = 0;
    this.#emitStatus({
      kind: 'disconnected',
      deviceName: null,
      canControlResistance: false,
      message: null,
    });
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
    // No trainer to push resistance to.
  }

  #tick(): void {
    const dt = this.#intervalMs / 1000;
    const delta = this.#held ? this.#ramp * dt : -this.#decay * dt;
    this.#power = Math.max(0, Math.min(this.#maxWatts, this.#power + delta));

    const cadence =
      this.#power < 5 ? 0 : Math.min(110, 62 + this.#power / 11);

    const sample: TrainerSample = {
      t: Date.now(),
      power: Math.round(this.#power),
      cadence: Math.round(cadence),
      speed: null,
      distance: null,
    };
    this.#sampleListeners.forEach((fn) => fn(sample));
  }

  #emitStatus(s: TrainerStatus): void {
    this.#statusListeners.forEach((fn) => fn(s));
  }
}
