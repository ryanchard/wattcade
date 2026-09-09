import type { SimulationParams } from '../types.js';

export const ControlOpcode = {
  RequestControl: 0x00,
  Reset: 0x01,
  StartOrResume: 0x07,
  StopOrPause: 0x08,
  SetIndoorBikeSimulation: 0x11,
} as const;

export const RESPONSE_OPCODE = 0x80;
export const RESULT_SUCCESS = 0x01;
export const MAX_GRADE_PERCENT = 8;

export function clampGrade(grade: number): number {
  // NaN indicates an upstream bug; send flat road as a safe default to a device a rider is sitting on.
  if (Number.isNaN(grade)) return 0;
  return Math.max(-MAX_GRADE_PERCENT, Math.min(MAX_GRADE_PERCENT, grade));
}

export function encodeRequestControl(): Uint8Array {
  return Uint8Array.from([ControlOpcode.RequestControl]);
}

export function encodeStartOrResume(): Uint8Array {
  return Uint8Array.from([ControlOpcode.StartOrResume]);
}

export function encodeStopOrPause(pause: boolean): Uint8Array {
  return Uint8Array.from([ControlOpcode.StopOrPause, pause ? 0x02 : 0x01]);
}

export function encodeSimulationParams(p: SimulationParams): Uint8Array {
  const buf = new ArrayBuffer(7);
  const v = new DataView(buf);
  v.setUint8(0, ControlOpcode.SetIndoorBikeSimulation);
  v.setInt16(1, Math.round(p.headwind * 1000), true);
  v.setInt16(3, Math.round(clampGrade(p.grade) * 100), true);
  v.setUint8(5, clampByte(Math.round(p.crr * 10000)));
  v.setUint8(6, clampByte(Math.round(p.cw * 100)));
  return new Uint8Array(buf);
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, n));
}

export interface ControlResponse {
  requestOpcode: number;
  resultCode: number;
  success: boolean;
}

export function parseControlResponse(view: DataView): ControlResponse {
  const requestOpcode = view.getUint8(1);
  const resultCode = view.getUint8(2);
  return {
    requestOpcode,
    resultCode,
    success: resultCode === RESULT_SUCCESS,
  };
}
