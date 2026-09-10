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

    // Half-percent steps keep every value inside the +/-8 clamp, so the
    // final one is uniquely identifiable. Whole numbers would not be:
    // grade 8 and grade 9 both encode to 800 once clamped, and the test
    // could no longer tell "last value" from "second-to-last".
    for (let i = 0; i < 10; i++) w.setSimulation({ ...SIM, grade: i * 0.5 });
    await vi.advanceTimersByTimeAsync(0);

    expect(f.writes).toHaveLength(1);
    // The write carries the LAST value, grade 4.5 -> 450 -> 0x01C2
    expect(Array.from(f.writes[0]!).slice(3, 5)).toEqual([0xc2, 0x01]);
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

  it('keeps at most one queued simulation write when the trainer stops indicating, carrying the newest grade', async () => {
    // Regression for the unbounded-queue finding: if a trainer accepts
    // writes but stops indicating, the old code queued a new sim entry
    // every >=250 ms forever, each waiting out the full 2 s timeout before
    // the next was even attempted. A panic key issued minutes into that
    // backlog would sit behind every stale grade queued before it.
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport, {
      timeoutMs: 2000, simIntervalMs: 250,
    });
    await w.requestControl(); // succeeds normally: hasControl becomes true
    f.writes.length = 0;
    f.setAutoRespond(false); // now the trainer accepts writes but never indicates

    // The first setSimulation's flush becomes the in-flight write (queue
    // was empty), and gets stuck there since nothing ever indicates.
    // Every later one queues instead of appending.
    for (let i = 0; i < 5; i++) {
      w.setSimulation({ ...SIM, grade: i });
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(f.writes).toHaveLength(1); // only the first grade (0) ever went out

    // Let the stuck in-flight write time out so the pump moves on to
    // whatever is actually queued.
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.writes).toHaveLength(2);

    // If the queue had grown unbounded, this next write would carry grade
    // 1 (the second call), not grade 4 (the newest) -- so the value alone
    // distinguishes "replaced" from "appended".
    const grade4 = 4 * 100; // 400 -> 0x0190
    expect(Array.from(f.writes[1]!).slice(3, 5)).toEqual([
      grade4 & 0xff, (grade4 >> 8) & 0xff,
    ]);
  });

  it('writes a reset before any queued simulation command, even behind a backlog', async () => {
    const f = fakeTransport();
    const w = new ControlPointWriter(f.transport, {
      timeoutMs: 2000, simIntervalMs: 250,
    });
    await w.requestControl();
    f.writes.length = 0;
    f.setAutoRespond(false);

    // Occupy the in-flight slot with something else entirely (not a sim
    // write), so both the queued sim write and the later reset have to
    // wait behind it -- proving the reset jumps ahead of the backlog, not
    // merely ahead of same-kind entries.
    void w.stopOrPause(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.writes).toHaveLength(1); // stopOrPause is in flight, stuck

    // Queue a stale-in-waiting simulation write behind it.
    w.setSimulation({ ...SIM, grade: 6 });
    await vi.advanceTimersByTimeAsync(250);
    expect(f.writes).toHaveLength(1); // still just stopOrPause; the sim write only queued

    // The panic key: issued while that backlog sits ahead of it.
    void w.resetResistance();

    // Let stopOrPause's stuck write time out so the pump advances.
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.writes).toHaveLength(2);
    // The reset (grade 0), not the queued grade-6 sim write, must be next.
    expect(Array.from(f.writes[1]!).slice(3, 5)).toEqual([0x00, 0x00]);
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

  it('resolves an in-flight write when disposed mid-flight', async () => {
    const f = fakeTransport();
    f.setAutoRespond(false);
    const w = new ControlPointWriter(f.transport);
    const pending = w.requestControl();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.writes).toHaveLength(1); // in flight, no indication yet

    w.dispose();
    await expect(pending).resolves.toBe(false);
  });
});
