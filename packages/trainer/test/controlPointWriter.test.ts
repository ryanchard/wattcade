import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlPointWriter } from '../src/ftms/controlPointWriter.js';
import type { ControlPointTransport } from '../src/ftms/controlPointWriter.js';

const SIM = { grade: 2, headwind: 0, crr: 0.004, cw: 0.51 };

function fakeTransport() {
  const writes: Uint8Array[] = [];
  let handler: ((v: DataView) => void) | null = null;
  let autoRespond = true;
  const transport: ControlPointTransport = {
    async write(data) {
      writes.push(data);
      if (autoRespond && handler) {
        // Respond as a real trainer does: success for the opcode just written.
        handler(new DataView(Uint8Array.from([0x80, data[0]!, 0x01]).buffer));
      }
    },
    onIndication(fn) {
      handler = fn;
      return () => { handler = null; };
    },
  };
  return {
    transport,
    writes,
    setAutoRespond(v: boolean) { autoRespond = v; },
    respond(opcode: number, result: number) {
      handler?.(new DataView(Uint8Array.from([0x80, opcode, result]).buffer));
    },
  };
}

describe('ControlPointWriter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ignores simulation updates until control has been granted', async () => {
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport);
    w.setSimulation(SIM);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.writes).toHaveLength(0);
    expect(w.hasControl).toBe(false);
  });

  it('reports control granted after a successful Request Control', async () => {
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport);
    await expect(w.requestControl()).resolves.toBe(true);
    expect(w.hasControl).toBe(true);
    expect(Array.from(f.writes[0]!)).toEqual([0x00]);
  });

  it('reports control refused when the trainer returns a failure code', async () => {
    const f = fakeTransport();
    f.setAutoRespond(false);
    const w = new ControlPointWriter(f.transport);
    const p = w.requestControl();
    await vi.advanceTimersByTimeAsync(0);
    f.respond(0x00, 0x02);
    await expect(p).resolves.toBe(false);
    expect(w.hasControl).toBe(false);
  });

  it('coalesces a burst of simulation updates into a single write', async () => {
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport);
    await w.requestControl();
    f.writes.length = 0;

    for (let i = 0; i < 10; i++) w.setSimulation({ ...SIM, grade: i });
    await vi.advanceTimersByTimeAsync(0);

    expect(f.writes).toHaveLength(1);
    // The write carries the LAST value, grade 9 -> clamped to 8 (encodeSimulationParams
    // enforces the +/-8% cap from Task 3) -> 800 -> 0x0320
    expect(Array.from(f.writes[0]!).slice(3, 5)).toEqual([0x20, 0x03]);
  });

  it('rate-limits simulation writes to the configured interval', async () => {
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport, { simIntervalMs: 250 });
    await w.requestControl();
    f.writes.length = 0;

    w.setSimulation({ ...SIM, grade: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.writes).toHaveLength(1);

    w.setSimulation({ ...SIM, grade: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.writes).toHaveLength(1); // too soon

    await vi.advanceTimersByTimeAsync(200);
    expect(f.writes).toHaveLength(2); // interval elapsed
  });

  it('never has more than one write outstanding', async () => {
    const f = fakeTransport();
    f.setAutoRespond(false);
    const w = new ControlPointWriter(f.transport);

    const a = w.requestControl();
    const b = w.startOrResume();
    await vi.advanceTimersByTimeAsync(0);

    expect(f.writes).toHaveLength(1); // b is still queued

    f.respond(0x00, 0x01);
    await a;
    await vi.advanceTimersByTimeAsync(0);
    expect(f.writes).toHaveLength(2);

    f.respond(0x07, 0x01);
    await expect(b).resolves.toBe(true);
  });

  it('resolves false when the trainer never indicates', async () => {
    const f = fakeTransport();
    f.setAutoRespond(false);
    const w = new ControlPointWriter(f.transport, { timeoutMs: 2000 });
    const p = w.requestControl();
    await vi.advanceTimersByTimeAsync(2001);
    await expect(p).resolves.toBe(false);
  });

  it('sends a zero grade immediately on resetResistance, bypassing the rate limit', async () => {
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport);
    await w.requestControl();
    w.setSimulation({ ...SIM, grade: 6 });
    await vi.advanceTimersByTimeAsync(0);
    f.writes.length = 0;

    await w.resetResistance();
    expect(f.writes).toHaveLength(1);
    expect(Array.from(f.writes[0]!).slice(3, 5)).toEqual([0x00, 0x00]);
  });

  it('stops writing after dispose', async () => {
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport);
    await w.requestControl();
    w.dispose();
    f.writes.length = 0;
    w.setSimulation(SIM);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.writes).toHaveLength(0);
  });
});
