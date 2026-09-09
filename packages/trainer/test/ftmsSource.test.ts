import { describe, expect, it, vi } from 'vitest';
import { FtmsSource } from '../src/sources/ftmsSource.js';
import type { GattLink } from '../src/sources/gattLink.js';
import type { TrainerSample, TrainerStatus } from '../src/types.js';

/** flags 0x0044: speed present, cadence, power. 30 km/h, 90 rpm, 250 W. */
const FRAME = Uint8Array.from([0x44, 0x00, 0xb8, 0x0b, 0xb4, 0x00, 0xfa, 0x00]);

function fakeLink(opts: { withControl?: boolean; grantControl?: boolean } = {}) {
  const withControl = opts.withControl ?? true;
  const grantControl = opts.grantControl ?? true;

  let dataHandler: ((v: DataView) => void) | null = null;
  let disconnectHandler: (() => void) | null = null;
  let indicationHandler: ((v: DataView) => void) | null = null;
  const writes: Uint8Array[] = [];

  const link: GattLink = {
    deviceName: 'KICKR TEST',
    async startNotifications() {},
    onIndoorBikeData(fn) {
      dataHandler = fn;
      return () => { dataHandler = null; };
    },
    controlPoint: withControl
      ? {
          async write(data) {
            writes.push(data);
            indicationHandler?.(
              new DataView(
                Uint8Array.from([0x80, data[0]!, grantControl ? 0x01 : 0x02])
                  .buffer,
              ),
            );
          },
          onIndication(fn) {
            indicationHandler = fn;
            return () => { indicationHandler = null; };
          },
        }
      : null,
    onDisconnect(fn) {
      disconnectHandler = fn;
      return () => { disconnectHandler = null; };
    },
    async disconnect() {},
  };

  return {
    link,
    writes,
    emit: (bytes = FRAME) => dataHandler?.(new DataView(bytes.buffer)),
    drop: () => disconnectHandler?.(),
  };
}

describe('FtmsSource', () => {
  it('turns notifications into samples in SI units', async () => {
    const f = fakeLink();
    const src = new FtmsSource(async () => f.link);
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));

    await src.start();
    f.emit();

    expect(samples).toHaveLength(1);
    expect(samples[0]!.power).toBe(250);
    expect(samples[0]!.cadence).toBe(90);
    expect(samples[0]!.speed).toBeCloseTo(8.3333, 3);
  });

  it('requests control on connect and reports it as available', async () => {
    const f = fakeLink({ grantControl: true });
    const src = new FtmsSource(async () => f.link);
    await src.start();
    expect(Array.from(f.writes[0]!)).toEqual([0x00]);
    expect(src.canControlResistance).toBe(true);
  });

  it('continues read-only when the trainer refuses control', async () => {
    const f = fakeLink({ grantControl: false });
    const src = new FtmsSource(async () => f.link);
    await src.start();
    expect(src.canControlResistance).toBe(false);

    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    f.emit();
    expect(samples).toHaveLength(1);
  });

  it('continues read-only when the trainer exposes no control point', async () => {
    const f = fakeLink({ withControl: false });
    const src = new FtmsSource(async () => f.link);
    await src.start();
    expect(src.canControlResistance).toBe(false);
    expect(() =>
      src.setSimulation({ grade: 3, headwind: 0, crr: 0.004, cw: 0.51 }),
    ).not.toThrow();
  });

  it('reports connected status with the device name', async () => {
    const f = fakeLink();
    const src = new FtmsSource(async () => f.link);
    const statuses: TrainerStatus[] = [];
    src.onStatus((s) => statuses.push(s));
    await src.start();
    expect(statuses.at(-1)!.kind).toBe('connected');
    expect(statuses.at(-1)!.deviceName).toBe('KICKR TEST');
  });

  it('treats a disconnect as a status change, not an exception', async () => {
    const f = fakeLink();
    const src = new FtmsSource(async () => f.link);
    const statuses: TrainerStatus[] = [];
    src.onStatus((s) => statuses.push(s));
    await src.start();
    f.drop();
    expect(statuses.at(-1)!.kind).toBe('disconnected');
    expect(src.canControlResistance).toBe(false);
  });

  it('reports an error status when connecting fails', async () => {
    const src = new FtmsSource(async () => {
      throw new Error('User cancelled the requestDevice() chooser.');
    });
    const statuses: TrainerStatus[] = [];
    src.onStatus((s) => statuses.push(s));
    await src.start();
    expect(statuses.at(-1)!.kind).toBe('error');
    expect(statuses.at(-1)!.message).toContain('cancelled');
  });

  it('zeroes resistance on stop', async () => {
    const f = fakeLink();
    const src = new FtmsSource(async () => f.link);
    await src.start();
    f.writes.length = 0;
    await src.stop();
    const sim = f.writes.find((w) => w[0] === 0x11);
    expect(sim).toBeDefined();
    expect(Array.from(sim!).slice(3, 5)).toEqual([0x00, 0x00]);
  });

  it('ignores malformed frames without dropping the connection', async () => {
    const f = fakeLink();
    const src = new FtmsSource(async () => f.link);
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    f.emit(Uint8Array.from([0x44]));   // truncated: flags incomplete
    f.emit();                          // good frame still lands
    expect(samples).toHaveLength(1);
  });

  it('does not connect twice when start() is called twice in a row', async () => {
    const f = fakeLink();
    let calls = 0;
    const src = new FtmsSource(async () => {
      calls += 1;
      return f.link;
    });

    await Promise.all([src.start(), src.start()]);

    expect(calls).toBe(1);
  });

  it('connects again after stop() following a previous start()', async () => {
    const f = fakeLink();
    let calls = 0;
    const src = new FtmsSource(async () => {
      calls += 1;
      return f.link;
    });

    await src.start();
    await src.stop();
    await src.start();

    expect(calls).toBe(2);
  });
});
