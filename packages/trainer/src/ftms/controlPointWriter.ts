import type { SimulationParams, Unsubscribe } from '../types.js';
import {
  encodeRequestControl,
  encodeSimulationParams,
  encodeStartOrResume,
  encodeStopOrPause,
  parseControlResponse,
} from './controlPoint.js';

export interface ControlPointTransport {
  write(data: Uint8Array): Promise<void>;
  onIndication(fn: (view: DataView) => void): Unsubscribe;
}

export interface ControlPointWriterOptions {
  timeoutMs?: number;
  simIntervalMs?: number;
}

interface QueueEntry {
  bytes: Uint8Array;
  resolve: (ok: boolean) => void;
}

export class ControlPointWriter {
  #transport: ControlPointTransport;
  #unsubscribe: Unsubscribe;
  #timeoutMs: number;
  #simIntervalMs: number;

  #queue: QueueEntry[] = [];
  #inFlight: QueueEntry | null = null;
  #inFlightTimer: ReturnType<typeof setTimeout> | null = null;

  #pendingSim: SimulationParams | null = null;
  #simTimer: ReturnType<typeof setTimeout> | null = null;
  #lastSimAt = Number.NEGATIVE_INFINITY;

  #hasControl = false;
  #disposed = false;

  constructor(
    transport: ControlPointTransport,
    options: ControlPointWriterOptions = {},
  ) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? 2000;
    this.#simIntervalMs = options.simIntervalMs ?? 250;
    this.#unsubscribe = transport.onIndication((v) => this.#onIndication(v));
  }

  get hasControl(): boolean {
    return this.#hasControl;
  }

  async requestControl(): Promise<boolean> {
    const ok = await this.#enqueue(encodeRequestControl());
    this.#hasControl = ok;
    return ok;
  }

  startOrResume(): Promise<boolean> {
    return this.#enqueue(encodeStartOrResume());
  }

  stopOrPause(pause: boolean): Promise<boolean> {
    return this.#enqueue(encodeStopOrPause(pause));
  }

  setSimulation(p: SimulationParams): void {
    if (this.#disposed || !this.#hasControl) return;
    this.#pendingSim = p;
    this.#scheduleSimFlush();
  }

  async resetResistance(): Promise<void> {
    if (this.#disposed || !this.#hasControl) return;
    this.#pendingSim = null;
    await this.#enqueue(
      encodeSimulationParams({ grade: 0, headwind: 0, crr: 0.004, cw: 0.51 }),
    );
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#simTimer !== null) clearTimeout(this.#simTimer);
    if (this.#inFlightTimer !== null) clearTimeout(this.#inFlightTimer);
    this.#simTimer = null;
    this.#inFlightTimer = null;
    this.#pendingSim = null;
    this.#queue.forEach((e) => e.resolve(false));
    this.#queue = [];
    this.#unsubscribe();
  }

  #scheduleSimFlush(): void {
    if (this.#simTimer !== null) return;
    const elapsed = Date.now() - this.#lastSimAt;
    const delay = Math.max(0, this.#simIntervalMs - elapsed);
    this.#simTimer = setTimeout(() => {
      this.#simTimer = null;
      this.#flushSim();
    }, delay);
  }

  #flushSim(): void {
    if (this.#disposed) return;
    const p = this.#pendingSim;
    if (p === null) return;
    this.#pendingSim = null;
    this.#lastSimAt = Date.now();
    void this.#enqueue(encodeSimulationParams(p));
  }

  #enqueue(bytes: Uint8Array): Promise<boolean> {
    if (this.#disposed) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.#queue.push({ bytes, resolve });
      void this.#pump();
    });
  }

  async #pump(): Promise<void> {
    if (this.#inFlight !== null) return;
    const next = this.#queue.shift();
    if (next === undefined) return;

    // IMPORTANT: assign #inFlight before awaiting the write below. The real
    // (and fake, in tests) transport can invoke the indication handler
    // synchronously from inside write(), so #inFlight must already be set
    // when that handler runs or the response is dropped and #settle is
    // never called, leaving the pump stalled forever.
    this.#inFlight = next;
    this.#inFlightTimer = setTimeout(() => this.#settle(false), this.#timeoutMs);

    try {
      await this.#transport.write(next.bytes);
    } catch {
      this.#settle(false);
    }
  }

  #onIndication(view: DataView): void {
    if (view.byteLength < 3) return;
    const res = parseControlResponse(view);
    if (this.#inFlight === null) return;
    if (res.requestOpcode !== this.#inFlight.bytes[0]) return;
    this.#settle(res.success);
  }

  #settle(ok: boolean): void {
    const entry = this.#inFlight;
    if (entry === null) return;
    if (this.#inFlightTimer !== null) clearTimeout(this.#inFlightTimer);
    this.#inFlightTimer = null;
    this.#inFlight = null;
    entry.resolve(ok);
    void this.#pump();
  }
}
