import { describe, expect, it } from 'vitest';
import {
  clampGrade,
  encodeRequestControl,
  encodeSimulationParams,
  encodeStartOrResume,
  encodeStopOrPause,
  parseControlResponse,
} from '../src/ftms/controlPoint.js';

const bytes = (a: Uint8Array) => Array.from(a);

describe('control point encoding', () => {
  it('encodes Request Control as a bare opcode', () => {
    expect(bytes(encodeRequestControl())).toEqual([0x00]);
  });

  it('encodes Start/Resume as a bare opcode', () => {
    expect(bytes(encodeStartOrResume())).toEqual([0x07]);
  });

  it('encodes Stop as 0x08 0x01 and Pause as 0x08 0x02', () => {
    expect(bytes(encodeStopOrPause(false))).toEqual([0x08, 0x01]);
    expect(bytes(encodeStopOrPause(true))).toEqual([0x08, 0x02]);
  });

  it('encodes simulation parameters at spec resolutions', () => {
    // wind 0 m/s, grade 3.5% -> 350, crr 0.004 -> 40, cw 0.51 -> 51
    const out = encodeSimulationParams({
      grade: 3.5, headwind: 0, crr: 0.004, cw: 0.51,
    });
    expect(bytes(out)).toEqual([0x11, 0x00, 0x00, 0x5e, 0x01, 40, 51]);
  });

  it('encodes a negative grade as a signed little-endian value', () => {
    // -3.0% -> -300 -> 0xFED4
    const out = encodeSimulationParams({
      grade: -3, headwind: 0, crr: 0.004, cw: 0.51,
    });
    expect(bytes(out).slice(3, 5)).toEqual([0xd4, 0xfe]);
  });

  it('encodes headwind at 0.001 m/s resolution', () => {
    // 2.5 m/s -> 2500 -> 0x09C4
    const out = encodeSimulationParams({
      grade: 0, headwind: 2.5, crr: 0.004, cw: 0.51,
    });
    expect(bytes(out).slice(1, 3)).toEqual([0xc4, 0x09]);
  });

  it('clamps grade to +/- 8 percent', () => {
    expect(clampGrade(20)).toBe(8);
    expect(clampGrade(-20)).toBe(-8);
    expect(clampGrade(3.5)).toBe(3.5);
  });

  it('clamps grade during encoding, not just on request', () => {
    const out = encodeSimulationParams({
      grade: 99, headwind: 0, crr: 0.004, cw: 0.51,
    });
    // 8% -> 800 -> 0x0320
    expect(bytes(out).slice(3, 5)).toEqual([0x20, 0x03]);
  });

  it('parses a success indication', () => {
    const v = new DataView(Uint8Array.from([0x80, 0x11, 0x01]).buffer);
    const r = parseControlResponse(v);
    expect(r.requestOpcode).toBe(0x11);
    expect(r.resultCode).toBe(0x01);
    expect(r.success).toBe(true);
  });

  it('parses a failure indication', () => {
    const v = new DataView(Uint8Array.from([0x80, 0x00, 0x02]).buffer);
    expect(parseControlResponse(v).success).toBe(false);
  });
});
