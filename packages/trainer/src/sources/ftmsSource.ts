import { parseIndoorBikeData } from '../ftms/indoorBikeData.js';
import { ControlPointWriter } from '../ftms/controlPointWriter.js';
import type {
  SimulationParams,
  TrainerSample,
  TrainerSource,
  TrainerStatus,
  Unsubscribe,
} from '../types.js';
import type { GattConnector, GattLink } from './gattLink.js';

export class FtmsSource implements TrainerSource {
  readonly kind = 'ftms' as const;

  #connect: GattConnector;
  #link: GattLink | null = null;
  #writer: ControlPointWriter | null = null;
  #teardown: Unsubscribe[] = [];
  #canControl = false;
  // Set synchronously at the top of start() and cleared as soon as the
  // in-flight #connect() call settles. start() awaits #connect(), so a
  // plain `#link !== null` check is not enough to stop a second concurrent
  // start() call — both calls could pass that check before either has
  // assigned #link. This flag closes that window.
  #connecting = false;

  #sampleListeners = new Set<(s: TrainerSample) => void>();
  #statusListeners = new Set<(s: TrainerStatus) => void>();

  constructor(connect: GattConnector) {
    this.#connect = connect;
  }

  get canControlResistance(): boolean {
    return this.#canControl;
  }

  async start(): Promise<void> {
    // Re-entrancy guard: a connection attempt already in flight, or a link
    // already established, means this call has nothing to do. Checking
    // #link alone would not be enough — two rapid calls can both observe
    // #link === null before either has awaited #connect() far enough to
    // assign it — so #connecting is set synchronously, before any await.
    if (this.#connecting || this.#link !== null) return;
    this.#connecting = true;

    this.#emitStatus('connecting', null, null);
    let link: GattLink;
    try {
      link = await this.#connect();
    } catch (err) {
      this.#connecting = false;
      this.#emitStatus('error', null, describeError(err));
      return;
    }
    this.#connecting = false;

    this.#link = link;
    this.#teardown.push(link.onDisconnect(() => this.#handleDisconnect()));
    this.#teardown.push(
      link.onIndoorBikeData((view) => this.#handleFrame(view)),
    );

    try {
      await link.startNotifications();
    } catch (err) {
      this.#emitStatus('error', link.deviceName, describeError(err));
      return;
    }

    if (link.controlPoint !== null) {
      const writer = new ControlPointWriter(link.controlPoint);
      this.#writer = writer;
      this.#canControl = await writer.requestControl();
      if (this.#canControl) await writer.startOrResume();
    }

    this.#emitStatus(
      'connected',
      link.deviceName,
      this.#canControl ? null : 'Resistance control unavailable — read-only.',
    );
  }

  async stop(): Promise<void> {
    // Nothing was ever established (or a connect attempt already failed
    // before assigning anything) — stopping is a no-op. In particular, do
    // not emit a 'disconnected' status a status-driven UI would read as a
    // disconnect that never happened.
    if (
      this.#link === null &&
      this.#writer === null &&
      this.#teardown.length === 0
    ) {
      return;
    }

    if (this.#writer !== null) {
      await this.#writer.resetResistance();
      this.#writer.dispose();
      this.#writer = null;
    }
    // Unsubscribe (including from onDisconnect) BEFORE calling
    // link.disconnect() below. link.disconnect() itself fires the
    // gattserverdisconnected event on a real device; if the onDisconnect
    // listener were still attached, that would re-enter #handleDisconnect
    // and emit a second, spurious 'disconnected' status. Do not reorder
    // these two steps.
    this.#teardown.forEach((fn) => fn());
    this.#teardown = [];
    this.#canControl = false;
    const link = this.#link;
    this.#link = null;
    if (link !== null) await link.disconnect();
    this.#emitStatus('disconnected', null, null);
  }

  onSample(fn: (s: TrainerSample) => void): Unsubscribe {
    this.#sampleListeners.add(fn);
    return () => this.#sampleListeners.delete(fn);
  }

  onStatus(fn: (s: TrainerStatus) => void): Unsubscribe {
    this.#statusListeners.add(fn);
    return () => this.#statusListeners.delete(fn);
  }

  setSimulation(p: SimulationParams): void {
    this.#writer?.setSimulation(p);
  }

  #handleFrame(view: DataView): void {
    let data;
    try {
      data = parseIndoorBikeData(view);
    } catch {
      return; // Truncated or malformed frame. Drop it, keep the connection.
    }
    const sample: TrainerSample = {
      t: Date.now(),
      power: data.instantaneousPower,
      cadence: data.instantaneousCadence,
      speed: data.instantaneousSpeed,
      distance: data.totalDistance,
    };
    this.#sampleListeners.forEach((fn) => fn(sample));
  }

  #handleDisconnect(): void {
    this.#canControl = false;
    this.#writer?.dispose();
    this.#writer = null;
    this.#emitStatus('disconnected', null, 'Trainer disconnected.');
  }

  #emitStatus(
    kind: TrainerStatus['kind'],
    deviceName: string | null,
    message: string | null,
  ): void {
    const status: TrainerStatus = {
      kind,
      deviceName,
      canControlResistance: this.#canControl,
      message,
    };
    this.#statusListeners.forEach((fn) => fn(status));
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
