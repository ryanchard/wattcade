export interface IndoorBikeData {
  instantaneousSpeed: number | null;
  averageSpeed: number | null;
  instantaneousCadence: number | null;
  averageCadence: number | null;
  totalDistance: number | null;
  resistanceLevel: number | null;
  instantaneousPower: number | null;
  averagePower: number | null;
  heartRate: number | null;
  elapsedTime: number | null;
}

const Flag = {
  MoreData: 1 << 0,
  AverageSpeed: 1 << 1,
  InstantaneousCadence: 1 << 2,
  AverageCadence: 1 << 3,
  TotalDistance: 1 << 4,
  ResistanceLevel: 1 << 5,
  InstantaneousPower: 1 << 6,
  AveragePower: 1 << 7,
  ExpendedEnergy: 1 << 8,
  HeartRate: 1 << 9,
  MetabolicEquivalent: 1 << 10,
  ElapsedTime: 1 << 11,
  RemainingTime: 1 << 12,
} as const;

const KMH_TO_MS = 1 / 3.6;

/**
 * Parse a Bluetooth FTMS Indoor Bike Data notification.
 *
 * Throws RangeError if the buffer is shorter than the flags field declares.
 * Callers receiving live radio data must catch this error to avoid killing the connection.
 */
export function parseIndoorBikeData(view: DataView): IndoorBikeData {
  const flags = view.getUint16(0, true);
  let offset = 2;

  const has = (f: number) => (flags & f) !== 0;

  const u16 = () => {
    const v = view.getUint16(offset, true);
    offset += 2;
    return v;
  };
  const i16 = () => {
    const v = view.getInt16(offset, true);
    offset += 2;
    return v;
  };
  const u8 = () => {
    const v = view.getUint8(offset);
    offset += 1;
    return v;
  };
  const u24 = () => {
    const v =
      view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    offset += 3;
    return v;
  };

  const out: IndoorBikeData = {
    instantaneousSpeed: null,
    averageSpeed: null,
    instantaneousCadence: null,
    averageCadence: null,
    totalDistance: null,
    resistanceLevel: null,
    instantaneousPower: null,
    averagePower: null,
    heartRate: null,
    elapsedTime: null,
  };

  // Bit 0 is More Data. Instantaneous speed is present when it is CLEAR.
  if (!has(Flag.MoreData)) out.instantaneousSpeed = u16() * 0.01 * KMH_TO_MS;
  if (has(Flag.AverageSpeed)) out.averageSpeed = u16() * 0.01 * KMH_TO_MS;
  if (has(Flag.InstantaneousCadence)) out.instantaneousCadence = u16() * 0.5;
  if (has(Flag.AverageCadence)) out.averageCadence = u16() * 0.5;
  if (has(Flag.TotalDistance)) out.totalDistance = u24();
  if (has(Flag.ResistanceLevel)) out.resistanceLevel = i16();
  if (has(Flag.InstantaneousPower)) out.instantaneousPower = i16();
  if (has(Flag.AveragePower)) out.averagePower = i16();
  if (has(Flag.ExpendedEnergy)) {
    u16(); // total energy, kcal
    u16(); // energy per hour, kcal
    u8(); // energy per minute, kcal
  }
  if (has(Flag.HeartRate)) out.heartRate = u8();
  if (has(Flag.MetabolicEquivalent)) u8();
  if (has(Flag.ElapsedTime)) out.elapsedTime = u16();
  if (has(Flag.RemainingTime)) u16();

  return out;
}
