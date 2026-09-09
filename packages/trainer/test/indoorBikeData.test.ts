import { describe, expect, it } from 'vitest';
import { parseIndoorBikeData } from '../src/ftms/indoorBikeData.js';

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe('parseIndoorBikeData', () => {
  it('reads instantaneous speed when the More Data bit is CLEAR', () => {
    // flags 0x0000 -> speed present. 0x0BB8 = 3000 = 30.00 km/h = 8.3333 m/s
    const d = parseIndoorBikeData(view(0x00, 0x00, 0xb8, 0x0b));
    expect(d.instantaneousSpeed).toBeCloseTo(8.3333, 3);
  });

  it('omits instantaneous speed when the More Data bit is SET', () => {
    // flags 0x0001 -> speed absent; bit 6 set -> power present at offset 2
    const d = parseIndoorBikeData(view(0x41, 0x00, 0xc8, 0x00));
    expect(d.instantaneousSpeed).toBeNull();
    expect(d.instantaneousPower).toBe(200);
  });

  it('decodes cadence at half-rpm resolution', () => {
    // flags 0x0004 -> More Data clear (speed present) + cadence.
    // speed 0x0BB8, cadence 0x00B4 = 180 = 90 rpm
    const d = parseIndoorBikeData(view(0x04, 0x00, 0xb8, 0x0b, 0xb4, 0x00));
    expect(d.instantaneousCadence).toBe(90);
  });

  it('decodes a realistic combined frame in field order', () => {
    // flags 0x0044 = cadence (bit2) + power (bit6), More Data clear
    // speed 3000, cadence 180, power 250
    const d = parseIndoorBikeData(
      view(0x44, 0x00, 0xb8, 0x0b, 0xb4, 0x00, 0xfa, 0x00),
    );
    expect(d.instantaneousSpeed).toBeCloseTo(8.3333, 3);
    expect(d.instantaneousCadence).toBe(90);
    expect(d.instantaneousPower).toBe(250);
  });

  it('reads total distance as a 24-bit little-endian value', () => {
    // flags 0x0010 -> More Data clear + total distance.
    // speed 3000, distance 0x0186A0 = 100000 m
    const d = parseIndoorBikeData(
      view(0x10, 0x00, 0xb8, 0x0b, 0xa0, 0x86, 0x01),
    );
    expect(d.totalDistance).toBe(100000);
  });

  it('decodes negative power as a signed value', () => {
    // flags 0x0041 -> More Data set (no speed) + power. -5 W
    const d = parseIndoorBikeData(view(0x41, 0x00, 0xfb, 0xff));
    expect(d.instantaneousPower).toBe(-5);
  });

  it('skips expended energy fields without losing alignment', () => {
    // flags 0x0341 = More Data (bit 0), Instantaneous Power (bit 6), Expended Energy (bit 8),
    // Heart Rate (bit 9). Energy is 5 bytes: u16 + u16 + u8.
    const d = parseIndoorBikeData(
      view(0x41, 0x03, 0xfa, 0x00, 0x64, 0x00, 0x32, 0x00, 0x05, 0x48),
    );
    expect(d.instantaneousPower).toBe(250);
    expect(d.heartRate).toBe(0x48);
  });

  it('returns all-null for a flags-only frame', () => {
    const d = parseIndoorBikeData(view(0x01, 0x00));
    expect(d.instantaneousPower).toBeNull();
    expect(d.instantaneousCadence).toBeNull();
  });
});
