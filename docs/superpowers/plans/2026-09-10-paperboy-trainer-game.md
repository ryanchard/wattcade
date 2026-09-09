# Paperboy Trainer Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser Paperboy game whose forward speed comes from pedalling a Wahoo KICKR over Web Bluetooth, implemented twice — once in plain Canvas 2D and once in Phaser 3 — against one shared trainer and rules layer.

**Architecture:** An npm-workspaces monorepo. `packages/trainer` owns everything from the radio to a speed number: FTMS decode/encode, a rate-limited control-point writer, three interchangeable `TrainerSource` implementations, and a forward-integrated physics model. `packages/game-core` owns seeded route generation, scoring, and persistence. Two apps consume both packages and share nothing else — each writes its own rendering, collision, and scene management, which is what makes the comparison meaningful.

**Tech Stack:** TypeScript 5.6+, Vite 5, Vitest 2, Phaser 3.86 (Version B only), Web Bluetooth. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-paperboy-trainer-game-design.md`

## Global Constraints

- **Browser support is Chromium only.** Chrome and Edge. Never add a Safari or Firefox code path — Web Bluetooth does not exist there and will not.
- **Secure context.** All dev servers bind `localhost`. Never assume file:// works.
- **User gesture.** `navigator.bluetooth.requestDevice()` may only be called from a real click handler.
- **All units are SI internally.** Metres, metres per second, seconds, watts, kilograms. Convert at the edges only: FTMS speed arrives as 0.01 km/h, cadence as 0.5 rpm.
- **Grade is clamped to ±8%** before it reaches the trainer, in `clampGrade`, with no exceptions and no caller-supplied override.
- **Control-point writes are serialised and rate-limited** to one outstanding write and at most 4 simulation updates per second.
- **No `any`.** `tsconfig` runs `strict: true`. Prefer explicit null over `undefined` for absent measurements.
- **Every package is testable headlessly.** Nothing in `packages/` may import `navigator`, `window`, or `document` at module scope.
- **Commit after every task.** Message style: `feat:`, `test:`, `fix:`, `chore:`.
- **No audio in v1.** The spec lists audio among the things the two apps would
  each own, but no feature in it requires sound. Nothing in this plan builds
  any, and nothing should.

---

## File Structure

**`packages/trainer/`** — everything between the radio and a speed number.

| File | Responsibility |
|------|----------------|
| `src/types.ts` | `TrainerSample`, `TrainerStatus`, `SimulationParams`, `TrainerSource`, `Unsubscribe` |
| `src/ftms/indoorBikeData.ts` | Decode the Indoor Bike Data flags bitfield |
| `src/ftms/controlPoint.ts` | Encode control-point opcodes, parse indications, `clampGrade` |
| `src/ftms/controlPointWriter.ts` | Serialisation, coalescing, rate limiting, timeouts |
| `src/ftms/uuids.ts` | GATT UUID constants |
| `src/sources/ftmsSource.ts` | Web Bluetooth glue implementing `TrainerSource` |
| `src/sources/keyboardSource.ts` | Hold-`W` fake trainer for development |
| `src/sources/replaySource.ts` | Plays back a recorded capture |
| `src/physics.ts` | `stepPhysics`, `steadyStateSpeed`, `RiderProfile` |
| `src/index.ts` | Public surface |

**`packages/game-core/`** — rules that both apps must obey identically.

| File | Responsibility |
|------|----------------|
| `src/rng.ts` | `mulberry32`, `seedFromString`, `dailySeed` |
| `src/route.ts` | `generateBlock`, block/house/hazard specs |
| `src/difficulty.ts` | `difficultyAt` — the ramp driving generation |
| `src/scoring.ts` | `applyScoreEvent`, the combo state machine |
| `src/persistence.ts` | localStorage stats |
| `src/index.ts` | Public surface |

**`apps/canvas/`** — Version A.

| File | Responsibility |
|------|----------------|
| `src/iso.ts` | `worldToScreen`, `depthKey` |
| `src/world.ts` | Live entity state, spawning from `BlockSpec`, despawning |
| `src/collision.ts` | Rider/hazard, paper/target tests |
| `src/render/*.ts` | Vector drawing per entity family |
| `src/game.ts` | Fixed-timestep loop, run lifecycle |
| `src/hud.ts`, `src/screens.ts` | HUD, menus, end-of-run card |
| `src/main.ts` | Bootstrap, trainer wiring |

**`apps/phaser/`** — Version B. Same responsibilities, Phaser idioms: `src/scenes/`, `src/entities/`, `src/iso.ts`, `src/main.ts`.

**`tools/ble-probe/`** — Milestone 0 diagnostic. `src/main.ts`, `index.html`.

---

## Phase 0 — Foundation

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/trainer/package.json`, `packages/trainer/tsconfig.json`, `packages/trainer/src/index.ts`
- Create: `packages/game-core/package.json`, `packages/game-core/tsconfig.json`, `packages/game-core/src/index.ts`
- Test: `packages/trainer/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: workspaces `@paperboy/trainer` and `@paperboy/game-core`, resolvable by name from any app. `npm test` runs Vitest across all workspaces.

- [ ] **Step 1: Write the root manifest**

```json
{
  "name": "paperboy",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*", "tools/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write the shared TypeScript config**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["web-bluetooth"]
  }
}
```

Add `@types/web-bluetooth` to root `devDependencies` — Web Bluetooth is not in TypeScript's default DOM lib.

Also write a root `tsconfig.json`, which is what `tsc --noEmit` resolves. It
must exist and must list every source root, or typechecking silently covers
nothing:

```json
{
  "extends": "./tsconfig.base.json",
  "include": [
    "packages/*/src", "packages/*/test",
    "apps/*/src", "apps/*/test",
    "tools/*/src"
  ]
}
```

- [ ] **Step 3: Write the package manifests**

`packages/trainer/package.json`:

```json
{
  "name": "@paperboy/trainer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/game-core/package.json` is identical with the name `@paperboy/game-core`.

Both get a `tsconfig.json` of `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`.

Pointing `main` at TypeScript source is deliberate: Vite compiles workspace sources directly, so the packages need no build step.

- [ ] **Step 4: Write the root Vitest config**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Write a smoke test proving the wiring**

`packages/trainer/test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('trainer package', () => {
  it('is importable', () => {
    expect(PACKAGE_NAME).toBe('@paperboy/trainer');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm install && npm test`
Expected: FAIL — `PACKAGE_NAME` is not exported.

- [ ] **Step 7: Make it pass**

`packages/trainer/src/index.ts`:

```ts
export const PACKAGE_NAME = '@paperboy/trainer';
```

`packages/game-core/src/index.ts`:

```ts
export const PACKAGE_NAME = '@paperboy/game-core';
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck`
Expected: 1 test passing, no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold npm workspaces monorepo with Vitest"
```

---

## Phase 1 — The trainer package

### Task 2: Indoor Bike Data parser

The single highest-risk piece of decoding in the project. Bit 0 of the flags field means *More Data*, and instantaneous speed is present when it is **clear** — the inverted sense is the most common cause of misaligned FTMS parsers. Every field is optional and every offset depends on the flags, so the parser walks the buffer with a cursor and never uses a fixed offset.

**Files:**
- Create: `packages/trainer/src/ftms/indoorBikeData.ts`
- Test: `packages/trainer/test/indoorBikeData.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface IndoorBikeData {
  instantaneousSpeed: number | null;    // m/s
  averageSpeed: number | null;          // m/s
  instantaneousCadence: number | null;  // rpm
  averageCadence: number | null;        // rpm
  totalDistance: number | null;         // m
  resistanceLevel: number | null;
  instantaneousPower: number | null;    // W
  averagePower: number | null;
  heartRate: number | null;             // bpm
  elapsedTime: number | null;           // s
}
export function parseIndoorBikeData(view: DataView): IndoorBikeData;
```

- [ ] **Step 1: Write the failing tests**

`packages/trainer/test/indoorBikeData.test.ts`:

```ts
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
    // flags 0x0141 = More Data set, power (bit6), expended energy (bit8),
    // then heart rate would follow. Energy is 5 bytes: u16 + u16 + u8.
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/trainer/test/indoorBikeData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

`packages/trainer/src/ftms/indoorBikeData.ts`:

```ts
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
```

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/trainer/test/indoorBikeData.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/trainer/src/ftms/indoorBikeData.ts packages/trainer/test/indoorBikeData.test.ts
git commit -m "feat: decode FTMS Indoor Bike Data notifications"
```

---

### Task 3: Control-point encoding

**Files:**
- Create: `packages/trainer/src/ftms/uuids.ts`
- Create: `packages/trainer/src/ftms/controlPoint.ts`
- Create: `packages/trainer/src/types.ts`
- Test: `packages/trainer/test/controlPoint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
// types.ts
export interface SimulationParams {
  grade: number;     // percent, e.g. 3.5 means 3.5%
  headwind: number;  // m/s, positive is a headwind
  crr: number;       // dimensionless rolling resistance coefficient
  cw: number;        // kg/m wind resistance coefficient
}

// controlPoint.ts
export const ControlOpcode: {
  RequestControl: 0x00; Reset: 0x01; StartOrResume: 0x07;
  StopOrPause: 0x08; SetIndoorBikeSimulation: 0x11;
};
export const MAX_GRADE_PERCENT: 8;
export function clampGrade(grade: number): number;
export function encodeRequestControl(): Uint8Array;
export function encodeStartOrResume(): Uint8Array;
export function encodeStopOrPause(pause: boolean): Uint8Array;
export function encodeSimulationParams(p: SimulationParams): Uint8Array;
export interface ControlResponse {
  requestOpcode: number; resultCode: number; success: boolean;
}
export function parseControlResponse(view: DataView): ControlResponse;
```

- [ ] **Step 1: Write the failing tests**

`packages/trainer/test/controlPoint.test.ts`:

```ts
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/trainer/test/controlPoint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the UUID constants**

`packages/trainer/src/ftms/uuids.ts`:

```ts
export const FITNESS_MACHINE_SERVICE = 0x1826;
export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_SPEED_CADENCE_SERVICE = 0x1816;
export const HEART_RATE_SERVICE = 0x180d;
export const DEVICE_INFORMATION_SERVICE = 0x180a;
export const BATTERY_SERVICE = 0x180f;

export const INDOOR_BIKE_DATA = 0x2ad2;
export const FITNESS_MACHINE_CONTROL_POINT = 0x2ad9;
export const FITNESS_MACHINE_FEATURE = 0x2acc;
export const FITNESS_MACHINE_STATUS = 0x2ada;
```

- [ ] **Step 4: Write the shared types**

`packages/trainer/src/types.ts`:

```ts
export type Unsubscribe = () => void;

export interface TrainerSample {
  t: number;
  power: number | null;
  cadence: number | null;
  speed: number | null;
  distance: number | null;
}

export type TrainerStatusKind =
  | 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface TrainerStatus {
  kind: TrainerStatusKind;
  deviceName: string | null;
  canControlResistance: boolean;
  message: string | null;
}

export interface SimulationParams {
  grade: number;
  headwind: number;
  crr: number;
  cw: number;
}

export interface TrainerSource {
  readonly kind: 'ftms' | 'keyboard' | 'replay';
  readonly canControlResistance: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  onSample(fn: (s: TrainerSample) => void): Unsubscribe;
  onStatus(fn: (s: TrainerStatus) => void): Unsubscribe;
  setSimulation(p: SimulationParams): void;
}
```

- [ ] **Step 5: Implement the encoders**

`packages/trainer/src/ftms/controlPoint.ts`:

```ts
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
```

- [ ] **Step 6: Verify**

Run: `npx vitest run packages/trainer/test/controlPoint.test.ts`
Expected: 10 passing.

- [ ] **Step 7: Commit**

```bash
git add packages/trainer/src/ftms packages/trainer/src/types.ts packages/trainer/test/controlPoint.test.ts
git commit -m "feat: encode FTMS control point commands with grade clamping"
```

---

### Task 4: The control-point writer

Encoding bytes is easy; sending them safely is not. A trainer will choke if the game writes a new grade every frame, and the GATT stack will reject a write issued while another is outstanding. This task owns all three protections — serialisation, coalescing, and the control gate — so no caller can forget them.

**Files:**
- Create: `packages/trainer/src/ftms/controlPointWriter.ts`
- Test: `packages/trainer/test/controlPointWriter.test.ts`

**Interfaces:**
- Consumes: `encodeRequestControl`, `encodeStartOrResume`, `encodeStopOrPause`, `encodeSimulationParams`, `parseControlResponse` from Task 3; `SimulationParams`, `Unsubscribe` from `../types.js`.
- Produces:

```ts
export interface ControlPointTransport {
  write(data: Uint8Array): Promise<void>;
  onIndication(fn: (view: DataView) => void): Unsubscribe;
}
export interface ControlPointWriterOptions {
  timeoutMs?: number;      // default 2000
  simIntervalMs?: number;  // default 250
}
export class ControlPointWriter {
  constructor(transport: ControlPointTransport, options?: ControlPointWriterOptions);
  readonly hasControl: boolean;
  requestControl(): Promise<boolean>;
  startOrResume(): Promise<boolean>;
  stopOrPause(pause: boolean): Promise<boolean>;
  setSimulation(p: SimulationParams): void;
  resetResistance(): Promise<void>;
  dispose(): void;
}
```

- [ ] **Step 1: Write the failing tests**

`packages/trainer/test/controlPointWriter.test.ts`:

```ts
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
    // The write carries the LAST value, grade 9 -> 900 -> 0x0384
    expect(Array.from(f.writes[0]!).slice(3, 5)).toEqual([0x84, 0x03]);
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/trainer/test/controlPointWriter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the writer**

`packages/trainer/src/ftms/controlPointWriter.ts`:

```ts
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
```

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/trainer/test/controlPointWriter.test.ts`
Expected: 9 passing.

If the "one write outstanding" test hangs, the cause is `#settle` being reached synchronously from inside `#pump`'s `await transport.write(...)`; the fake transport calls the indication handler before `#inFlight` is observable. The implementation above sets `#inFlight` *before* awaiting the write, which is what makes this correct — do not reorder those lines.

- [ ] **Step 5: Commit**

```bash
git add packages/trainer/src/ftms/controlPointWriter.ts packages/trainer/test/controlPointWriter.test.ts
git commit -m "feat: serialise, coalesce and rate-limit FTMS control point writes"
```

---

### Task 5: Rider physics

**Files:**
- Create: `packages/trainer/src/physics.ts`
- Test: `packages/trainer/test/physics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface RiderProfile {
  massKg: number;               // rider + bike
  ftpWatts: number;
  cdA: number;                  // m^2
  crr: number;
  drivetrainEfficiency: number;
}
export const DEFAULT_RIDER: RiderProfile;
export interface PhysicsState { speed: number; distance: number }
export interface PhysicsInput {
  powerWatts: number;
  gradePercent: number;
  crr: number;
  headwind: number;
}
export function stepPhysics(
  state: PhysicsState, input: PhysicsInput, rider: RiderProfile, dt: number,
): PhysicsState;
export function steadyStateSpeed(
  powerWatts: number, gradePercent: number, rider: RiderProfile,
): number;
export const V_MIN: 0.5;
```

- [ ] **Step 1: Write the failing tests**

`packages/trainer/test/physics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RIDER,
  stepPhysics,
  steadyStateSpeed,
} from '../src/physics.js';
import type { PhysicsState } from '../src/physics.js';

const flat = (powerWatts: number, crr = DEFAULT_RIDER.crr) => ({
  powerWatts, gradePercent: 0, crr, headwind: 0,
});

/** Integrate for `seconds` and return the resulting state. */
function settle(power: number, gradePercent: number, seconds = 400): PhysicsState {
  let s: PhysicsState = { speed: 0.5, distance: 0 };
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    s = stepPhysics(
      s,
      { powerWatts: power, gradePercent, crr: DEFAULT_RIDER.crr, headwind: 0 },
      DEFAULT_RIDER,
      dt,
    );
  }
  return s;
}

describe('stepPhysics', () => {
  it('settles 200 W on the flat in the low 30s km/h', () => {
    // Hand check: 194 W at the wheel against
    //   Crr*m*g = 0.005*85*9.80665 = 4.168 N
    //   0.5*rho*CdA = 0.196 kg/m
    // solves near 9.26 m/s = 33.3 km/h, which matches real-world road riding.
    const v = settle(200, 0).speed;
    expect(v).toBeGreaterThan(9.0);
    expect(v).toBeLessThan(9.5);
  });

  it('agrees with the closed-form steady state', () => {
    const integrated = settle(250, 0).speed;
    const closed = steadyStateSpeed(250, 0, DEFAULT_RIDER);
    expect(integrated).toBeCloseTo(closed, 1);
  });

  it('goes slower uphill than on the flat for the same power', () => {
    expect(settle(200, 4).speed).toBeLessThan(settle(200, 0).speed);
  });

  it('goes faster downhill than on the flat for the same power', () => {
    expect(settle(200, -4).speed).toBeGreaterThan(settle(200, 0).speed);
  });

  it('is monotonic in power', () => {
    const speeds = [100, 200, 300, 400].map((p) => settle(p, 0).speed);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    }
  });

  it('decays to a crawl when power stops', () => {
    let s: PhysicsState = { speed: 12, distance: 0 };
    for (let i = 0; i < 60 * 60; i++) {
      s = stepPhysics(s, flat(0), DEFAULT_RIDER, 1 / 60);
    }
    expect(s.speed).toBeLessThan(1);
    expect(s.speed).toBeGreaterThanOrEqual(0);
  });

  it('never produces a negative speed', () => {
    let s: PhysicsState = { speed: 0.2, distance: 0 };
    for (let i = 0; i < 600; i++) {
      s = stepPhysics(s, { powerWatts: 0, gradePercent: 8, crr: 0.02, headwind: 5 },
        DEFAULT_RIDER, 1 / 60);
    }
    expect(s.speed).toBeGreaterThanOrEqual(0);
  });

  it('slows the rider when rolling resistance spikes, as on grass', () => {
    const road = settle(200, 0).speed;
    let s: PhysicsState = { speed: road, distance: 0 };
    for (let i = 0; i < 120; i++) {
      s = stepPhysics(s, flat(200, 0.02), DEFAULT_RIDER, 1 / 60);
    }
    expect(s.speed).toBeLessThan(road);
  });

  it('accumulates distance as the integral of speed', () => {
    let s: PhysicsState = { speed: 10, distance: 0 };
    for (let i = 0; i < 60; i++) {
      s = stepPhysics(s, flat(0), DEFAULT_RIDER, 1 / 60);
    }
    // One second at roughly 10 m/s, decaying slightly.
    expect(s.distance).toBeGreaterThan(9);
    expect(s.distance).toBeLessThan(10);
  });

  it('is stable at a large timestep', () => {
    let s: PhysicsState = { speed: 0.5, distance: 0 };
    for (let i = 0; i < 200; i++) {
      s = stepPhysics(s, flat(400), DEFAULT_RIDER, 0.25);
    }
    expect(Number.isFinite(s.speed)).toBe(true);
    expect(s.speed).toBeLessThan(30);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/trainer/test/physics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the model**

`packages/trainer/src/physics.ts`:

```ts
export const G = 9.80665;
export const AIR_DENSITY = 1.225;

/**
 * Speed floor used when converting power to force. Below this the P/v term
 * would explode, so the model approximates a standing start rather than
 * modelling it exactly. The error is confined to the first instant of the
 * start and keeps the integrator stable.
 */
export const V_MIN = 0.5;

/** Ceiling that keeps a large timestep from integrating into nonsense. */
const V_MAX = 30;

export interface RiderProfile {
  massKg: number;
  ftpWatts: number;
  cdA: number;
  crr: number;
  drivetrainEfficiency: number;
}

export const DEFAULT_RIDER: RiderProfile = {
  massKg: 85,
  ftpWatts: 200,
  cdA: 0.32,
  crr: 0.005,
  drivetrainEfficiency: 0.97,
};

export interface PhysicsState {
  speed: number;
  distance: number;
}

export interface PhysicsInput {
  powerWatts: number;
  gradePercent: number;
  crr: number;
  headwind: number;
}

function resistiveForce(
  speed: number, input: PhysicsInput, rider: RiderProfile,
): number {
  const theta = Math.atan(input.gradePercent / 100);
  const gravity = rider.massKg * G * Math.sin(theta);
  const rolling = input.crr * rider.massKg * G * Math.cos(theta);
  const apparent = speed + input.headwind;
  const aero =
    0.5 * AIR_DENSITY * rider.cdA * apparent * Math.abs(apparent);
  return gravity + rolling + aero;
}

export function stepPhysics(
  state: PhysicsState,
  input: PhysicsInput,
  rider: RiderProfile,
  dt: number,
): PhysicsState {
  const wheelPower = Math.max(0, input.powerWatts) * rider.drivetrainEfficiency;
  const propulsion = wheelPower / Math.max(state.speed, V_MIN);
  const net = propulsion - resistiveForce(state.speed, input, rider);
  const accel = net / rider.massKg;

  let speed = state.speed + accel * dt;
  if (!Number.isFinite(speed) || speed < 0) speed = 0;
  if (speed > V_MAX) speed = V_MAX;

  return {
    speed,
    distance: state.distance + ((state.speed + speed) / 2) * dt,
  };
}

/** Closed-form steady state, by bisection. Used for tuning and tests. */
export function steadyStateSpeed(
  powerWatts: number,
  gradePercent: number,
  rider: RiderProfile,
): number {
  const wheelPower = Math.max(0, powerWatts) * rider.drivetrainEfficiency;
  const input: PhysicsInput = {
    powerWatts, gradePercent, crr: rider.crr, headwind: 0,
  };
  const excess = (v: number) =>
    wheelPower / Math.max(v, V_MIN) - resistiveForce(v, input, rider);

  let lo = 0;
  let hi = V_MAX;
  if (excess(hi) > 0) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (excess(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
```

Note the `apparent * Math.abs(apparent)` in the aero term: squaring alone would make a tailwind stronger than the rider's own motion push *backwards*. Using the signed square keeps drag opposing the direction of apparent airflow.

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/trainer/test/physics.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/trainer/src/physics.ts packages/trainer/test/physics.test.ts
git commit -m "feat: add forward-integrated rider physics model"
```

---

### Task 6: Keyboard trainer source

The development loop. Without this, every change to the game requires sitting on the bike, which will not happen and the project will stall. Build it before the real source.

**Files:**
- Create: `packages/trainer/src/sources/keyboardSource.ts`
- Test: `packages/trainer/test/keyboardSource.test.ts`

**Interfaces:**
- Consumes: `TrainerSource`, `TrainerSample`, `TrainerStatus`, `SimulationParams`, `Unsubscribe` from `../types.js`.
- Produces:

```ts
export interface KeyboardSourceOptions {
  target?: EventTarget;       // default globalThis — injectable for tests
  key?: string;               // default 'w'
  maxWatts?: number;          // default 340
  rampWattsPerSecond?: number;    // default 260
  decayWattsPerSecond?: number;   // default 320
  intervalMs?: number;        // default 250, mimicking a real notify rate
}
export class KeyboardSource implements TrainerSource {
  constructor(options?: KeyboardSourceOptions);
}
```

- [ ] **Step 1: Write the failing tests**

`packages/trainer/test/keyboardSource.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardSource } from '../src/sources/keyboardSource.js';
import type { TrainerSample } from '../src/types.js';

function harness() {
  const target = new EventTarget();
  const source = new KeyboardSource({ target, intervalMs: 100 });
  const samples: TrainerSample[] = [];
  source.onSample((s) => samples.push(s));
  const press = () =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
  const release = () =>
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
  return { source, samples, press, release };
}

describe('KeyboardSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('declares itself unable to control resistance', () => {
    expect(new KeyboardSource().canControlResistance).toBe(false);
  });

  it('emits zero power at rest', async () => {
    const h = harness();
    await h.source.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.samples.length).toBeGreaterThan(0);
    expect(h.samples.at(-1)!.power).toBe(0);
  });

  it('ramps power up while the key is held', async () => {
    const h = harness();
    await h.source.start();
    h.press();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.samples.at(-1)!.power).toBeGreaterThan(100);
  });

  it('decays power after the key is released', async () => {
    const h = harness();
    await h.source.start();
    h.press();
    await vi.advanceTimersByTimeAsync(1000);
    const peak = h.samples.at(-1)!.power!;
    h.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.samples.at(-1)!.power!).toBeLessThan(peak);
  });

  it('never exceeds the configured maximum', async () => {
    const target = new EventTarget();
    const source = new KeyboardSource({ target, intervalMs: 100, maxWatts: 300 });
    const samples: TrainerSample[] = [];
    source.onSample((s) => samples.push(s));
    await source.start();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Math.max(...samples.map((s) => s.power!))).toBeLessThanOrEqual(300);
  });

  it('reports a plausible cadence that is zero at zero power', async () => {
    const h = harness();
    await h.source.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.samples.at(-1)!.cadence).toBe(0);
    h.press();
    await vi.advanceTimersByTimeAsync(1000);
    const c = h.samples.at(-1)!.cadence!;
    expect(c).toBeGreaterThan(60);
    expect(c).toBeLessThanOrEqual(110);
  });

  it('accepts setSimulation as a no-op', async () => {
    const h = harness();
    await h.source.start();
    expect(() =>
      h.source.setSimulation({ grade: 5, headwind: 0, crr: 0.004, cw: 0.51 }),
    ).not.toThrow();
  });

  it('stops emitting after stop()', async () => {
    const h = harness();
    await h.source.start();
    await vi.advanceTimersByTimeAsync(300);
    await h.source.stop();
    const n = h.samples.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.samples.length).toBe(n);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/trainer/test/keyboardSource.test.ts`
Expected: FAIL — module not found.

This test uses `KeyboardEvent`, which needs a DOM. Add to `vitest.config.ts` so the trainer package runs in a DOM environment:

```ts
environmentMatchGlobs: [['packages/trainer/test/**', 'happy-dom']],
```

and add `happy-dom` to root `devDependencies`.

- [ ] **Step 3: Implement the source**

`packages/trainer/src/sources/keyboardSource.ts`:

```ts
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
```

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/trainer/test/keyboardSource.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/trainer/src/sources/keyboardSource.ts packages/trainer/test/keyboardSource.test.ts vitest.config.ts package.json
git commit -m "feat: add keyboard trainer source for hardware-free development"
```

---

### Task 7: FTMS source over a testable seam

`navigator.bluetooth` cannot be exercised in CI, so it is quarantined behind a `GattConnector` function. `FtmsSource` — which holds all the connection-lifecycle logic worth testing — talks only to that seam and is fully covered by tests. Only `createWebBluetoothConnector` touches the real radio, and it is verified by hand in Task 8.

**Files:**
- Create: `packages/trainer/src/sources/gattLink.ts`
- Create: `packages/trainer/src/sources/ftmsSource.ts`
- Modify: `packages/trainer/src/index.ts`
- Test: `packages/trainer/test/ftmsSource.test.ts`

**Interfaces:**
- Consumes: `parseIndoorBikeData` (Task 2), `ControlPointWriter`/`ControlPointTransport` (Task 4), UUID constants (Task 3), types.
- Produces:

```ts
// gattLink.ts
export interface GattLink {
  deviceName: string | null;
  startNotifications(): Promise<void>;
  onIndoorBikeData(fn: (view: DataView) => void): Unsubscribe;
  controlPoint: ControlPointTransport | null;
  onDisconnect(fn: () => void): Unsubscribe;
  disconnect(): Promise<void>;
}
export type GattConnector = () => Promise<GattLink>;
export function createWebBluetoothConnector(): GattConnector;

// ftmsSource.ts
export class FtmsSource implements TrainerSource {
  constructor(connect: GattConnector);
}
```

- [ ] **Step 1: Write the failing tests**

`packages/trainer/test/ftmsSource.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/trainer/test/ftmsSource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the GATT seam**

`packages/trainer/src/sources/gattLink.ts`:

```ts
import type { ControlPointTransport } from '../ftms/controlPointWriter.js';
import type { Unsubscribe } from '../types.js';
import {
  BATTERY_SERVICE,
  CYCLING_POWER_SERVICE,
  CYCLING_SPEED_CADENCE_SERVICE,
  DEVICE_INFORMATION_SERVICE,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
} from '../ftms/uuids.js';

export interface GattLink {
  deviceName: string | null;
  startNotifications(): Promise<void>;
  onIndoorBikeData(fn: (view: DataView) => void): Unsubscribe;
  controlPoint: ControlPointTransport | null;
  onDisconnect(fn: () => void): Unsubscribe;
  disconnect(): Promise<void>;
}

export type GattConnector = () => Promise<GattLink>;

export const OPTIONAL_SERVICES = [
  CYCLING_POWER_SERVICE,
  CYCLING_SPEED_CADENCE_SERVICE,
  HEART_RATE_SERVICE,
  DEVICE_INFORMATION_SERVICE,
  BATTERY_SERVICE,
];

/**
 * The only code in the project that touches navigator.bluetooth.
 * Must be invoked from a user gesture.
 */
export function createWebBluetoothConnector(): GattConnector {
  return async () => {
    if (!('bluetooth' in navigator)) {
      throw new Error(
        'Web Bluetooth is not available. Use Chrome or Edge on desktop or Android.',
      );
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FITNESS_MACHINE_SERVICE] }],
      optionalServices: OPTIONAL_SERVICES,
    });

    const server = await device.gatt!.connect();
    const ftms = await server.getPrimaryService(FITNESS_MACHINE_SERVICE);
    const bikeData = await ftms.getCharacteristic(INDOOR_BIKE_DATA);

    let control: ControlPointTransport | null = null;
    try {
      const cp = await ftms.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT);
      await cp.startNotifications();
      control = {
        async write(data) {
          await cp.writeValueWithResponse(data);
        },
        onIndication(fn) {
          const h = (e: Event) => {
            const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
            if (v) fn(v);
          };
          cp.addEventListener('characteristicvaluechanged', h);
          return () => cp.removeEventListener('characteristicvaluechanged', h);
        },
      };
    } catch {
      control = null; // Trainer exposes no control point; read-only is fine.
    }

    return {
      deviceName: device.name ?? null,
      async startNotifications() {
        await bikeData.startNotifications();
      },
      onIndoorBikeData(fn) {
        const h = (e: Event) => {
          const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
          if (v) fn(v);
        };
        bikeData.addEventListener('characteristicvaluechanged', h);
        return () =>
          bikeData.removeEventListener('characteristicvaluechanged', h);
      },
      controlPoint: control,
      onDisconnect(fn) {
        device.addEventListener('gattserverdisconnected', fn);
        return () => device.removeEventListener('gattserverdisconnected', fn);
      },
      async disconnect() {
        if (device.gatt?.connected) device.gatt.disconnect();
      },
    };
  };
}
```

- [ ] **Step 4: Implement the source**

`packages/trainer/src/sources/ftmsSource.ts`:

```ts
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

  #sampleListeners = new Set<(s: TrainerSample) => void>();
  #statusListeners = new Set<(s: TrainerStatus) => void>();

  constructor(connect: GattConnector) {
    this.#connect = connect;
  }

  get canControlResistance(): boolean {
    return this.#canControl;
  }

  async start(): Promise<void> {
    this.#emitStatus('connecting', null, null);
    let link: GattLink;
    try {
      link = await this.#connect();
    } catch (err) {
      this.#emitStatus('error', null, describeError(err));
      return;
    }

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
    if (this.#writer !== null) {
      await this.#writer.resetResistance();
      this.#writer.dispose();
      this.#writer = null;
    }
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
```

- [ ] **Step 5: Export the public surface**

`packages/trainer/src/index.ts`:

```ts
export * from './types.js';
export * from './physics.js';
export * from './ftms/uuids.js';
export * from './ftms/indoorBikeData.js';
export * from './ftms/controlPoint.js';
export * from './ftms/controlPointWriter.js';
export * from './sources/gattLink.js';
export * from './sources/ftmsSource.js';
export * from './sources/keyboardSource.js';

export const PACKAGE_NAME = '@paperboy/trainer';
```

- [ ] **Step 6: Verify**

Run: `npx vitest run packages/trainer && npm run typecheck`
Expected: all trainer tests passing, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/trainer
git commit -m "feat: add FTMS trainer source behind a testable GATT seam"
```

---

### Task 8: Milestone 0 — the hardware probe

**This is a gate, not a feature.** It answers the one question no test can: whether this KICKR's firmware accepts simulation-parameter writes from a browser. Do not start Phase 3 until it has been run against the real trainer and its capture saved.

**Files:**
- Create: `tools/ble-probe/package.json`, `tools/ble-probe/index.html`, `tools/ble-probe/vite.config.ts`, `tools/ble-probe/src/main.ts`

**Interfaces:**
- Consumes: `createWebBluetoothConnector`, `FtmsSource`, `parseIndoorBikeData`, `ControlPointWriter`, UUID constants — all from `@paperboy/trainer`.
- Produces: a downloadable capture file matching the `Capture` shape defined in Task 9.

- [ ] **Step 1: Scaffold the tool**

`tools/ble-probe/package.json`:

```json
{
  "name": "@paperboy/ble-probe",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": { "@paperboy/trainer": "*" }
}
```

`tools/ble-probe/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5180, host: 'localhost' } });
```

`tools/ble-probe/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>KICKR probe</title>
    <style>
      body { font: 14px ui-monospace, monospace; margin: 2rem; max-width: 60rem; }
      button { font: inherit; padding: .5rem 1rem; margin-right: .5rem; }
      #log { white-space: pre-wrap; border: 1px solid #ccc; padding: 1rem;
             height: 24rem; overflow: auto; margin-top: 1rem; }
      .live { display: flex; gap: 2rem; margin-top: 1rem; font-size: 1.5rem; }
    </style>
  </head>
  <body>
    <h1>KICKR probe</h1>
    <p>Close Zwift and the Wahoo app first — a trainer pairs to one client at a time.</p>
    <button id="connect">Connect</button>
    <button id="sweep" disabled>Run grade sweep</button>
    <button id="download" disabled>Download capture</button>
    <div class="live">
      <div>Power <b id="power">—</b> W</div>
      <div>Cadence <b id="cadence">—</b> rpm</div>
      <div>Speed <b id="speed">—</b> km/h</div>
    </div>
    <div id="log"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the probe**

`tools/ble-probe/src/main.ts`:

```ts
import {
  ControlPointWriter,
  createWebBluetoothConnector,
  parseIndoorBikeData,
} from '@paperboy/trainer';
import type { GattLink } from '@paperboy/trainer';

const $ = (id: string) => document.getElementById(id)!;
const logEl = $('log');
const frames: { t: number; hex: string }[] = [];
let link: GattLink | null = null;
let writer: ControlPointWriter | null = null;
let deviceName = 'unknown';

function log(msg: string): void {
  logEl.textContent += `${new Date().toISOString().slice(11, 23)}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

const hex = (v: DataView) =>
  Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

$('connect').addEventListener('click', async () => {
  try {
    log('Requesting device…');
    link = await createWebBluetoothConnector()();
    deviceName = link.deviceName ?? 'unknown';
    log(`Connected to ${deviceName}`);
    log(`Control point present: ${link.controlPoint !== null}`);

    link.onDisconnect(() => log('!! gattserverdisconnected'));

    link.onIndoorBikeData((view) => {
      const raw = hex(view);
      frames.push({ t: Date.now(), hex: raw });
      const d = parseIndoorBikeData(view);
      $('power').textContent = d.instantaneousPower?.toString() ?? '—';
      $('cadence').textContent = d.instantaneousCadence?.toString() ?? '—';
      $('speed').textContent =
        d.instantaneousSpeed === null
          ? '—'
          : (d.instantaneousSpeed * 3.6).toFixed(1);
      if (frames.length % 10 === 1) log(`raw ${raw}`);
    });

    await link.startNotifications();
    log('Subscribed to Indoor Bike Data.');

    if (link.controlPoint !== null) {
      writer = new ControlPointWriter(link.controlPoint);
      const granted = await writer.requestControl();
      log(`Request Control -> ${granted ? 'GRANTED' : 'REFUSED'}`);
      if (granted) {
        log(`Start/Resume -> ${await writer.startOrResume()}`);
        ($('sweep') as HTMLButtonElement).disabled = false;
      }
    }
    ($('download') as HTMLButtonElement).disabled = false;
  } catch (err) {
    log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
});

$('sweep').addEventListener('click', async () => {
  if (writer === null) return;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const grade of [0, 2, 4, 6, 3, 0, -3, 0]) {
    log(`grade -> ${grade}%  (pedal and report what you feel)`);
    writer.setSimulation({ grade, headwind: 0, crr: 0.004, cw: 0.51 });
    await wait(6000);
  }
  await writer.resetResistance();
  log('Sweep complete, resistance reset to 0%.');
});

$('download').addEventListener('click', () => {
  const capture = {
    version: 1 as const,
    device: deviceName,
    recordedAt: new Date().toISOString(),
    frames,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kickr-capture.json';
  a.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('beforeunload', () => {
  void writer?.resetResistance();
});
```

- [ ] **Step 3: Run it against the real trainer**

Run: `npm install && npm --workspace @paperboy/ble-probe run dev`
Open `http://localhost:5180` in Chrome. Wake the trainer by pedalling before connecting.

Record the answers to these, since they decide what Phase 4 can rely on:

1. Does the device chooser list the KICKR? If it is empty, check that Zwift and the Wahoo app are closed and that Chrome has Bluetooth permission in macOS System Settings.
2. Does `Control point present` say true?
3. Does `Request Control` say GRANTED?
4. **During the sweep, does pedalling effort actually change at 4% and 6%?** This is the question the whole milestone exists for.
5. Do the decoded power and cadence match what the Wahoo app shows for the same effort?

- [ ] **Step 4: Save the capture as a test fixture**

Ride for at least 60 seconds with varied effort, download the capture, and commit it:

```bash
mkdir -p packages/trainer/test/fixtures
cp ~/Downloads/kickr-capture.json packages/trainer/test/fixtures/kickr-capture.json
```

- [ ] **Step 5: Commit**

```bash
git add tools/ble-probe packages/trainer/test/fixtures
git commit -m "feat: add Milestone 0 hardware probe and record a real KICKR capture"
```

**Gate:** if question 4 is "no", `canControlResistance` will be false in practice. The game still works — it degrades to read-only arcade tuning as the spec allows — but note it before continuing, because the terrain-feedback parts of Phase 4 become visual only.

---

### Task 9: Replay trainer source

Turns the Task 8 capture into a repeatable input. This is what makes game feel tunable against a real ride without being on the bike, and it double-checks the Task 2 parser against genuine hardware output rather than hand-built vectors.

**Files:**
- Create: `packages/trainer/src/sources/replaySource.ts`
- Modify: `packages/trainer/src/index.ts`
- Test: `packages/trainer/test/replaySource.test.ts`

**Interfaces:**
- Consumes: `parseIndoorBikeData` (Task 2), types.
- Produces:

```ts
export interface CaptureFrame { t: number; hex: string }
export interface Capture {
  version: 1;
  device: string;
  recordedAt: string;
  frames: CaptureFrame[];
}
export interface ReplaySourceOptions { loop?: boolean; rate?: number }
export class ReplaySource implements TrainerSource {
  constructor(capture: Capture, options?: ReplaySourceOptions);
}
export function parseCapture(json: unknown): Capture;
```

- [ ] **Step 1: Write the failing tests**

`packages/trainer/test/replaySource.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplaySource, parseCapture } from '../src/sources/replaySource.js';
import type { Capture } from '../src/sources/replaySource.js';
import type { TrainerSample } from '../src/types.js';

const capture: Capture = {
  version: 1,
  device: 'KICKR TEST',
  recordedAt: '2026-09-10T10:00:00.000Z',
  frames: [
    { t: 1000, hex: '440000b80bb400fa00'.padStart(16, '0').slice(0, 16) },
  ],
};

/** flags 0x0044, speed 3000, cadence 180, power 250. */
const FRAME_HEX = '4400b80bb400fa00';

const twoFrames: Capture = {
  version: 1,
  device: 'KICKR TEST',
  recordedAt: '2026-09-10T10:00:00.000Z',
  frames: [
    { t: 1000, hex: FRAME_HEX },
    { t: 1500, hex: FRAME_HEX },
  ],
};

describe('ReplaySource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('declares itself unable to control resistance', () => {
    expect(new ReplaySource(twoFrames).canControlResistance).toBe(false);
  });

  it('replays frames decoded through the real parser', async () => {
    const src = new ReplaySource(twoFrames);
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.power).toBe(250);
    expect(samples[0]!.cadence).toBe(90);
  });

  it('honours the original inter-frame timing', async () => {
    const src = new ReplaySource(twoFrames);
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(samples).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(samples).toHaveLength(2);
  });

  it('compresses timing when a rate above 1 is given', async () => {
    const src = new ReplaySource(twoFrames, { rate: 5 });
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(samples).toHaveLength(2);
  });

  it('loops back to the start when looping is enabled', async () => {
    const src = new ReplaySource(twoFrames, { loop: true });
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(samples.length).toBeGreaterThan(4);
  });

  it('stops emitting after stop()', async () => {
    const src = new ReplaySource(twoFrames, { loop: true });
    const samples: TrainerSample[] = [];
    src.onSample((s) => samples.push(s));
    await src.start();
    await vi.advanceTimersByTimeAsync(1000);
    await src.stop();
    const n = samples.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(samples.length).toBe(n);
  });
});

describe('parseCapture', () => {
  it('accepts a well-formed capture', () => {
    expect(parseCapture(twoFrames).frames).toHaveLength(2);
  });

  it('rejects a capture with the wrong version', () => {
    expect(() => parseCapture({ ...twoFrames, version: 2 })).toThrow(/version/i);
  });

  it('rejects a capture with no frames array', () => {
    expect(() => parseCapture({ version: 1, device: 'x', recordedAt: 'y' }))
      .toThrow(/frames/i);
  });
});
```

Delete the unused `capture` binding from the top of the test file before running — it is shown here only to make clear the shape being replaced by `twoFrames`.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/trainer/test/replaySource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the source**

`packages/trainer/src/sources/replaySource.ts`:

```ts
import { parseIndoorBikeData } from '../ftms/indoorBikeData.js';
import type {
  SimulationParams,
  TrainerSample,
  TrainerSource,
  TrainerStatus,
  Unsubscribe,
} from '../types.js';

export interface CaptureFrame {
  t: number;
  hex: string;
}

export interface Capture {
  version: 1;
  device: string;
  recordedAt: string;
  frames: CaptureFrame[];
}

export interface ReplaySourceOptions {
  loop?: boolean;
  rate?: number;
}

export function parseCapture(json: unknown): Capture {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Capture must be an object.');
  }
  const c = json as Partial<Capture>;
  if (c.version !== 1) {
    throw new Error(`Unsupported capture version: ${String(c.version)}`);
  }
  if (!Array.isArray(c.frames)) {
    throw new Error('Capture is missing a frames array.');
  }
  return {
    version: 1,
    device: typeof c.device === 'string' ? c.device : 'unknown',
    recordedAt: typeof c.recordedAt === 'string' ? c.recordedAt : '',
    frames: c.frames,
  };
}

function hexToView(hex: string): DataView {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new DataView(bytes.buffer);
}

export class ReplaySource implements TrainerSource {
  readonly kind = 'replay' as const;
  readonly canControlResistance = false;

  #frames: CaptureFrame[];
  #device: string;
  #loop: boolean;
  #rate: number;
  #index = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;

  #sampleListeners = new Set<(s: TrainerSample) => void>();
  #statusListeners = new Set<(s: TrainerStatus) => void>();

  constructor(capture: Capture, options: ReplaySourceOptions = {}) {
    this.#frames = capture.frames;
    this.#device = capture.device;
    this.#loop = options.loop ?? false;
    this.#rate = options.rate ?? 1;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#index = 0;
    this.#statusListeners.forEach((fn) =>
      fn({
        kind: 'connected',
        deviceName: `${this.#device} (replay)`,
        canControlResistance: false,
        message: null,
      }),
    );
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#statusListeners.forEach((fn) =>
      fn({
        kind: 'disconnected',
        deviceName: null,
        canControlResistance: false,
        message: null,
      }),
    );
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
    // Nothing to push resistance to.
  }

  #schedule(delayMs: number): void {
    this.#timer = setTimeout(() => this.#emitNext(), delayMs / this.#rate);
  }

  #emitNext(): void {
    if (!this.#running) return;
    const frame = this.#frames[this.#index];
    if (frame === undefined) {
      if (!this.#loop) return;
      this.#index = 0;
      this.#schedule(500);
      return;
    }

    const data = parseIndoorBikeData(hexToView(frame.hex));
    const sample: TrainerSample = {
      t: Date.now(),
      power: data.instantaneousPower,
      cadence: data.instantaneousCadence,
      speed: data.instantaneousSpeed,
      distance: data.totalDistance,
    };
    this.#sampleListeners.forEach((fn) => fn(sample));

    const next = this.#frames[this.#index + 1];
    this.#index += 1;
    this.#schedule(next === undefined ? 500 : Math.max(0, next.t - frame.t));
  }
}
```

- [ ] **Step 4: Add a fixture test proving the parser handles real hardware output**

Append to `packages/trainer/test/replaySource.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('recorded KICKR capture', () => {
  it('decodes every frame to plausible values', () => {
    const path = fileURLToPath(
      new URL('./fixtures/kickr-capture.json', import.meta.url),
    );
    const cap = parseCapture(JSON.parse(readFileSync(path, 'utf8')));
    expect(cap.frames.length).toBeGreaterThan(50);

    const src = new ReplaySource(cap);
    for (const frame of cap.frames) {
      const bytes = new Uint8Array(frame.hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(frame.hex.slice(i * 2, i * 2 + 2), 16);
      }
      const d = parseIndoorBikeData(new DataView(bytes.buffer));
      if (d.instantaneousPower !== null) {
        expect(d.instantaneousPower).toBeGreaterThanOrEqual(-50);
        expect(d.instantaneousPower).toBeLessThan(2000);
      }
      if (d.instantaneousCadence !== null) {
        expect(d.instantaneousCadence).toBeLessThan(200);
      }
      if (d.instantaneousSpeed !== null) {
        expect(d.instantaneousSpeed).toBeLessThan(30);
      }
    }
    expect(src.kind).toBe('replay');
  });
});
```

Add the matching import of `parseIndoorBikeData` at the top of the file.

If any assertion fails, the parser is misaligned against real hardware — fix Task 2 rather than loosening the bounds here. This test is the entire reason the capture was recorded.

- [ ] **Step 5: Export and verify**

Add `export * from './sources/replaySource.js';` to `packages/trainer/src/index.ts`.

Run: `npx vitest run packages/trainer && npm run typecheck`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add packages/trainer
git commit -m "feat: add replay trainer source validated against a real KICKR capture"
```

---

## Phase 3 — Shared game rules

### The coordinate system

Both apps use the same two world coordinates, and every entity in `game-core` is expressed in them. Fix this now; changing it later touches everything.

- **`distance`** — metres travelled along the street, increasing forward. The rider's `distance` comes straight from the physics integrator.
- **`lateral`** — metres from the house frontage line, increasing away from the houses.

| Band | Lateral range | Notes |
|------|---------------|-------|
| House footprint | 0.0 – 1.5 | Not ridable. Window target at 0.8. |
| Lawn | 1.5 – 3.0 | Ridable but slow: Crr 0.02. Porch target at 1.6. |
| Sidewalk | 3.0 – 4.5 | The fast line. Mailbox target at 3.0. Paper stacks here. |
| Curb | 4.5 – 5.5 | Crossing it costs speed. |
| Road | 5.5 – 10.0 | Traffic lives here. |

The rider is clamped to `lateral` 2.0 – 9.5 and is 0.8 m wide. Papers are thrown toward *decreasing* lateral, which is why houses are on one side only — throwing needs no aiming input.

---

### Task 10: Seeded RNG and the difficulty ramp

**Files:**
- Create: `packages/game-core/src/rng.ts`
- Create: `packages/game-core/src/difficulty.ts`
- Test: `packages/game-core/test/rng.test.ts`
- Test: `packages/game-core/test/difficulty.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
// rng.ts
export type Rng = () => number;                    // [0, 1)
export function mulberry32(seed: number): Rng;
export function seedFromString(s: string): number;
export function dailySeed(date: Date): number;
export function randomSeed(): number;
export function rangeInt(rng: Rng, lo: number, hi: number): number;  // inclusive
export function rangeFloat(rng: Rng, lo: number, hi: number): number;
export function pick<T>(rng: Rng, items: readonly T[]): T;

// difficulty.ts
export interface Difficulty {
  housesPerBlock: number;
  hazardBudget: number;
  trafficSpeed: number;      // m/s
  subscriberRatio: number;   // 0..1
  maxGradePercent: number;
}
export function difficultyAt(blockIndex: number): Difficulty;
export const BLOCK_LENGTH_M = 120;
```

- [ ] **Step 1: Write the failing RNG tests**

`packages/game-core/test/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  dailySeed, mulberry32, pick, rangeFloat, rangeInt, seedFromString,
} from '../src/rng.js';

describe('mulberry32', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const draw = (r: () => number) => Array.from({ length: 20 }, r);
    expect(draw(a)).toEqual(draw(b));
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const r = mulberry32(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(r() * 10)]! += 1;
    for (const b of buckets) {
      expect(b).toBeGreaterThan(8_000);
      expect(b).toBeLessThan(12_000);
    }
  });
});

describe('seedFromString', () => {
  it('is stable for the same text', () => {
    expect(seedFromString('paperboy')).toBe(seedFromString('paperboy'));
  });

  it('differs for different text', () => {
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });

  it('returns a non-negative 32-bit integer', () => {
    const s = seedFromString('a rather long seed phrase indeed');
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

describe('dailySeed', () => {
  it('is the same for two times on the same UTC day', () => {
    expect(dailySeed(new Date('2026-09-10T01:00:00Z')))
      .toBe(dailySeed(new Date('2026-09-10T23:00:00Z')));
  });

  it('differs across days', () => {
    expect(dailySeed(new Date('2026-09-10T12:00:00Z')))
      .not.toBe(dailySeed(new Date('2026-09-11T12:00:00Z')));
  });
});

describe('helpers', () => {
  it('rangeInt is inclusive at both ends', () => {
    const seen = new Set<number>();
    const r = mulberry32(3);
    for (let i = 0; i < 2000; i++) seen.add(rangeInt(r, 2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('rangeFloat stays within bounds', () => {
    const r = mulberry32(4);
    for (let i = 0; i < 1000; i++) {
      const v = rangeFloat(r, -2, 6);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(6);
    }
  });

  it('pick returns an element of the array', () => {
    const r = mulberry32(5);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(pick(r, items));
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/game-core/test/rng.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the RNG**

`packages/game-core/src/rng.ts`:

```ts
export type Rng = () => number;

/** mulberry32 — small, fast, and good enough for level generation. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, so a typed seed phrase maps to a stable number. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailySeed(date: Date): number {
  return seedFromString(date.toISOString().slice(0, 10));
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

export function rangeInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function rangeFloat(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick() called on an empty array');
  return item;
}
```

- [ ] **Step 4: Write the failing difficulty tests**

`packages/game-core/test/difficulty.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { difficultyAt } from '../src/difficulty.js';

describe('difficultyAt', () => {
  it('starts gently on the first block', () => {
    const d = difficultyAt(0);
    expect(d.hazardBudget).toBeLessThanOrEqual(3);
    expect(d.subscriberRatio).toBeGreaterThan(0.6);
  });

  it('never decreases hazard budget as blocks advance', () => {
    let prev = -Infinity;
    for (let i = 0; i < 60; i++) {
      const b = difficultyAt(i).hazardBudget;
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('never decreases traffic speed as blocks advance', () => {
    let prev = -Infinity;
    for (let i = 0; i < 60; i++) {
      const s = difficultyAt(i).trafficSpeed;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('caps every dimension so late blocks stay playable', () => {
    const late = difficultyAt(500);
    expect(late.hazardBudget).toBeLessThanOrEqual(10);
    expect(late.trafficSpeed).toBeLessThanOrEqual(16);
    expect(late.subscriberRatio).toBeGreaterThanOrEqual(0.35);
    expect(late.maxGradePercent).toBeLessThanOrEqual(8);
  });

  it('never exceeds the trainer grade clamp', () => {
    for (let i = 0; i < 500; i++) {
      expect(difficultyAt(i).maxGradePercent).toBeLessThanOrEqual(8);
    }
  });

  it('always leaves houses to deliver to', () => {
    for (let i = 0; i < 500; i++) {
      expect(difficultyAt(i).housesPerBlock).toBeGreaterThanOrEqual(4);
    }
  });
});
```

- [ ] **Step 5: Implement the ramp**

`packages/game-core/src/difficulty.ts`:

```ts
export const BLOCK_LENGTH_M = 120;

export interface Difficulty {
  housesPerBlock: number;
  hazardBudget: number;
  trafficSpeed: number;
  subscriberRatio: number;
  maxGradePercent: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function difficultyAt(blockIndex: number): Difficulty {
  const i = Math.max(0, blockIndex);
  return {
    housesPerBlock: 6,
    hazardBudget: clamp(2 + Math.floor(i * 0.6), 2, 10),
    trafficSpeed: clamp(6 + i * 0.45, 6, 16),
    subscriberRatio: clamp(0.72 - i * 0.02, 0.35, 0.72),
    // Held below the 8% trainer clamp so terrain never saturates resistance.
    maxGradePercent: clamp(1 + i * 0.25, 1, 6),
  };
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run packages/game-core`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add packages/game-core
git commit -m "feat: add seeded RNG and difficulty ramp"
```

---

### Task 11: Route generation

The passability invariant is the reason this task has tests rather than eyeballs: a generator that occasionally walls off the street produces runs that end for no reason the rider can see, and that bug is nearly impossible to reproduce by hand.

**Files:**
- Create: `packages/game-core/src/route.ts`
- Test: `packages/game-core/test/route.test.ts`

**Interfaces:**
- Consumes: `Rng`, `mulberry32`, `rangeFloat`, `rangeInt`, `pick` (Task 10); `Difficulty`, `difficultyAt`, `BLOCK_LENGTH_M` (Task 10).
- Produces:

```ts
export type HazardKind =
  | 'car' | 'dog' | 'sprinkler' | 'lawnmower' | 'drain' | 'bin' | 'skater';

export interface HouseSpec {
  id: string; distance: number; subscriber: boolean;
  mailboxLateral: number; porchLateral: number; windowLateral: number;
}
export interface HazardSpec {
  id: string; kind: HazardKind; distance: number; lateral: number;
  width: number; speed: number; phase: number; moving: boolean;
}
export interface SurfaceSpec {
  distance: number; length: number; lateral: number; width: number;
  kind: 'grass' | 'curb';
}
export interface StackSpec { id: string; distance: number; lateral: number }
export interface BlockSpec {
  index: number; startDistance: number; length: number; gradePercent: number;
  houses: HouseSpec[]; hazards: HazardSpec[];
  surfaces: SurfaceSpec[]; stacks: StackSpec[];
}
export const RIDER_WIDTH_M = 0.8;
export const RIDABLE_MIN = 2.0;
export const RIDABLE_MAX = 9.5;
export const MIN_CORRIDOR_M = 0.9;
export function generateBlock(seed: number, index: number): BlockSpec;
export function freeCorridors(
  hazards: readonly HazardSpec[], distance: number,
): Array<[number, number]>;
```

- [ ] **Step 1: Write the failing tests**

`packages/game-core/test/route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MIN_CORRIDOR_M, RIDABLE_MAX, RIDABLE_MIN,
  freeCorridors, generateBlock,
} from '../src/route.js';
import { BLOCK_LENGTH_M, difficultyAt } from '../src/difficulty.js';

const SEEDS = [1, 42, 1337, 999_999, 7];

describe('generateBlock determinism', () => {
  it('produces an identical block for the same seed and index', () => {
    expect(generateBlock(42, 3)).toEqual(generateBlock(42, 3));
  });

  it('produces different blocks for different seeds', () => {
    expect(generateBlock(1, 3)).not.toEqual(generateBlock(2, 3));
  });

  it('produces different blocks for different indices', () => {
    expect(generateBlock(42, 3)).not.toEqual(generateBlock(42, 4));
  });

  it('does not depend on generation order', () => {
    const forwards = [0, 1, 2, 3].map((i) => generateBlock(42, i));
    const backwards = [3, 2, 1, 0].map((i) => generateBlock(42, i)).reverse();
    expect(forwards).toEqual(backwards);
  });
});

describe('generateBlock geometry', () => {
  it('places the block at the right distance along the street', () => {
    const b = generateBlock(42, 5);
    expect(b.startDistance).toBe(5 * BLOCK_LENGTH_M);
    expect(b.length).toBe(BLOCK_LENGTH_M);
  });

  it('keeps every entity inside the block', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 20; i++) {
        const b = generateBlock(seed, i);
        const inside = (d: number) =>
          d >= b.startDistance && d <= b.startDistance + b.length;
        b.houses.forEach((h) => expect(inside(h.distance)).toBe(true));
        b.hazards.forEach((h) => expect(inside(h.distance)).toBe(true));
        b.stacks.forEach((s) => expect(inside(s.distance)).toBe(true));
      }
    }
  });

  it('respects the grade limit for its difficulty', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 40; i++) {
        const b = generateBlock(seed, i);
        expect(Math.abs(b.gradePercent))
          .toBeLessThanOrEqual(difficultyAt(i).maxGradePercent);
      }
    }
  });

  it('keeps traffic on the road and static hazards off it', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 20; i++) {
        for (const h of generateBlock(seed, i).hazards) {
          if (h.kind === 'car') expect(h.lateral).toBeGreaterThanOrEqual(5.5);
          if (h.kind === 'sprinkler') expect(h.lateral).toBeLessThan(3.0);
        }
      }
    }
  });

  it('gives every house three distinct targets in the right bands', () => {
    for (const h of generateBlock(42, 0).houses) {
      expect(h.windowLateral).toBeLessThan(1.5);
      expect(h.porchLateral).toBeGreaterThanOrEqual(1.5);
      expect(h.porchLateral).toBeLessThan(3.0);
      expect(h.mailboxLateral).toBeGreaterThanOrEqual(2.8);
      expect(h.mailboxLateral).toBeLessThan(4.5);
    }
  });

  it('gives every entity a unique id across a long route', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const b = generateBlock(42, i);
      for (const e of [...b.houses, ...b.hazards, ...b.stacks]) {
        expect(ids.has(e.id)).toBe(false);
        ids.add(e.id);
      }
    }
  });

  it('provides at least one paper stack every few blocks', () => {
    let stacks = 0;
    for (let i = 0; i < 12; i++) stacks += generateBlock(42, i).stacks.length;
    expect(stacks).toBeGreaterThanOrEqual(4);
  });

  it('honours the subscriber ratio approximately', () => {
    let subs = 0;
    let total = 0;
    for (let i = 0; i < 3; i++) {
      for (const h of generateBlock(42, i).houses) {
        total += 1;
        if (h.subscriber) subs += 1;
      }
    }
    expect(subs / total).toBeGreaterThan(0.4);
  });
});

describe('passability invariant', () => {
  it('always leaves a ridable corridor, on every seed and every block', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 60; i++) {
        const b = generateBlock(seed, i);
        for (let d = b.startDistance; d <= b.startDistance + b.length; d += 1) {
          const gaps = freeCorridors(b.hazards, d);
          const widest = Math.max(0, ...gaps.map(([lo, hi]) => hi - lo));
          expect(widest).toBeGreaterThanOrEqual(MIN_CORRIDOR_M);
        }
      }
    }
  });
});

describe('freeCorridors', () => {
  it('returns the whole ridable band when nothing is in the way', () => {
    expect(freeCorridors([], 10)).toEqual([[RIDABLE_MIN, RIDABLE_MAX]]);
  });

  it('splits the band around an obstacle', () => {
    const hazard = {
      id: 'h', kind: 'bin' as const, distance: 10, lateral: 6,
      width: 1, speed: 0, phase: 0, moving: false,
    };
    expect(freeCorridors([hazard], 10)).toEqual([
      [RIDABLE_MIN, 5.5], [6.5, RIDABLE_MAX],
    ]);
  });

  it('ignores hazards that are far away along the street', () => {
    const hazard = {
      id: 'h', kind: 'bin' as const, distance: 80, lateral: 6,
      width: 1, speed: 0, phase: 0, moving: false,
    };
    expect(freeCorridors([hazard], 10)).toEqual([[RIDABLE_MIN, RIDABLE_MAX]]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/game-core/test/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the generator**

`packages/game-core/src/route.ts`:

```ts
import { BLOCK_LENGTH_M, difficultyAt } from './difficulty.js';
import { mulberry32, pick, rangeFloat, rangeInt } from './rng.js';
import type { Rng } from './rng.js';

export type HazardKind =
  | 'car' | 'dog' | 'sprinkler' | 'lawnmower' | 'drain' | 'bin' | 'skater';

export interface HouseSpec {
  id: string;
  distance: number;
  subscriber: boolean;
  mailboxLateral: number;
  porchLateral: number;
  windowLateral: number;
}

export interface HazardSpec {
  id: string;
  kind: HazardKind;
  distance: number;
  lateral: number;
  width: number;
  speed: number;
  phase: number;
  moving: boolean;
}

export interface SurfaceSpec {
  distance: number;
  length: number;
  lateral: number;
  width: number;
  kind: 'grass' | 'curb';
}

export interface StackSpec {
  id: string;
  distance: number;
  lateral: number;
}

export interface BlockSpec {
  index: number;
  startDistance: number;
  length: number;
  gradePercent: number;
  houses: HouseSpec[];
  hazards: HazardSpec[];
  surfaces: SurfaceSpec[];
  stacks: StackSpec[];
}

export const RIDER_WIDTH_M = 0.8;
export const RIDABLE_MIN = 2.0;
export const RIDABLE_MAX = 9.5;
export const MIN_CORRIDOR_M = 0.9;

/** How far along the street a hazard blocks the rider's line. */
const HAZARD_DEPTH_M = 2.5;

interface HazardTemplate {
  kind: HazardKind;
  lateralLo: number;
  lateralHi: number;
  width: number;
  moving: boolean;
}

const TEMPLATES: readonly HazardTemplate[] = [
  { kind: 'car', lateralLo: 5.8, lateralHi: 9.0, width: 1.8, moving: true },
  { kind: 'skater', lateralLo: 3.0, lateralHi: 4.4, width: 0.7, moving: true },
  { kind: 'dog', lateralLo: 2.2, lateralHi: 4.4, width: 0.6, moving: true },
  { kind: 'lawnmower', lateralLo: 1.6, lateralHi: 2.9, width: 0.9, moving: true },
  { kind: 'sprinkler', lateralLo: 1.6, lateralHi: 2.9, width: 1.2, moving: false },
  { kind: 'bin', lateralLo: 3.1, lateralHi: 4.4, width: 0.8, moving: false },
  { kind: 'drain', lateralLo: 4.6, lateralHi: 5.4, width: 0.7, moving: false },
];

/**
 * Lateral intervals within the ridable band that no hazard occupies at this
 * point along the street. The generator uses this to guarantee that a block
 * can always be ridden through; the tests use it to prove that it did.
 */
export function freeCorridors(
  hazards: readonly HazardSpec[],
  distance: number,
): Array<[number, number]> {
  const blocked = hazards
    .filter((h) => Math.abs(h.distance - distance) <= HAZARD_DEPTH_M / 2)
    .map((h): [number, number] => [
      h.lateral - h.width / 2,
      h.lateral + h.width / 2,
    ])
    .sort((a, b) => a[0] - b[0]);

  const gaps: Array<[number, number]> = [];
  let cursor = RIDABLE_MIN;
  for (const [lo, hi] of blocked) {
    if (lo > cursor) gaps.push([cursor, Math.min(lo, RIDABLE_MAX)]);
    cursor = Math.max(cursor, hi);
    if (cursor >= RIDABLE_MAX) break;
  }
  if (cursor < RIDABLE_MAX) gaps.push([cursor, RIDABLE_MAX]);
  return gaps.filter(([lo, hi]) => hi > lo);
}

function widestCorridor(
  hazards: readonly HazardSpec[],
  distance: number,
): number {
  const gaps = freeCorridors(hazards, distance);
  return Math.max(0, ...gaps.map(([lo, hi]) => hi - lo));
}

/** Would adding this hazard wall off the street anywhere near it? */
function wouldBlock(
  existing: readonly HazardSpec[],
  candidate: HazardSpec,
): boolean {
  const next = [...existing, candidate];
  const from = candidate.distance - HAZARD_DEPTH_M;
  const to = candidate.distance + HAZARD_DEPTH_M;
  for (let d = from; d <= to; d += 0.5) {
    if (widestCorridor(next, d) < MIN_CORRIDOR_M) return true;
  }
  return false;
}

export function generateBlock(seed: number, index: number): BlockSpec {
  // Mixing the index into the seed makes each block independently
  // reproducible, so blocks can be generated in any order or regenerated
  // on demand without replaying the whole route.
  const rng: Rng = mulberry32((seed ^ (index * 0x9e3779b1)) >>> 0);
  const d = difficultyAt(index);
  const startDistance = index * BLOCK_LENGTH_M;

  const gradePercent = Number(
    rangeFloat(rng, -d.maxGradePercent, d.maxGradePercent).toFixed(2),
  );

  const houses: HouseSpec[] = [];
  const spacing = BLOCK_LENGTH_M / (d.housesPerBlock + 1);
  for (let i = 0; i < d.housesPerBlock; i++) {
    houses.push({
      id: `h-${index}-${i}`,
      distance: startDistance + spacing * (i + 1),
      subscriber: rng() < d.subscriberRatio,
      mailboxLateral: Number(rangeFloat(rng, 2.9, 3.3).toFixed(2)),
      porchLateral: Number(rangeFloat(rng, 1.6, 2.2).toFixed(2)),
      windowLateral: Number(rangeFloat(rng, 0.6, 1.2).toFixed(2)),
    });
  }

  const hazards: HazardSpec[] = [];
  let attempts = 0;
  while (hazards.length < d.hazardBudget && attempts < d.hazardBudget * 12) {
    attempts += 1;
    const t = pick(rng, TEMPLATES);
    const candidate: HazardSpec = {
      id: `z-${index}-${hazards.length}-${attempts}`,
      kind: t.kind,
      distance: startDistance + rangeFloat(rng, 6, BLOCK_LENGTH_M - 6),
      lateral: Number(rangeFloat(rng, t.lateralLo, t.lateralHi).toFixed(2)),
      width: t.width,
      speed: t.moving ? Number(rangeFloat(rng, 0.4, 1).toFixed(2)) * d.trafficSpeed : 0,
      phase: Number(rng().toFixed(3)),
      moving: t.moving,
    };
    if (wouldBlock(hazards, candidate)) continue;
    hazards.push(candidate);
  }

  const surfaces: SurfaceSpec[] = [
    {
      distance: startDistance,
      length: BLOCK_LENGTH_M,
      lateral: 2.25,
      width: 1.5,
      kind: 'grass',
    },
    {
      distance: startDistance,
      length: BLOCK_LENGTH_M,
      lateral: 5.0,
      width: 1.0,
      kind: 'curb',
    },
  ];

  const stacks: StackSpec[] = [];
  if (index === 0 || rng() < 0.55) {
    stacks.push({
      id: `s-${index}-0`,
      distance: startDistance + rangeFloat(rng, 10, BLOCK_LENGTH_M - 10),
      lateral: Number(rangeFloat(rng, 3.2, 4.2).toFixed(2)),
    });
  }

  return {
    index,
    startDistance,
    length: BLOCK_LENGTH_M,
    gradePercent,
    houses,
    hazards,
    surfaces,
    stacks,
  };
}
```

Two details worth not "simplifying" later. `generateBlock` derives its RNG from `seed ^ index * 0x9e3779b1` rather than advancing one stream across blocks, which is what makes block 7 identical whether you generate it after block 6 or on its own — the game streams blocks in as the rider approaches, so order-independence is load-bearing. And `wouldBlock` runs *before* each hazard is accepted, so the invariant is enforced by construction; the test only confirms it.

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/game-core/test/route.test.ts`
Expected: all passing. The passability test is the slow one — a few seconds is normal.

- [ ] **Step 5: Commit**

```bash
git add packages/game-core/src/route.ts packages/game-core/test/route.test.ts
git commit -m "feat: generate seeded routes with a guaranteed ridable corridor"
```

---

### Task 12: Scoring and the combo state machine

**Files:**
- Create: `packages/game-core/src/scoring.ts`
- Test: `packages/game-core/test/scoring.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type ScoreEvent =
  | { type: 'mailbox' }
  | { type: 'porch' }
  | { type: 'lawn' }
  | { type: 'windowNonSubscriber' }
  | { type: 'windowSubscriber' }
  | { type: 'houseMissed' }
  | { type: 'crash' }
  | { type: 'blockCleared' };

export interface ScoreState {
  score: number;
  multiplier: number;
  streak: number;
  papersDelivered: number;
}
export const INITIAL_SCORE_STATE: ScoreState;
export const MAX_MULTIPLIER = 8;
export const POINTS: Record<string, number>;
export function applyScoreEvent(s: ScoreState, e: ScoreEvent): ScoreState;
```

- [ ] **Step 1: Write the failing tests**

`packages/game-core/test/scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  INITIAL_SCORE_STATE, MAX_MULTIPLIER, applyScoreEvent,
} from '../src/scoring.js';
import type { ScoreEvent, ScoreState } from '../src/scoring.js';

const run = (...events: ScoreEvent[]): ScoreState =>
  events.reduce(applyScoreEvent, INITIAL_SCORE_STATE);

describe('applyScoreEvent', () => {
  it('starts at zero with a 1x multiplier', () => {
    expect(INITIAL_SCORE_STATE.score).toBe(0);
    expect(INITIAL_SCORE_STATE.multiplier).toBe(1);
  });

  it('does not mutate the state it is given', () => {
    const before = { ...INITIAL_SCORE_STATE };
    applyScoreEvent(INITIAL_SCORE_STATE, { type: 'mailbox' });
    expect(INITIAL_SCORE_STATE).toEqual(before);
  });

  it('scores a mailbox at 500 and raises the multiplier', () => {
    const s = run({ type: 'mailbox' });
    expect(s.score).toBe(500);
    expect(s.multiplier).toBe(2);
  });

  it('scores a porch at 250 and raises the multiplier', () => {
    const s = run({ type: 'porch' });
    expect(s.score).toBe(250);
    expect(s.multiplier).toBe(2);
  });

  it('multiplies successive deliveries', () => {
    // 500*1 + 500*2 + 500*3 = 3000
    const s = run({ type: 'mailbox' }, { type: 'mailbox' }, { type: 'mailbox' });
    expect(s.score).toBe(3000);
    expect(s.multiplier).toBe(4);
  });

  it('caps the multiplier at 8', () => {
    const s = run(...Array(20).fill({ type: 'mailbox' } as ScoreEvent));
    expect(s.multiplier).toBe(MAX_MULTIPLIER);
  });

  it('resets the multiplier when a paper lands on the lawn', () => {
    const s = run({ type: 'mailbox' }, { type: 'mailbox' }, { type: 'lawn' });
    expect(s.multiplier).toBe(1);
    expect(s.score).toBe(1500);
  });

  it('resets the multiplier when a subscriber house is passed undelivered', () => {
    const s = run({ type: 'mailbox' }, { type: 'houseMissed' });
    expect(s.multiplier).toBe(1);
  });

  it('resets the multiplier on a crash', () => {
    const s = run({ type: 'mailbox' }, { type: 'mailbox' }, { type: 'crash' });
    expect(s.multiplier).toBe(1);
  });

  it('scores a non-subscriber window without touching the multiplier', () => {
    const s = run({ type: 'mailbox' }, { type: 'windowNonSubscriber' });
    expect(s.multiplier).toBe(2);   // unchanged by the window
    expect(s.score).toBe(500 + 100 * 2);
  });

  it('penalises a subscriber window flatly and resets the multiplier', () => {
    // Build to 4x, then smash a subscriber window: -250 unmultiplied.
    const s = run(
      { type: 'mailbox' }, { type: 'mailbox' }, { type: 'mailbox' },
      { type: 'windowSubscriber' },
    );
    expect(s.score).toBe(3000 - 250);
    expect(s.multiplier).toBe(1);
  });

  it('awards the block bonus unmultiplied', () => {
    const s = run(
      { type: 'mailbox' }, { type: 'mailbox' }, { type: 'blockCleared' },
    );
    expect(s.score).toBe(1500 + 1000);
    expect(s.multiplier).toBe(3);   // the bonus does not build the combo
  });

  it('never lets the score go negative', () => {
    const s = run({ type: 'windowSubscriber' }, { type: 'windowSubscriber' });
    expect(s.score).toBe(0);
  });

  it('counts delivered papers but not window smashes', () => {
    const s = run(
      { type: 'mailbox' }, { type: 'porch' },
      { type: 'windowNonSubscriber' }, { type: 'lawn' },
    );
    expect(s.papersDelivered).toBe(2);
  });

  it('tracks the current streak alongside the multiplier', () => {
    const s = run({ type: 'mailbox' }, { type: 'porch' }, { type: 'mailbox' });
    expect(s.streak).toBe(3);
    expect(applyScoreEvent(s, { type: 'crash' }).streak).toBe(0);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/game-core/test/scoring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the state machine**

`packages/game-core/src/scoring.ts`:

```ts
export type ScoreEvent =
  | { type: 'mailbox' }
  | { type: 'porch' }
  | { type: 'lawn' }
  | { type: 'windowNonSubscriber' }
  | { type: 'windowSubscriber' }
  | { type: 'houseMissed' }
  | { type: 'crash' }
  | { type: 'blockCleared' };

export interface ScoreState {
  score: number;
  multiplier: number;
  streak: number;
  papersDelivered: number;
}

export const MAX_MULTIPLIER = 8;

export const POINTS = {
  mailbox: 500,
  porch: 250,
  windowNonSubscriber: 100,
  windowSubscriberPenalty: 250,
  blockBonus: 1000,
} as const;

export const INITIAL_SCORE_STATE: ScoreState = Object.freeze({
  score: 0,
  multiplier: 1,
  streak: 0,
  papersDelivered: 0,
});

export function applyScoreEvent(s: ScoreState, e: ScoreEvent): ScoreState {
  const build = (points: number, delivered: boolean): ScoreState => ({
    score: s.score + points * s.multiplier,
    multiplier: Math.min(MAX_MULTIPLIER, s.multiplier + 1),
    streak: s.streak + 1,
    papersDelivered: s.papersDelivered + (delivered ? 1 : 0),
  });

  const breakCombo = (points: number): ScoreState => ({
    score: Math.max(0, s.score + points),
    multiplier: 1,
    streak: 0,
    papersDelivered: s.papersDelivered,
  });

  switch (e.type) {
    case 'mailbox':
      return build(POINTS.mailbox, true);
    case 'porch':
      return build(POINTS.porch, true);
    case 'lawn':
    case 'houseMissed':
    case 'crash':
      return breakCombo(0);
    case 'windowSubscriber':
      return breakCombo(-POINTS.windowSubscriberPenalty);
    case 'windowNonSubscriber':
      // Scores, but is neither a delivery nor a combo breaker.
      return {
        ...s,
        score: s.score + POINTS.windowNonSubscriber * s.multiplier,
      };
    case 'blockCleared':
      return { ...s, score: s.score + POINTS.blockBonus };
  }
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/game-core/test/scoring.test.ts`
Expected: 15 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/game-core/src/scoring.ts packages/game-core/test/scoring.test.ts
git commit -m "feat: add scoring and combo multiplier state machine"
```

---

### Task 13: Persistence

**Files:**
- Create: `packages/game-core/src/persistence.ts`
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/test/persistence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface RunResult {
  seed: number; score: number; distanceM: number; durationMs: number;
  avgPower: number; kilojoules: number; papersDelivered: number;
}
export interface Stats {
  highScore: number; bestDistanceM: number; lifetimePapers: number;
  runs: number; perSeedBest: Record<string, number>;
}
export const EMPTY_STATS: Stats;
export const STORAGE_KEY = 'paperboy.stats.v1';
export function loadStats(storage: Storage): Stats;
export function recordRun(result: RunResult, storage: Storage): Stats;
export function createMemoryStorage(): Storage;
```

`createMemoryStorage` exists so tests and headless smoke runs never depend on a DOM.

- [ ] **Step 1: Write the failing tests**

`packages/game-core/test/persistence.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_STATS, STORAGE_KEY, createMemoryStorage, loadStats, recordRun,
} from '../src/persistence.js';
import type { RunResult } from '../src/persistence.js';

const result = (over: Partial<RunResult> = {}): RunResult => ({
  seed: 42, score: 1000, distanceM: 800, durationMs: 120_000,
  avgPower: 190, kilojoules: 23, papersDelivered: 12, ...over,
});

describe('persistence', () => {
  let storage: Storage;
  beforeEach(() => { storage = createMemoryStorage(); });

  it('returns empty stats when nothing is stored', () => {
    expect(loadStats(storage)).toEqual(EMPTY_STATS);
  });

  it('returns empty stats when the stored value is corrupt', () => {
    storage.setItem(STORAGE_KEY, 'not json {{{');
    expect(loadStats(storage)).toEqual(EMPTY_STATS);
  });

  it('returns empty stats when the stored value is the wrong shape', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ highScore: 'lots' }));
    expect(loadStats(storage).highScore).toBe(0);
  });

  it('records a first run', () => {
    const s = recordRun(result(), storage);
    expect(s.highScore).toBe(1000);
    expect(s.bestDistanceM).toBe(800);
    expect(s.lifetimePapers).toBe(12);
    expect(s.runs).toBe(1);
  });

  it('persists across loads', () => {
    recordRun(result(), storage);
    expect(loadStats(storage).highScore).toBe(1000);
  });

  it('keeps the best score, not the latest', () => {
    recordRun(result({ score: 1000 }), storage);
    const s = recordRun(result({ score: 400 }), storage);
    expect(s.highScore).toBe(1000);
    expect(s.runs).toBe(2);
  });

  it('accumulates lifetime papers across runs', () => {
    recordRun(result({ papersDelivered: 12 }), storage);
    const s = recordRun(result({ papersDelivered: 8 }), storage);
    expect(s.lifetimePapers).toBe(20);
  });

  it('tracks a personal best per seed', () => {
    recordRun(result({ seed: 1, score: 500 }), storage);
    recordRun(result({ seed: 2, score: 900 }), storage);
    const s = recordRun(result({ seed: 1, score: 700 }), storage);
    expect(s.perSeedBest['1']).toBe(700);
    expect(s.perSeedBest['2']).toBe(900);
  });

  it('does not lower a per-seed best', () => {
    recordRun(result({ seed: 1, score: 900 }), storage);
    const s = recordRun(result({ seed: 1, score: 100 }), storage);
    expect(s.perSeedBest['1']).toBe(900);
  });

  it('survives a storage that throws on write', () => {
    const hostile: Storage = {
      ...createMemoryStorage(),
      setItem() { throw new Error('QuotaExceededError'); },
    };
    expect(() => recordRun(result(), hostile)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/game-core/test/persistence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement persistence**

`packages/game-core/src/persistence.ts`:

```ts
export interface RunResult {
  seed: number;
  score: number;
  distanceM: number;
  durationMs: number;
  avgPower: number;
  kilojoules: number;
  papersDelivered: number;
}

export interface Stats {
  highScore: number;
  bestDistanceM: number;
  lifetimePapers: number;
  runs: number;
  perSeedBest: Record<string, number>;
}

export const STORAGE_KEY = 'paperboy.stats.v1';

export const EMPTY_STATS: Stats = Object.freeze({
  highScore: 0,
  bestDistanceM: 0,
  lifetimePapers: 0,
  runs: 0,
  perSeedBest: {},
});

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export function loadStats(storage: Storage): Stats {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ...EMPTY_STATS, perSeedBest: {} };
  }
  if (raw === null) return { ...EMPTY_STATS, perSeedBest: {} };

  try {
    const parsed = JSON.parse(raw) as Partial<Stats>;
    const perSeed: Record<string, number> = {};
    if (typeof parsed.perSeedBest === 'object' && parsed.perSeedBest !== null) {
      for (const [k, v] of Object.entries(parsed.perSeedBest)) {
        perSeed[k] = num(v);
      }
    }
    return {
      highScore: num(parsed.highScore),
      bestDistanceM: num(parsed.bestDistanceM),
      lifetimePapers: num(parsed.lifetimePapers),
      runs: num(parsed.runs),
      perSeedBest: perSeed,
    };
  } catch {
    return { ...EMPTY_STATS, perSeedBest: {} };
  }
}

export function recordRun(result: RunResult, storage: Storage): Stats {
  const prev = loadStats(storage);
  const key = String(result.seed);
  const next: Stats = {
    highScore: Math.max(prev.highScore, result.score),
    bestDistanceM: Math.max(prev.bestDistanceM, result.distanceM),
    lifetimePapers: prev.lifetimePapers + result.papersDelivered,
    runs: prev.runs + 1,
    perSeedBest: {
      ...prev.perSeedBest,
      [key]: Math.max(prev.perSeedBest[key] ?? 0, result.score),
    },
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled store must not end the rider's run.
  }
  return next;
}

export function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k) { return map.get(k) ?? null; },
    key(i) { return [...map.keys()][i] ?? null; },
    removeItem(k) { map.delete(k); },
    setItem(k, v) { map.set(k, v); },
  };
}
```

- [ ] **Step 4: Export the public surface**

`packages/game-core/src/index.ts`:

```ts
export * from './rng.js';
export * from './difficulty.js';
export * from './route.js';
export * from './scoring.js';
export * from './persistence.js';

export const PACKAGE_NAME = '@paperboy/game-core';
```

- [ ] **Step 5: Verify the whole shared layer**

Run: `npm test && npm run typecheck`
Expected: every test in both packages passing, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/game-core
git commit -m "feat: persist run stats and per-seed personal bests"
```

**Phase 3 gate:** both shared packages are complete and tested. Everything from here is rendering, and the two apps below are independent of each other — they can be built in either order, or in parallel.

---

## Phase 4 — Version A: Canvas 2D

### Task 14: Isometric projection

**Files:**
- Create: `apps/canvas/package.json`, `apps/canvas/vite.config.ts`, `apps/canvas/index.html`, `apps/canvas/tsconfig.json`
- Create: `apps/canvas/src/iso.ts`
- Test: `apps/canvas/test/iso.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface IsoConfig {
  tileW: number;        // screen px per world metre along the x diagonal
  tileH: number;        // screen px per world metre along the y diagonal
  heightScale: number;  // screen px per world metre of elevation
  originX: number;      // where the camera point sits on screen
  originY: number;
}
export const DEFAULT_ISO: IsoConfig;
export interface Camera { distance: number }
export interface ScreenPoint { x: number; y: number }
export function worldToScreen(
  distance: number, lateral: number, height: number,
  camera: Camera, cfg: IsoConfig,
): ScreenPoint;
export function depthKey(distance: number, lateral: number): number;
```

The mapping is a standard 2:1 isometric grid over the axes `a = lateral` and `b = camera.distance - distance`, so that increasing distance moves an object **up and to the right** — the diagonal scroll of the arcade original. `depthKey` is deliberately camera-independent: within a frame the camera term is constant, so `lateral - distance` sorts identically and can be computed once per entity.

- [ ] **Step 1: Scaffold the app**

`apps/canvas/package.json`:

```json
{
  "name": "@paperboy/canvas",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": {
    "@paperboy/trainer": "*",
    "@paperboy/game-core": "*"
  }
}
```

`apps/canvas/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5181, host: 'localhost' } });
```

`apps/canvas/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Write the failing tests**

`apps/canvas/test/iso.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ISO, depthKey, worldToScreen } from '../src/iso.js';

const cam = { distance: 100 };
const at = (d: number, l: number, h = 0) =>
  worldToScreen(d, l, h, cam, { ...DEFAULT_ISO, originX: 0, originY: 0 });

describe('worldToScreen', () => {
  it('puts a point at the camera distance and zero lateral at the origin', () => {
    expect(at(100, 0)).toEqual({ x: 0, y: 0 });
  });

  it('offsets by the configured screen origin', () => {
    const p = worldToScreen(100, 0, 0, cam, {
      ...DEFAULT_ISO, originX: 400, originY: 300,
    });
    expect(p).toEqual({ x: 400, y: 300 });
  });

  it('moves up and to the right as distance increases', () => {
    const near = at(100, 4);
    const far = at(140, 4);
    expect(far.x).toBeGreaterThan(near.x);
    expect(far.y).toBeLessThan(near.y);
  });

  it('moves down and to the right as lateral increases', () => {
    const inner = at(100, 2);
    const outer = at(100, 8);
    expect(outer.x).toBeGreaterThan(inner.x);
    expect(outer.y).toBeGreaterThan(inner.y);
  });

  it('raises a point on screen as its height grows', () => {
    expect(at(100, 4, 3).y).toBeLessThan(at(100, 4, 0).y);
  });

  it('is linear, so a midpoint projects to the midpoint', () => {
    const a = at(100, 0);
    const b = at(120, 6);
    const mid = at(110, 3);
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(mid.y).toBeCloseTo((a.y + b.y) / 2, 6);
  });

  it('translates with the camera rather than deforming', () => {
    const p1 = worldToScreen(120, 4, 0, { distance: 100 }, DEFAULT_ISO);
    const p2 = worldToScreen(140, 4, 0, { distance: 120 }, DEFAULT_ISO);
    expect(p1).toEqual(p2);
  });
});

describe('depthKey', () => {
  it('sorts a nearer-to-viewer entity after a further one', () => {
    // Same distance: larger lateral is nearer the viewer, so draws later.
    expect(depthKey(100, 8)).toBeGreaterThan(depthKey(100, 1));
  });

  it('sorts an entity further up the street before one behind it', () => {
    expect(depthKey(140, 4)).toBeLessThan(depthKey(100, 4));
  });

  it('gives the same ordering as projected screen y', () => {
    const items = [
      { d: 100, l: 1 }, { d: 130, l: 8 }, { d: 100, l: 8 }, { d: 115, l: 4 },
    ];
    const byDepth = [...items].sort(
      (a, b) => depthKey(a.d, a.l) - depthKey(b.d, b.l),
    );
    const byScreen = [...items].sort(
      (a, b) => at(a.d, a.l).y - at(b.d, b.l).y,
    );
    expect(byDepth).toEqual(byScreen);
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run apps/canvas/test/iso.test.ts`
Expected: FAIL — module not found.

Add `'apps/*/test/**/*.test.ts'` to the Vitest `include` array if it is not already there from Task 1.

- [ ] **Step 4: Implement the projection**

`apps/canvas/src/iso.ts`:

```ts
export interface IsoConfig {
  tileW: number;
  tileH: number;
  heightScale: number;
  originX: number;
  originY: number;
}

export const DEFAULT_ISO: IsoConfig = {
  tileW: 26,
  tileH: 13,
  heightScale: 18,
  originX: 0,
  originY: 0,
};

export interface Camera {
  distance: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function worldToScreen(
  distance: number,
  lateral: number,
  height: number,
  camera: Camera,
  cfg: IsoConfig,
): ScreenPoint {
  const a = lateral;
  const b = camera.distance - distance;
  return {
    x: cfg.originX + (a - b) * (cfg.tileW / 2),
    y: cfg.originY + (a + b) * (cfg.tileH / 2) - height * cfg.heightScale,
  };
}

/**
 * Painter's-algorithm sort key. Camera-independent on purpose: the camera
 * term is constant within a frame, so this orders identically to screen y
 * while being computable once per entity rather than once per frame.
 */
export function depthKey(distance: number, lateral: number): number {
  return lateral - distance;
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run apps/canvas/test/iso.test.ts`
Expected: 10 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/canvas package.json vitest.config.ts
git commit -m "feat(canvas): add isometric projection and depth ordering"
```

---

### Task 15: World state and block streaming

**Files:**
- Create: `apps/canvas/src/world.ts`
- Test: `apps/canvas/test/world.test.ts`

**Interfaces:**
- Consumes: `BlockSpec`, `HouseSpec`, `HazardSpec`, `StackSpec`, `generateBlock`, `BLOCK_LENGTH_M`, `RIDABLE_MIN`, `RIDABLE_MAX`, `INITIAL_SCORE_STATE`, `ScoreState` from `@paperboy/game-core`; `RiderProfile`, `PhysicsState`, `stepPhysics` from `@paperboy/trainer`.
- Produces:

```ts
export interface Rider {
  distance: number; lateral: number; speed: number;
  papers: number; lives: number; invulnerableUntil: number;
}
export interface HouseState {
  spec: HouseSpec; delivered: boolean; windowBroken: boolean; resolved: boolean;
}
export interface HazardState { spec: HazardSpec; distance: number; lateral: number }
export interface StackState { spec: StackSpec; taken: boolean }
export interface Paper {
  id: number; distance: number; lateral: number; height: number;
  vDistance: number; vLateral: number; vHeight: number;
}
export interface WorldState {
  seed: number; elapsed: number; rider: Rider;
  blocks: BlockSpec[]; houses: HouseState[];
  hazards: HazardState[]; stacks: StackState[]; papers: Paper[];
  score: ScoreState; blocksCleared: number; gameOver: boolean; nextPaperId: number;
}
export const START_PAPERS = 20;
export const MAX_PAPERS = 30;
export const STACK_PAPERS = 10;
export const START_LIVES = 3;
export const STEER_RATE = 4.5;          // metres of lateral per second
export const STREAM_AHEAD_M = 400;
export const STREAM_BEHIND_M = 200;
export function createWorld(seed: number): WorldState;
export function ensureBlocks(w: WorldState): void;
export function surfaceCrr(lateral: number): number;
export function gradeAt(w: WorldState, distance: number): number;
export function steer(w: WorldState, direction: number, dt: number): void;
export function advanceRider(
  w: WorldState, powerWatts: number, profile: RiderProfile, dt: number,
): void;
export function moveHazards(w: WorldState, dt: number): void;
```

- [ ] **Step 1: Write the failing tests**

`apps/canvas/test/world.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { BLOCK_LENGTH_M, RIDABLE_MAX, RIDABLE_MIN } from '@paperboy/game-core';
import {
  START_LIVES, START_PAPERS, STREAM_AHEAD_M,
  advanceRider, createWorld, ensureBlocks, gradeAt, moveHazards,
  steer, surfaceCrr,
} from '../src/world.js';

describe('createWorld', () => {
  it('starts with full papers, full lives and a stopped rider', () => {
    const w = createWorld(42);
    expect(w.rider.papers).toBe(START_PAPERS);
    expect(w.rider.lives).toBe(START_LIVES);
    expect(w.rider.speed).toBe(0);
    expect(w.gameOver).toBe(false);
  });

  it('places the rider on the sidewalk', () => {
    const w = createWorld(42);
    expect(w.rider.lateral).toBeGreaterThanOrEqual(3.0);
    expect(w.rider.lateral).toBeLessThanOrEqual(4.5);
  });

  it('is reproducible from its seed', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    expect(a.houses.map((h) => h.spec.id)).toEqual(b.houses.map((h) => h.spec.id));
  });
});

describe('ensureBlocks', () => {
  it('streams enough road ahead of the rider', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    const last = w.blocks.at(-1)!;
    expect(last.startDistance + last.length)
      .toBeGreaterThanOrEqual(w.rider.distance + STREAM_AHEAD_M);
  });

  it('keeps streaming as the rider advances', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    w.rider.distance = BLOCK_LENGTH_M * 10;
    ensureBlocks(w);
    const last = w.blocks.at(-1)!;
    expect(last.startDistance + last.length)
      .toBeGreaterThanOrEqual(w.rider.distance + STREAM_AHEAD_M);
  });

  it('prunes entities left far behind so memory stays flat', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    w.rider.distance = BLOCK_LENGTH_M * 40;
    ensureBlocks(w);
    for (const h of w.houses) {
      expect(h.spec.distance).toBeGreaterThan(w.rider.distance - 500);
    }
    expect(w.houses.length).toBeLessThan(120);
  });

  it('never regenerates a block that already exists', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    const idsBefore = w.houses.map((h) => h.spec.id);
    ensureBlocks(w);
    expect(w.houses.map((h) => h.spec.id)).toEqual(idsBefore);
  });
});

describe('steer', () => {
  it('moves the rider toward the houses on a negative direction', () => {
    const w = createWorld(42);
    const before = w.rider.lateral;
    steer(w, -1, 0.5);
    expect(w.rider.lateral).toBeLessThan(before);
  });

  it('clamps the rider inside the ridable band', () => {
    const w = createWorld(42);
    for (let i = 0; i < 100; i++) steer(w, -1, 0.1);
    expect(w.rider.lateral).toBeGreaterThanOrEqual(RIDABLE_MIN);
    for (let i = 0; i < 200; i++) steer(w, 1, 0.1);
    expect(w.rider.lateral).toBeLessThanOrEqual(RIDABLE_MAX);
  });
});

describe('surfaceCrr', () => {
  it('is fast on the sidewalk and on the road', () => {
    expect(surfaceCrr(3.8)).toBeLessThan(0.01);
    expect(surfaceCrr(7.0)).toBeLessThan(0.01);
  });

  it('is slow on the lawn', () => {
    expect(surfaceCrr(2.2)).toBeGreaterThan(0.015);
  });

  it('is slow on the curb', () => {
    expect(surfaceCrr(5.0)).toBeGreaterThan(0.01);
  });
});

describe('gradeAt', () => {
  it('returns the grade of the block the rider is in', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    expect(gradeAt(w, 10)).toBe(w.blocks[0]!.gradePercent);
    expect(gradeAt(w, BLOCK_LENGTH_M + 10)).toBe(w.blocks[1]!.gradePercent);
  });

  it('returns zero beyond the generated road', () => {
    const w = createWorld(42);
    expect(gradeAt(w, 9_999_999)).toBe(0);
  });
});

describe('advanceRider', () => {
  it('accelerates the rider when power is applied', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    for (let i = 0; i < 120; i++) advanceRider(w, 250, DEFAULT_RIDER, 1 / 60);
    expect(w.rider.speed).toBeGreaterThan(2);
    expect(w.rider.distance).toBeGreaterThan(0);
  });

  it('slows the rider on the lawn compared with the sidewalk', () => {
    const road = createWorld(42);
    ensureBlocks(road);
    road.rider.lateral = 3.8;
    const lawn = createWorld(42);
    ensureBlocks(lawn);
    lawn.rider.lateral = 2.2;
    for (let i = 0; i < 600; i++) {
      advanceRider(road, 200, DEFAULT_RIDER, 1 / 60);
      advanceRider(lawn, 200, DEFAULT_RIDER, 1 / 60);
    }
    expect(lawn.rider.speed).toBeLessThan(road.rider.speed);
  });

  it('advances elapsed time', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    advanceRider(w, 100, DEFAULT_RIDER, 0.5);
    expect(w.elapsed).toBeCloseTo(0.5, 6);
  });
});

describe('moveHazards', () => {
  it('moves hazards marked as moving and leaves static ones alone', () => {
    const w = createWorld(42);
    ensureBlocks(w);
    const moving = w.hazards.find((h) => h.spec.moving);
    const still = w.hazards.find((h) => !h.spec.moving);
    const movingBefore = moving ? { ...moving } : null;
    const stillBefore = still ? { ...still } : null;

    for (let i = 0; i < 60; i++) moveHazards(w, 1 / 60);

    if (movingBefore && moving) {
      const moved =
        Math.abs(moving.distance - movingBefore.distance) > 0.01 ||
        Math.abs(moving.lateral - movingBefore.lateral) > 0.01;
      expect(moved).toBe(true);
    }
    if (stillBefore && still) {
      expect(still.distance).toBeCloseTo(stillBefore.distance, 6);
      expect(still.lateral).toBeCloseTo(stillBefore.lateral, 6);
    }
  });

  it('keeps cars on the road', () => {
    const w = createWorld(7);
    ensureBlocks(w);
    for (let i = 0; i < 600; i++) moveHazards(w, 1 / 60);
    for (const h of w.hazards) {
      if (h.spec.kind === 'car') expect(h.lateral).toBeGreaterThanOrEqual(5.5);
    }
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run apps/canvas/test/world.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the world**

`apps/canvas/src/world.ts`:

```ts
import {
  BLOCK_LENGTH_M, INITIAL_SCORE_STATE, RIDABLE_MAX, RIDABLE_MIN,
  generateBlock,
} from '@paperboy/game-core';
import type {
  BlockSpec, HazardSpec, HouseSpec, ScoreState, StackSpec,
} from '@paperboy/game-core';
import { stepPhysics } from '@paperboy/trainer';
import type { RiderProfile } from '@paperboy/trainer';

export const START_PAPERS = 20;
export const MAX_PAPERS = 30;
export const STACK_PAPERS = 10;
export const START_LIVES = 3;
export const STEER_RATE = 4.5;
export const STREAM_AHEAD_M = 400;
export const STREAM_BEHIND_M = 200;

export interface Rider {
  distance: number;
  lateral: number;
  speed: number;
  papers: number;
  lives: number;
  invulnerableUntil: number;
}

export interface HouseState {
  spec: HouseSpec;
  delivered: boolean;
  windowBroken: boolean;
  resolved: boolean;
}

export interface HazardState {
  spec: HazardSpec;
  distance: number;
  lateral: number;
}

export interface StackState {
  spec: StackSpec;
  taken: boolean;
}

export interface Paper {
  id: number;
  distance: number;
  lateral: number;
  height: number;
  vDistance: number;
  vLateral: number;
  vHeight: number;
}

export interface WorldState {
  seed: number;
  elapsed: number;
  rider: Rider;
  blocks: BlockSpec[];
  houses: HouseState[];
  hazards: HazardState[];
  stacks: StackState[];
  papers: Paper[];
  score: ScoreState;
  blocksCleared: number;
  gameOver: boolean;
  nextPaperId: number;
}

export function createWorld(seed: number): WorldState {
  return {
    seed,
    elapsed: 0,
    rider: {
      distance: 0,
      lateral: 3.8,
      speed: 0,
      papers: START_PAPERS,
      lives: START_LIVES,
      invulnerableUntil: 0,
    },
    blocks: [],
    houses: [],
    hazards: [],
    stacks: [],
    papers: [],
    score: { ...INITIAL_SCORE_STATE },
    blocksCleared: 0,
    gameOver: false,
    nextPaperId: 1,
  };
}

export function ensureBlocks(w: WorldState): void {
  const needUntil = w.rider.distance + STREAM_AHEAD_M;
  let nextIndex = w.blocks.length === 0 ? 0 : w.blocks.at(-1)!.index + 1;

  while (
    w.blocks.length === 0 ||
    w.blocks.at(-1)!.startDistance + BLOCK_LENGTH_M < needUntil
  ) {
    const block = generateBlock(w.seed, nextIndex);
    w.blocks.push(block);
    block.houses.forEach((spec) =>
      w.houses.push({ spec, delivered: false, windowBroken: false, resolved: false }),
    );
    block.hazards.forEach((spec) =>
      w.hazards.push({ spec, distance: spec.distance, lateral: spec.lateral }),
    );
    block.stacks.forEach((spec) => w.stacks.push({ spec, taken: false }));
    nextIndex += 1;
  }

  const cutoff = w.rider.distance - STREAM_BEHIND_M;
  w.blocks = w.blocks.filter((b) => b.startDistance + b.length > cutoff);
  w.houses = w.houses.filter((h) => h.spec.distance > cutoff);
  w.hazards = w.hazards.filter((h) => h.distance > cutoff);
  w.stacks = w.stacks.filter((s) => s.spec.distance > cutoff);
}

export function surfaceCrr(lateral: number): number {
  if (lateral < 3.0) return 0.02;    // lawn
  if (lateral < 4.5) return 0.005;   // sidewalk
  if (lateral < 5.5) return 0.014;   // curb
  return 0.005;                      // road
}

export function gradeAt(w: WorldState, distance: number): number {
  const block = w.blocks.find(
    (b) => distance >= b.startDistance && distance < b.startDistance + b.length,
  );
  return block?.gradePercent ?? 0;
}

export function steer(w: WorldState, direction: number, dt: number): void {
  const next = w.rider.lateral + direction * STEER_RATE * dt;
  w.rider.lateral = Math.max(RIDABLE_MIN, Math.min(RIDABLE_MAX, next));
}

export function advanceRider(
  w: WorldState,
  powerWatts: number,
  profile: RiderProfile,
  dt: number,
): void {
  const next = stepPhysics(
    { speed: w.rider.speed, distance: w.rider.distance },
    {
      powerWatts,
      gradePercent: gradeAt(w, w.rider.distance),
      crr: surfaceCrr(w.rider.lateral),
      headwind: 0,
    },
    profile,
    dt,
  );
  w.rider.speed = next.speed;
  w.rider.distance = next.distance;
  w.elapsed += dt;
}

export function moveHazards(w: WorldState, dt: number): void {
  for (const h of w.hazards) {
    if (!h.spec.moving) continue;

    if (h.spec.kind === 'car') {
      // Traffic runs along the road, oncoming.
      h.distance -= h.spec.speed * dt;
    } else {
      // Everything else weaves across its own band.
      const t = w.elapsed + h.spec.phase * 10;
      const swing = Math.sin(t * 0.8) * 0.8;
      h.lateral = h.spec.lateral + swing;
      h.distance = h.spec.distance + Math.sin(t * 0.4) * 2;
    }
  }
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run apps/canvas/test/world.test.ts`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add apps/canvas/src/world.ts apps/canvas/test/world.test.ts
git commit -m "feat(canvas): stream seeded blocks and integrate rider motion"
```

---

### Task 16: Throwing, delivery resolution, collisions and the run lifecycle

This is where the game becomes a game. Everything here is pure state transformation over `WorldState`, so all of it is testable without a canvas.

**Files:**
- Create: `packages/game-core/src/landing.ts`
- Modify: `packages/game-core/src/index.ts`
- Create: `apps/canvas/src/rules.ts`
- Test: `packages/game-core/test/landing.test.ts`
- Test: `apps/canvas/test/rules.test.ts`

**Where landing classification lives.** Which band a paper lands in decides
what it scores, so it is a *rule*, not a rendering detail — it goes in
`@paperboy/game-core` and both apps import it. If each app classified
landings for itself the two versions could score the same throw differently,
and the bake-off would be comparing two different games.

**Interfaces:**
- Consumes: everything from `apps/canvas/src/world.ts` (Task 15); `ScoreEvent`, `applyScoreEvent`, `BLOCK_LENGTH_M` from `@paperboy/game-core`; `RiderProfile` from `@paperboy/trainer`.
- Produces:

```ts
export const THROW_HEIGHT = 1.1;
export const THROW_V_LATERAL = -7;
export const THROW_V_UP = 3.2;
export const GRAVITY = 9.8;
export const RIDER_HALF_WIDTH = 0.4;
export const RIDER_HALF_LENGTH = 0.75;
export const HAZARD_HALF_DEPTH = 0.6;
export const INVULNERABLE_S = 1.5;
export const HOUSE_RESOLVE_MARGIN_M = 8;

// in @paperboy/game-core (packages/game-core/src/landing.ts)
export interface Landing { distance: number; lateral: number }
export type LandingBand = 'window' | 'porch' | 'mailbox' | 'lawn' | 'street';
export interface LandingOutcome { band: LandingBand; house: HouseSpec | null }
export const HOUSE_MATCH_RADIUS_M = 6;
export const STREET_LATERAL = 3.7;
export const WINDOW_LATERAL = 1.4;
export const PORCH_LATERAL = 2.6;
export const PORCH_TOLERANCE_M = 0.8;
export const MAILBOX_TOLERANCE_M = 0.5;
export function classifyLanding(
  landing: Landing, houses: readonly HouseSpec[],
): LandingOutcome;

// in apps/canvas/src/rules.ts

export interface FrameInput {
  steer: number;         // -1 toward the houses, +1 toward the road, 0 straight
  throwPaper: boolean;
  powerWatts: number;
}

export function throwPaper(w: WorldState): boolean;
export function updatePapers(w: WorldState, dt: number): ScoreEvent[];
export function resolvePassedHouses(w: WorldState): ScoreEvent[];
export function resolveBlocks(w: WorldState): ScoreEvent[];
export function collectStacks(w: WorldState): void;
export function detectCollision(w: WorldState): HazardState | null;
export function applyCrash(w: WorldState): ScoreEvent[];
export function stepWorld(
  w: WorldState, input: FrameInput, profile: RiderProfile, dt: number,
): ScoreEvent[];
```

- [ ] **Step 1: Write the failing tests**

`apps/canvas/test/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { BLOCK_LENGTH_M, classifyLanding } from '@paperboy/game-core';
import {
  MAX_PAPERS, START_PAPERS, createWorld, ensureBlocks,
} from '../src/world.js';
import type { HouseState, WorldState } from '../src/world.js';
import {
  applyCrash, collectStacks, detectCollision,
  resolveBlocks, resolvePassedHouses, stepWorld, throwPaper, updatePapers,
} from '../src/rules.js';

function house(over: Partial<HouseState['spec']> = {}): HouseState {
  return {
    spec: {
      id: 'h-test', distance: 100, subscriber: true,
      mailboxLateral: 3.1, porchLateral: 1.9, windowLateral: 0.9, ...over,
    },
    delivered: false, windowBroken: false, resolved: false,
  };
}

function ready(seed = 42): WorldState {
  const w = createWorld(seed);
  ensureBlocks(w);
  return w;
}

describe('throwPaper', () => {
  it('spends a paper and creates a projectile', () => {
    const w = ready();
    expect(throwPaper(w)).toBe(true);
    expect(w.rider.papers).toBe(START_PAPERS - 1);
    expect(w.papers).toHaveLength(1);
  });

  it('throws toward the houses', () => {
    const w = ready();
    throwPaper(w);
    expect(w.papers[0]!.vLateral).toBeLessThan(0);
  });

  it('refuses to throw with an empty bundle', () => {
    const w = ready();
    w.rider.papers = 0;
    expect(throwPaper(w)).toBe(false);
    expect(w.papers).toHaveLength(0);
  });
});

describe('classifyLanding through the shared rules', () => {
  const specs = [house().spec];

  it('recognises a mailbox hit', () => {
    const o = classifyLanding({ distance: 100, lateral: 3.1 }, specs);
    expect(o.band).toBe('mailbox');
    expect(o.house).toBe(specs[0]);
  });

  it('recognises a porch hit', () => {
    expect(classifyLanding({ distance: 100, lateral: 1.9 }, specs).band)
      .toBe('porch');
  });

  it('recognises a window hit', () => {
    expect(classifyLanding({ distance: 100, lateral: 0.9 }, specs).band)
      .toBe('window');
  });

  it('calls a near miss on the lawn', () => {
    expect(classifyLanding({ distance: 100, lateral: 2.7 }, specs).band)
      .toBe('lawn');
  });

  it('calls anything thrown into the road a street landing', () => {
    expect(classifyLanding({ distance: 100, lateral: 6.0 }, specs).band)
      .toBe('street');
  });

  it('finds no house when the landing is far along the street', () => {
    expect(classifyLanding({ distance: 300, lateral: 3.1 }, specs).house)
      .toBeNull();
  });

  it('picks the nearest house when two are close', () => {
    const two = [house({ id: 'a', distance: 100 }).spec,
                 house({ id: 'b', distance: 104 }).spec];
    expect(classifyLanding({ distance: 103.5, lateral: 3.1 }, two).house!.id)
      .toBe('b');
  });
});

describe('updatePapers', () => {
  function thrownAt(w: WorldState, h: HouseState, lateral: number): void {
    w.houses = [h];
    w.rider.distance = h.spec.distance;
    throwPaper(w);
    const p = w.papers[0]!;
    // Place the paper on its landing line directly, so the test is about
    // resolution rather than about ballistics.
    p.lateral = lateral;
    p.distance = h.spec.distance;
    p.height = 0.01;
    p.vHeight = -5;
    p.vLateral = 0;
    p.vDistance = 0;
  }

  it('scores a mailbox delivery to a subscriber', () => {
    const w = ready();
    const h = house();
    thrownAt(w, h, 3.1);
    const events = updatePapers(w, 1 / 30);
    expect(events).toEqual([{ type: 'mailbox' }]);
    expect(h.delivered).toBe(true);
    expect(w.papers).toHaveLength(0);
  });

  it('scores a porch delivery to a subscriber', () => {
    const w = ready();
    const h = house();
    thrownAt(w, h, 1.9);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'porch' }]);
  });

  it('wastes a paper delivered to a non-subscriber without penalty', () => {
    const w = ready();
    const h = house({ subscriber: false });
    thrownAt(w, h, 3.1);
    expect(updatePapers(w, 1 / 30)).toEqual([]);
    expect(h.delivered).toBe(false);
  });

  it('scores a smashed non-subscriber window', () => {
    const w = ready();
    const h = house({ subscriber: false });
    thrownAt(w, h, 0.9);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'windowNonSubscriber' }]);
    expect(h.windowBroken).toBe(true);
  });

  it('penalises smashing a subscriber window and loses the subscriber', () => {
    const w = ready();
    const h = house({ subscriber: true });
    thrownAt(w, h, 0.9);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'windowSubscriber' }]);
    expect(h.resolved).toBe(true);   // no later "missed" event for this house
  });

  it('scores nothing for smashing an already-broken window', () => {
    const w = ready();
    const h = house({ subscriber: false });
    h.windowBroken = true;
    thrownAt(w, h, 0.9);
    expect(updatePapers(w, 1 / 30)).toEqual([]);
  });

  it('breaks the combo when a paper lands on the lawn', () => {
    const w = ready();
    thrownAt(w, house(), 2.7);
    expect(updatePapers(w, 1 / 30)).toEqual([{ type: 'lawn' }]);
  });

  it('emits nothing for a paper thrown into the road', () => {
    const w = ready();
    thrownAt(w, house(), 6.5);
    expect(updatePapers(w, 1 / 30)).toEqual([]);
  });

  it('flies on a falling arc while still in the air', () => {
    const w = ready();
    w.houses = [];
    throwPaper(w);
    const before = w.papers[0]!.vHeight;
    updatePapers(w, 1 / 60);
    expect(w.papers[0]!.vHeight).toBeLessThan(before);
    expect(w.papers).toHaveLength(1);
  });
});

describe('resolvePassedHouses', () => {
  it('emits a miss for a subscriber left undelivered', () => {
    const w = ready();
    const h = house({ distance: 50 });
    w.houses = [h];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toEqual([{ type: 'houseMissed' }]);
    expect(h.resolved).toBe(true);
  });

  it('emits nothing for a delivered subscriber', () => {
    const w = ready();
    const h = house({ distance: 50 });
    h.delivered = true;
    w.houses = [h];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toEqual([]);
  });

  it('emits nothing for a non-subscriber', () => {
    const w = ready();
    w.houses = [house({ distance: 50, subscriber: false })];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toEqual([]);
  });

  it('emits nothing for a house not yet passed', () => {
    const w = ready();
    w.houses = [house({ distance: 100 })];
    w.rider.distance = 99;
    expect(resolvePassedHouses(w)).toEqual([]);
  });

  it('emits a miss only once per house', () => {
    const w = ready();
    w.houses = [house({ distance: 50 })];
    w.rider.distance = 100;
    expect(resolvePassedHouses(w)).toHaveLength(1);
    expect(resolvePassedHouses(w)).toHaveLength(0);
  });
});

describe('resolveBlocks', () => {
  it('awards a block bonus when every subscriber on it was served', () => {
    const w = ready();
    w.houses.forEach((h) => { h.delivered = true; });
    w.rider.distance = BLOCK_LENGTH_M + 1;
    expect(resolveBlocks(w)).toEqual([{ type: 'blockCleared' }]);
    expect(w.blocksCleared).toBe(1);
  });

  it('awards nothing when a subscriber was missed', () => {
    const w = ready();
    const first = w.houses.find(
      (h) => h.spec.subscriber && h.spec.distance < BLOCK_LENGTH_M,
    );
    w.houses.forEach((h) => { h.delivered = true; });
    if (first) first.delivered = false;
    w.rider.distance = BLOCK_LENGTH_M + 1;
    expect(resolveBlocks(w)).toEqual(first ? [] : [{ type: 'blockCleared' }]);
  });

  it('awards each block at most once', () => {
    const w = ready();
    w.houses.forEach((h) => { h.delivered = true; });
    w.rider.distance = BLOCK_LENGTH_M + 1;
    resolveBlocks(w);
    expect(resolveBlocks(w)).toEqual([]);
  });
});

describe('collectStacks', () => {
  it('restores papers when the rider rides over a stack', () => {
    const w = ready();
    w.rider.papers = 5;
    const s = w.stacks[0]!;
    w.rider.distance = s.spec.distance;
    w.rider.lateral = s.spec.lateral;
    collectStacks(w);
    expect(w.rider.papers).toBe(15);
    expect(s.taken).toBe(true);
  });

  it('never exceeds the paper cap', () => {
    const w = ready();
    w.rider.papers = MAX_PAPERS - 2;
    const s = w.stacks[0]!;
    w.rider.distance = s.spec.distance;
    w.rider.lateral = s.spec.lateral;
    collectStacks(w);
    expect(w.rider.papers).toBe(MAX_PAPERS);
  });

  it('cannot be collected twice', () => {
    const w = ready();
    w.rider.papers = 5;
    const s = w.stacks[0]!;
    w.rider.distance = s.spec.distance;
    w.rider.lateral = s.spec.lateral;
    collectStacks(w);
    collectStacks(w);
    expect(w.rider.papers).toBe(15);
  });
});

describe('collisions', () => {
  it('detects an overlapping hazard', () => {
    const w = ready();
    const h = w.hazards[0]!;
    w.rider.distance = h.distance;
    w.rider.lateral = h.lateral;
    expect(detectCollision(w)).toBe(h);
  });

  it('ignores a hazard the rider is clear of', () => {
    const w = ready();
    const h = w.hazards[0]!;
    w.rider.distance = h.distance + 50;
    expect(detectCollision(w)).toBeNull();
  });

  it('ignores hazards while the rider is invulnerable', () => {
    const w = ready();
    const h = w.hazards[0]!;
    w.rider.distance = h.distance;
    w.rider.lateral = h.lateral;
    w.rider.invulnerableUntil = w.elapsed + 1;
    expect(detectCollision(w)).toBeNull();
  });
});

describe('applyCrash', () => {
  it('costs a life, kills the speed and grants invulnerability', () => {
    const w = ready();
    w.rider.speed = 10;
    const events = applyCrash(w);
    expect(events).toEqual([{ type: 'crash' }]);
    expect(w.rider.lives).toBe(2);
    expect(w.rider.speed).toBeLessThan(2);
    expect(w.rider.invulnerableUntil).toBeGreaterThan(w.elapsed);
  });

  it('ends the run when the last life goes', () => {
    const w = ready();
    w.rider.lives = 1;
    applyCrash(w);
    expect(w.gameOver).toBe(true);
  });
});

describe('stepWorld', () => {
  const input = { steer: 0, throwPaper: false, powerWatts: 220 };

  it('advances the rider and keeps the world consistent', () => {
    const w = ready();
    for (let i = 0; i < 600; i++) stepWorld(w, input, DEFAULT_RIDER, 1 / 60);
    expect(w.rider.distance).toBeGreaterThan(10);
    expect(Number.isFinite(w.rider.speed)).toBe(true);
  });

  it('accumulates score through the shared scoring rules', () => {
    const w = ready();
    for (let i = 0; i < 3600; i++) {
      stepWorld(w, { ...input, throwPaper: i % 40 === 0 }, DEFAULT_RIDER, 1 / 60);
      if (w.gameOver) break;
    }
    expect(w.score.score).toBeGreaterThanOrEqual(0);
  });

  it('throws at most one paper per frame even if the key is held', () => {
    const w = ready();
    stepWorld(w, { ...input, throwPaper: true }, DEFAULT_RIDER, 1 / 60);
    expect(w.rider.papers).toBe(START_PAPERS - 1);
  });

  it('stops changing the world once the run is over', () => {
    const w = ready();
    w.rider.lives = 1;
    applyCrash(w);
    const snapshot = w.rider.distance;
    stepWorld(w, { ...input, powerWatts: 400 }, DEFAULT_RIDER, 1);
    expect(w.rider.distance).toBe(snapshot);
  });

  it('is deterministic for a fixed input sequence', () => {
    const run = () => {
      const w = ready(7);
      for (let i = 0; i < 1800; i++) {
        stepWorld(
          w,
          { steer: i % 120 < 60 ? -1 : 1, throwPaper: i % 30 === 0, powerWatts: 210 },
          DEFAULT_RIDER,
          1 / 60,
        );
      }
      return { d: w.rider.distance, s: w.score.score, l: w.rider.lives };
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run apps/canvas/test/rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shared landing rule**

`packages/game-core/src/landing.ts`:

```ts
import type { HouseSpec } from './route.js';

export interface Landing {
  distance: number;
  lateral: number;
}

export type LandingBand = 'window' | 'porch' | 'mailbox' | 'lawn' | 'street';

export interface LandingOutcome {
  band: LandingBand;
  house: HouseSpec | null;
}

/** How far along the street a paper may land and still count for a house. */
export const HOUSE_MATCH_RADIUS_M = 6;
/** Beyond this lateral the paper is in the road and counts for nothing. */
export const STREET_LATERAL = 3.7;
export const WINDOW_LATERAL = 1.4;
export const PORCH_LATERAL = 2.6;
export const PORCH_TOLERANCE_M = 0.8;
export const MAILBOX_TOLERANCE_M = 0.5;

export function classifyLanding(
  landing: Landing,
  houses: readonly HouseSpec[],
): LandingOutcome {
  let nearest: HouseSpec | null = null;
  let best = HOUSE_MATCH_RADIUS_M;
  for (const h of houses) {
    const gap = Math.abs(h.distance - landing.distance);
    if (gap <= best) {
      best = gap;
      nearest = h;
    }
  }

  const l = landing.lateral;
  if (l >= STREET_LATERAL) return { band: 'street', house: nearest };
  if (nearest === null) return { band: 'lawn', house: null };

  if (l < WINDOW_LATERAL) return { band: 'window', house: nearest };
  if (l < PORCH_LATERAL) {
    return Math.abs(l - nearest.porchLateral) <= PORCH_TOLERANCE_M
      ? { band: 'porch', house: nearest }
      : { band: 'lawn', house: nearest };
  }
  return Math.abs(l - nearest.mailboxLateral) <= MAILBOX_TOLERANCE_M
    ? { band: 'mailbox', house: nearest }
    : { band: 'lawn', house: nearest };
}
```

Add `export * from './landing.js';` to `packages/game-core/src/index.ts`.

Then write the boundary cases the app-level tests do not cover — these pin
the exact edges of each band, which is where scoring disputes live:

`packages/game-core/test/landing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  HOUSE_MATCH_RADIUS_M, PORCH_LATERAL, STREET_LATERAL, WINDOW_LATERAL,
  classifyLanding,
} from '../src/landing.js';
import type { HouseSpec } from '../src/route.js';

const spec: HouseSpec = {
  id: 'h', distance: 100, subscriber: true,
  mailboxLateral: 3.1, porchLateral: 1.9, windowLateral: 0.9,
};
const at = (lateral: number, distance = 100) =>
  classifyLanding({ distance, lateral }, [spec]);

describe('band boundaries', () => {
  it('treats exactly the street threshold as street', () => {
    expect(at(STREET_LATERAL).band).toBe('street');
  });

  it('treats just inside the street threshold as a mailbox miss', () => {
    expect(at(STREET_LATERAL - 0.001).band).toBe('lawn');
  });

  it('treats exactly the window threshold as porch territory', () => {
    expect(at(WINDOW_LATERAL).band).not.toBe('window');
  });

  it('treats just inside the window threshold as a window', () => {
    expect(at(WINDOW_LATERAL - 0.001).band).toBe('window');
  });

  it('treats exactly the porch threshold as mailbox territory', () => {
    expect(at(PORCH_LATERAL).band).not.toBe('porch');
  });
});

describe('mailbox and porch tolerances', () => {
  it('accepts a mailbox hit at the edge of tolerance', () => {
    expect(at(spec.mailboxLateral + 0.5).band).toBe('mailbox');
  });

  it('rejects a mailbox hit just outside tolerance', () => {
    expect(at(spec.mailboxLateral - 0.51).band).toBe('lawn');
  });

  it('accepts a porch hit at the edge of tolerance', () => {
    expect(at(spec.porchLateral + 0.8).band).toBe('porch');
  });
});

describe('house matching along the street', () => {
  it('matches a house at exactly the radius', () => {
    expect(at(3.1, 100 + HOUSE_MATCH_RADIUS_M).house).toBe(spec);
  });

  it('does not match a house beyond the radius', () => {
    expect(at(3.1, 100 + HOUSE_MATCH_RADIUS_M + 0.01).house).toBeNull();
  });

  it('returns a lawn landing when no house matches', () => {
    expect(at(3.1, 500).band).toBe('lawn');
  });

  it('handles an empty street without throwing', () => {
    expect(classifyLanding({ distance: 10, lateral: 3.1 }, []).band).toBe('lawn');
  });
});
```

Run: `npx vitest run packages/game-core/test/landing.test.ts`
Expected: 12 passing.

- [ ] **Step 4: Implement the app rules**

`apps/canvas/src/rules.ts`:

```ts
import {
  BLOCK_LENGTH_M, applyScoreEvent, classifyLanding,
} from '@paperboy/game-core';
import type { LandingOutcome, ScoreEvent } from '@paperboy/game-core';
import type { RiderProfile } from '@paperboy/trainer';
import {
  MAX_PAPERS, STACK_PAPERS,
  advanceRider, collectStacksRadius, ensureBlocks, moveHazards, steer,
} from './world.js';
import type { HouseState, HazardState, WorldState } from './world.js';

export const THROW_HEIGHT = 1.1;
export const THROW_V_LATERAL = -7;
export const THROW_V_UP = 3.2;
export const GRAVITY = 9.8;

export const RIDER_HALF_WIDTH = 0.4;
export const RIDER_HALF_LENGTH = 0.75;
export const HAZARD_HALF_DEPTH = 0.6;
export const INVULNERABLE_S = 1.5;
export const HOUSE_RESOLVE_MARGIN_M = 8;
export const STACK_PICKUP_DISTANCE_M = 1.5;
export const STACK_PICKUP_LATERAL_M = 1.0;

export interface FrameInput {
  steer: number;
  throwPaper: boolean;
  powerWatts: number;
}

export function throwPaper(w: WorldState): boolean {
  if (w.rider.papers <= 0 || w.gameOver) return false;
  w.rider.papers -= 1;
  w.papers.push({
    id: w.nextPaperId++,
    distance: w.rider.distance,
    lateral: w.rider.lateral,
    height: THROW_HEIGHT,
    // A little forward carry so the throw inherits the rider's momentum.
    vDistance: w.rider.speed * 0.55,
    vLateral: THROW_V_LATERAL,
    vHeight: THROW_V_UP,
  });
  return true;
}

export function updatePapers(w: WorldState, dt: number): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  const survivors: typeof w.papers = [];
  // Built once per call rather than per paper: the shared rule works on
  // specs, while the app owns the mutable per-house state.
  let specs: ReturnType<typeof toSpecs> | null = null;

  for (const p of w.papers) {
    p.vHeight -= GRAVITY * dt;
    p.distance += p.vDistance * dt;
    p.lateral += p.vLateral * dt;
    p.height += p.vHeight * dt;

    if (p.height > 0) {
      survivors.push(p);
      continue;
    }

    specs ??= toSpecs(w);
    const outcome = classifyLanding(
      { distance: p.distance, lateral: p.lateral },
      specs,
    );
    const event = resolveLanding(w, outcome);
    if (event !== null) events.push(event);
  }

  w.papers = survivors;
  return events;
}

function toSpecs(w: WorldState) {
  return w.houses.map((h) => h.spec);
}

function resolveLanding(
  w: WorldState, outcome: LandingOutcome,
): ScoreEvent | null {
  const { band } = outcome;

  if (band === 'street') return null;
  if (outcome.house === null) return { type: 'lawn' };
  if (band === 'lawn') return { type: 'lawn' };

  const house = w.houses.find((h) => h.spec === outcome.house);
  if (house === undefined) return { type: 'lawn' };

  if (band === 'window') {
    if (house.windowBroken) return null;
    house.windowBroken = true;
    if (house.spec.subscriber) {
      // They cancel: no delivery is expected from here on.
      house.resolved = true;
      return { type: 'windowSubscriber' };
    }
    return { type: 'windowNonSubscriber' };
  }

  // mailbox or porch
  if (!house.spec.subscriber || house.delivered) return null;
  house.delivered = true;
  house.resolved = true;
  return band === 'mailbox' ? { type: 'mailbox' } : { type: 'porch' };
}

export function resolvePassedHouses(w: WorldState): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  for (const h of w.houses) {
    if (h.resolved) continue;
    if (h.spec.distance > w.rider.distance - HOUSE_RESOLVE_MARGIN_M) continue;
    h.resolved = true;
    if (h.spec.subscriber && !h.delivered) events.push({ type: 'houseMissed' });
  }
  return events;
}

export function resolveBlocks(w: WorldState): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  while (w.rider.distance > (w.blocksCleared + 1) * BLOCK_LENGTH_M) {
    const index = w.blocksCleared;
    const subscribers = w.houses.filter(
      (h) =>
        h.spec.subscriber &&
        Math.floor(h.spec.distance / BLOCK_LENGTH_M) === index,
    );
    if (subscribers.length > 0 && subscribers.every((h) => h.delivered)) {
      events.push({ type: 'blockCleared' });
    }
    w.blocksCleared += 1;
  }
  return events;
}

export function collectStacks(w: WorldState): void {
  for (const s of w.stacks) {
    if (s.taken) continue;
    if (Math.abs(s.spec.distance - w.rider.distance) > STACK_PICKUP_DISTANCE_M) continue;
    if (Math.abs(s.spec.lateral - w.rider.lateral) > STACK_PICKUP_LATERAL_M) continue;
    s.taken = true;
    w.rider.papers = Math.min(MAX_PAPERS, w.rider.papers + STACK_PAPERS);
  }
}

export function detectCollision(w: WorldState): HazardState | null {
  if (w.elapsed < w.rider.invulnerableUntil) return null;
  for (const h of w.hazards) {
    const dGap = Math.abs(h.distance - w.rider.distance);
    if (dGap > RIDER_HALF_LENGTH + HAZARD_HALF_DEPTH) continue;
    const lGap = Math.abs(h.lateral - w.rider.lateral);
    if (lGap > RIDER_HALF_WIDTH + h.spec.width / 2) continue;
    return h;
  }
  return null;
}

export function applyCrash(w: WorldState): ScoreEvent[] {
  w.rider.lives -= 1;
  w.rider.speed *= 0.15;
  w.rider.invulnerableUntil = w.elapsed + INVULNERABLE_S;
  if (w.rider.lives <= 0) {
    w.rider.lives = 0;
    w.gameOver = true;
  }
  return [{ type: 'crash' }];
}

export function stepWorld(
  w: WorldState,
  input: FrameInput,
  profile: RiderProfile,
  dt: number,
): ScoreEvent[] {
  if (w.gameOver) return [];

  ensureBlocks(w);
  steer(w, input.steer, dt);
  advanceRider(w, input.powerWatts, profile, dt);
  moveHazards(w, dt);

  if (input.throwPaper) throwPaper(w);

  const events: ScoreEvent[] = [
    ...updatePapers(w, dt),
    ...resolvePassedHouses(w),
    ...resolveBlocks(w),
  ];

  collectStacks(w);

  const hit = detectCollision(w);
  if (hit !== null) events.push(...applyCrash(w));

  for (const e of events) w.score = applyScoreEvent(w.score, e);
  return events;
}
```

Remove the stray `collectStacksRadius` from the import list at the top — it is not exported by `world.ts`. The import line should read:

```ts
import {
  MAX_PAPERS, STACK_PAPERS,
  advanceRider, ensureBlocks, moveHazards, steer,
} from './world.js';
```

- [ ] **Step 5: Verify**

Run: `npx vitest run packages/game-core apps/canvas && npm run typecheck`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add packages/game-core apps/canvas/src/rules.ts apps/canvas/test/rules.test.ts
git commit -m "feat: share landing classification and add canvas run lifecycle"
```

---

### Task 17: Vector rendering

All art is drawn with canvas paths — no sprite sheets, no image loading. The one part of rendering that can be tested headlessly is draw ordering, so that is extracted into a pure function and tested; the rest is verified by looking at it.

**Visual direction.** A pre-dawn paper round: deep indigo sky bleeding to warm apricot at the horizon, desaturated sage lawns, warm ochre and terracotta houses. Subscribers read as *lit* — a warm porch light and a blue mailbox flag; non-subscribers are cool grey and dark. That reads instantly at speed, which matters more here than realism, and it keeps colour doing the gameplay work rather than an icon.

**Files:**
- Create: `apps/canvas/src/render/palette.ts`
- Create: `apps/canvas/src/render/primitives.ts`
- Create: `apps/canvas/src/render/drawables.ts`
- Create: `apps/canvas/src/render/scene.ts`
- Test: `apps/canvas/test/drawables.test.ts`

**Interfaces:**
- Consumes: `worldToScreen`, `depthKey`, `IsoConfig`, `Camera` (Task 14); `WorldState`, `HouseState`, `HazardState`, `StackState`, `Paper` (Task 15).
- Produces:

```ts
// palette.ts
export const PALETTE: {
  skyTop: string; skyHorizon: string; road: string; roadLine: string;
  sidewalk: string; lawn: string; curb: string;
  houseWall: readonly string[]; houseRoof: readonly string[];
  subscriberGlow: string; mailboxSubscriber: string; mailboxPlain: string;
  paper: string; shadow: string; rider: string; riderAccent: string;
  hazard: Record<string, string>; hud: string; hudDim: string;
};

// primitives.ts
export interface DrawCtx {
  ctx: CanvasRenderingContext2D; camera: Camera; cfg: IsoConfig;
}
export function groundQuad(
  d: DrawCtx, d0: number, l0: number, d1: number, l1: number, fill: string,
): void;
export interface BoxSpec {
  distance: number; lateral: number; depth: number; width: number;
  height: number; base?: number; top: string; left: string; right: string;
}
export function box(d: DrawCtx, spec: BoxSpec): void;
export function shadow(
  d: DrawCtx, distance: number, lateral: number, radius: number,
): void;

// drawables.ts
export type Drawable =
  | { kind: 'house'; depth: number; house: HouseState }
  | { kind: 'hazard'; depth: number; hazard: HazardState }
  | { kind: 'stack'; depth: number; stack: StackState }
  | { kind: 'paper'; depth: number; paper: Paper }
  | { kind: 'rider'; depth: number };
export function collectDrawables(w: WorldState): Drawable[];

// scene.ts
export function renderFrame(
  ctx: CanvasRenderingContext2D, w: WorldState,
  width: number, height: number,
): void;
```

- [ ] **Step 1: Write the failing draw-order tests**

`apps/canvas/test/drawables.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { depthKey } from '../src/iso.js';
import { createWorld, ensureBlocks } from '../src/world.js';
import { throwPaper } from '../src/rules.js';
import { collectDrawables } from '../src/render/drawables.js';

function populated() {
  const w = createWorld(42);
  ensureBlocks(w);
  w.rider.distance = 60;
  throwPaper(w);
  return w;
}

describe('collectDrawables', () => {
  it('returns something for every visible entity family', () => {
    const kinds = new Set(collectDrawables(populated()).map((d) => d.kind));
    expect(kinds.has('house')).toBe(true);
    expect(kinds.has('hazard')).toBe(true);
    expect(kinds.has('rider')).toBe(true);
    expect(kinds.has('paper')).toBe(true);
  });

  it('is sorted back to front', () => {
    const list = collectDrawables(populated());
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.depth).toBeGreaterThanOrEqual(list[i - 1]!.depth);
    }
  });

  it('draws the rider in front of a house at the same distance', () => {
    const w = populated();
    const house = w.houses.find((h) => Math.abs(h.spec.distance - 60) < 20)!;
    w.rider.distance = house.spec.distance;
    w.rider.lateral = 4.0;

    const list = collectDrawables(w);
    const riderAt = list.findIndex((d) => d.kind === 'rider');
    const houseAt = list.findIndex(
      (d) => d.kind === 'house' && d.house === house,
    );
    expect(riderAt).toBeGreaterThan(houseAt);
  });

  it('uses the shared depth key', () => {
    const w = populated();
    const entry = collectDrawables(w).find((d) => d.kind === 'rider')!;
    expect(entry.depth).toBeCloseTo(
      depthKey(w.rider.distance, w.rider.lateral), 6,
    );
  });

  it('culls entities far behind and far ahead of the rider', () => {
    const w = populated();
    const drawn = collectDrawables(w);
    for (const d of drawn) {
      if (d.kind !== 'house') continue;
      expect(d.house.spec.distance).toBeGreaterThan(w.rider.distance - 60);
      expect(d.house.spec.distance).toBeLessThan(w.rider.distance + 260);
    }
  });

  it('does not include a collected paper stack', () => {
    const w = populated();
    w.stacks.forEach((s) => { s.taken = true; });
    expect(collectDrawables(w).some((d) => d.kind === 'stack')).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run apps/canvas/test/drawables.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the palette**

`apps/canvas/src/render/palette.ts`:

```ts
export const PALETTE = {
  skyTop: '#1b1f3b',
  skyHorizon: '#e8a166',
  road: '#33384a',
  roadLine: '#6d7490',
  sidewalk: '#b9b2a6',
  lawn: '#5f7a5a',
  curb: '#8d8779',
  houseWall: ['#c47a4e', '#a8623f', '#9c8552', '#7d6b53', '#b0855c'],
  houseRoof: ['#4a3b33', '#3d3129', '#55443a'],
  subscriberGlow: '#ffd98a',
  mailboxSubscriber: '#4f9dd6',
  mailboxPlain: '#6b6b6b',
  paper: '#f2ead9',
  shadow: 'rgba(10, 12, 24, 0.35)',
  rider: '#e5533d',
  riderAccent: '#f2ead9',
  hazard: {
    car: '#c9d1e8',
    dog: '#8a6b4a',
    sprinkler: '#7fc4d6',
    lawnmower: '#7ba05b',
    drain: '#2a2e3d',
    bin: '#4c5a4a',
    skater: '#d98d3f',
  } as Record<string, string>,
  hud: '#f2ead9',
  hudDim: 'rgba(242, 234, 217, 0.55)',
} as const;
```

- [ ] **Step 4: Write the drawing primitives**

`apps/canvas/src/render/primitives.ts`:

```ts
import { worldToScreen } from '../iso.js';
import type { Camera, IsoConfig } from '../iso.js';

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  cfg: IsoConfig;
}

const p = (d: DrawCtx, distance: number, lateral: number, height = 0) =>
  worldToScreen(distance, lateral, height, d.camera, d.cfg);

export function groundQuad(
  d: DrawCtx, d0: number, l0: number, d1: number, l1: number, fill: string,
): void {
  const { ctx } = d;
  const a = p(d, d0, l0);
  const b = p(d, d1, l0);
  const c = p(d, d1, l1);
  const e = p(d, d0, l1);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(e.x, e.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export interface BoxSpec {
  distance: number;
  lateral: number;
  depth: number;
  width: number;
  height: number;
  base?: number;
  top: string;
  left: string;
  right: string;
}

/**
 * An isometric box. In this projection the faces nearest the viewer are the
 * one at greater lateral and the one at lesser distance, so only those two
 * plus the top are drawn.
 */
export function box(d: DrawCtx, spec: BoxSpec): void {
  const { ctx } = d;
  const base = spec.base ?? 0;
  const dLo = spec.distance - spec.depth / 2;
  const dHi = spec.distance + spec.depth / 2;
  const lLo = spec.lateral - spec.width / 2;
  const lHi = spec.lateral + spec.width / 2;
  const hTop = base + spec.height;

  const face = (pts: Array<{ x: number; y: number }>, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const pt of pts.slice(1)) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Face at greater lateral (toward the road).
  face(
    [
      p(d, dLo, lHi, base), p(d, dHi, lHi, base),
      p(d, dHi, lHi, hTop), p(d, dLo, lHi, hTop),
    ],
    spec.right,
  );

  // Face at lesser distance (toward the rider).
  face(
    [
      p(d, dLo, lLo, base), p(d, dLo, lHi, base),
      p(d, dLo, lHi, hTop), p(d, dLo, lLo, hTop),
    ],
    spec.left,
  );

  face(
    [
      p(d, dLo, lLo, hTop), p(d, dHi, lLo, hTop),
      p(d, dHi, lHi, hTop), p(d, dLo, lHi, hTop),
    ],
    spec.top,
  );
}

export function shadow(
  d: DrawCtx, distance: number, lateral: number, radius: number,
): void {
  const { ctx, cfg } = d;
  const c = p(d, distance, lateral, 0);
  ctx.beginPath();
  ctx.ellipse(
    c.x, c.y, radius * cfg.tileW * 0.5, radius * cfg.tileH * 0.5, 0, 0, Math.PI * 2,
  );
  ctx.fillStyle = 'rgba(10, 12, 24, 0.35)';
  ctx.fill();
}
```

- [ ] **Step 5: Write the drawable collector**

`apps/canvas/src/render/drawables.ts`:

```ts
import { depthKey } from '../iso.js';
import type {
  HazardState, HouseState, Paper, StackState, WorldState,
} from '../world.js';

export const CULL_BEHIND_M = 60;
export const CULL_AHEAD_M = 260;

export type Drawable =
  | { kind: 'house'; depth: number; house: HouseState }
  | { kind: 'hazard'; depth: number; hazard: HazardState }
  | { kind: 'stack'; depth: number; stack: StackState }
  | { kind: 'paper'; depth: number; paper: Paper }
  | { kind: 'rider'; depth: number };

export function collectDrawables(w: WorldState): Drawable[] {
  const lo = w.rider.distance - CULL_BEHIND_M;
  const hi = w.rider.distance + CULL_AHEAD_M;
  const visible = (distance: number) => distance > lo && distance < hi;

  const out: Drawable[] = [];

  for (const house of w.houses) {
    if (!visible(house.spec.distance)) continue;
    out.push({
      kind: 'house',
      depth: depthKey(house.spec.distance, 0.75),
      house,
    });
  }
  for (const hazard of w.hazards) {
    if (!visible(hazard.distance)) continue;
    out.push({
      kind: 'hazard',
      depth: depthKey(hazard.distance, hazard.lateral),
      hazard,
    });
  }
  for (const stack of w.stacks) {
    if (stack.taken || !visible(stack.spec.distance)) continue;
    out.push({
      kind: 'stack',
      depth: depthKey(stack.spec.distance, stack.spec.lateral),
      stack,
    });
  }
  for (const paper of w.papers) {
    if (!visible(paper.distance)) continue;
    out.push({
      kind: 'paper',
      depth: depthKey(paper.distance, paper.lateral),
      paper,
    });
  }
  out.push({
    kind: 'rider',
    depth: depthKey(w.rider.distance, w.rider.lateral),
  });

  out.sort((a, b) => a.depth - b.depth);
  return out;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run apps/canvas/test/drawables.test.ts`
Expected: 6 passing.

- [ ] **Step 7: Write the scene renderer**

`apps/canvas/src/render/scene.ts`:

```ts
import { DEFAULT_ISO, worldToScreen } from '../iso.js';
import type { Camera, IsoConfig } from '../iso.js';
import type { WorldState } from '../world.js';
import { collectDrawables } from './drawables.js';
import { PALETTE } from './palette.js';
import { box, groundQuad, shadow } from './primitives.js';
import type { DrawCtx } from './primitives.js';

const HOUSE_WIDTH = 1.4;
const HOUSE_DEPTH = 9;
const HOUSE_HEIGHT = 3.2;

/** Stable per-entity colour choice, so a house does not shimmer between frames. */
function hashPick<T>(id: string, items: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return items[h % items.length]!;
}

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * amount);
  const g = clamp(((n >> 8) & 255) * amount);
  const b = clamp((n & 255) * amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function drawSky(
  ctx: CanvasRenderingContext2D, width: number, height: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(1, PALETTE.skyHorizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function drawStreet(d: DrawCtx, w: WorldState): void {
  const from = w.rider.distance - 80;
  const to = w.rider.distance + 280;
  groundQuad(d, from, 1.5, to, 3.0, PALETTE.lawn);
  groundQuad(d, from, 3.0, to, 4.5, PALETTE.sidewalk);
  groundQuad(d, from, 4.5, to, 5.5, PALETTE.curb);
  groundQuad(d, from, 5.5, to, 10.0, PALETTE.road);

  // Centre line, dashed by construction rather than by setLineDash.
  for (let s = Math.floor(from / 8) * 8; s < to; s += 8) {
    groundQuad(d, s, 7.6, s + 4, 7.9, PALETTE.roadLine);
  }
}

function drawHouse(d: DrawCtx, house: WorldState['houses'][number]): void {
  const wall = hashPick(house.spec.id, PALETTE.houseWall);
  const roof = hashPick(`${house.spec.id}r`, PALETTE.houseRoof);
  const lit = house.spec.subscriber && !house.windowBroken;

  box(d, {
    distance: house.spec.distance,
    lateral: 0.75,
    depth: HOUSE_DEPTH,
    width: HOUSE_WIDTH,
    height: HOUSE_HEIGHT,
    top: roof,
    left: shade(wall, lit ? 1.0 : 0.62),
    right: shade(wall, lit ? 0.86 : 0.5),
  });

  // Window: lit and warm for a subscriber, dark once smashed.
  const wx = worldToScreen(
    house.spec.distance - 2.2, house.spec.windowLateral, 1.8,
    d.camera, d.cfg,
  );
  d.ctx.fillStyle = house.windowBroken
    ? '#1a1c26'
    : lit ? PALETTE.subscriberGlow : '#3a4055';
  d.ctx.fillRect(wx.x - 5, wx.y - 7, 10, 12);

  // Mailbox at the kerbside edge of the lawn.
  box(d, {
    distance: house.spec.distance,
    lateral: house.spec.mailboxLateral,
    depth: 0.35,
    width: 0.35,
    height: house.delivered ? 0.7 : 1.0,
    top: house.spec.subscriber
      ? PALETTE.mailboxSubscriber
      : PALETTE.mailboxPlain,
    left: shade(house.spec.subscriber ? '#4f9dd6' : '#6b6b6b', 0.7),
    right: shade(house.spec.subscriber ? '#4f9dd6' : '#6b6b6b', 0.55),
  });
}

function drawRider(d: DrawCtx, w: WorldState): void {
  const blink =
    w.elapsed < w.rider.invulnerableUntil &&
    Math.floor(w.elapsed * 12) % 2 === 0;
  if (blink) return;

  shadow(d, w.rider.distance, w.rider.lateral, 1.0);
  box(d, {
    distance: w.rider.distance,
    lateral: w.rider.lateral,
    depth: 1.5,
    width: 0.6,
    height: 1.7,
    top: PALETTE.riderAccent,
    left: PALETTE.rider,
    right: shade('#e5533d', 0.75),
  });
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  width: number,
  height: number,
): void {
  drawSky(ctx, width, height);

  const camera: Camera = { distance: w.rider.distance };
  const cfg: IsoConfig = {
    ...DEFAULT_ISO,
    originX: width * 0.34,
    originY: height * 0.62,
  };
  const d: DrawCtx = { ctx, camera, cfg };

  drawStreet(d, w);

  for (const item of collectDrawables(w)) {
    switch (item.kind) {
      case 'house':
        drawHouse(d, item.house);
        break;
      case 'hazard': {
        const colour = PALETTE.hazard[item.hazard.spec.kind] ?? '#999';
        shadow(d, item.hazard.distance, item.hazard.lateral, item.hazard.spec.width);
        box(d, {
          distance: item.hazard.distance,
          lateral: item.hazard.lateral,
          depth: item.hazard.spec.kind === 'car' ? 4 : 1,
          width: item.hazard.spec.width,
          height: item.hazard.spec.kind === 'drain' ? 0.1 : 1.2,
          top: colour,
          left: shade(colour, 0.72),
          right: shade(colour, 0.56),
        });
        break;
      }
      case 'stack':
        box(d, {
          distance: item.stack.spec.distance,
          lateral: item.stack.spec.lateral,
          depth: 0.6, width: 0.6, height: 0.4,
          top: PALETTE.paper,
          left: shade('#f2ead9', 0.8),
          right: shade('#f2ead9', 0.65),
        });
        break;
      case 'paper':
        shadow(d, item.paper.distance, item.paper.lateral, 0.35);
        box(d, {
          distance: item.paper.distance,
          lateral: item.paper.lateral,
          depth: 0.3, width: 0.3, height: 0.18,
          base: item.paper.height,
          top: PALETTE.paper,
          left: shade('#f2ead9', 0.82),
          right: shade('#f2ead9', 0.68),
        });
        break;
      case 'rider':
        drawRider(d, w);
        break;
    }
  }
}
```

- [ ] **Step 8: Verify by eye**

There is no test for "does it look right". After Task 18 wires the loop, run `npm --workspace @paperboy/canvas run dev` and check:

1. The street scrolls diagonally up-and-right as you pedal.
2. Houses never draw on top of the rider when the rider is beside them.
3. Subscriber houses are visibly warmer and lit; non-subscribers are cool and dark.
4. Thrown papers arc and their shadows track the landing point.
5. Nothing pops in or out abruptly at the edges of the cull window.

- [ ] **Step 9: Commit**

```bash
git add apps/canvas/src/render apps/canvas/test/drawables.test.ts
git commit -m "feat(canvas): render the street, houses and entities as vector isometric art"
```

---

### Task 18: Session, loop, HUD and trainer wiring

The last task of Phase 4. It closes the loop: trainer power drives the world, and the world pushes grade back to the trainer.

**Files:**
- Create: `apps/canvas/src/session.ts`
- Create: `apps/canvas/src/input.ts`
- Create: `apps/canvas/src/hud.ts`
- Create: `apps/canvas/src/main.ts`
- Create: `apps/canvas/index.html`
- Test: `apps/canvas/test/session.test.ts`

**Interfaces:**
- Consumes: `createWorld`, `WorldState`, `gradeAt`, `surfaceCrr` (Task 15); `stepWorld`, `FrameInput` (Task 16); `renderFrame` (Task 17); `RunResult`, `recordRun`, `loadStats`, `dailySeed`, `randomSeed`, `seedFromString` from `@paperboy/game-core`; `TrainerSource`, `KeyboardSource`, `FtmsSource`, `createWebBluetoothConnector`, `DEFAULT_RIDER`, `RiderProfile`, `SimulationParams` from `@paperboy/trainer`.
- Produces:

```ts
// session.ts
export const POWER_TAU_S = 0.25;
export const FIXED_DT = 1 / 120;
export const MAX_SUBSTEPS = 30;
export interface Session {
  world: WorldState; profile: RiderProfile;
  powerTarget: number; powerCurrent: number;
  kilojoules: number; paused: boolean;
}
export interface SessionInput { steer: number; throwPaper: boolean }
export function createSession(seed: number, profile: RiderProfile): Session;
export function setPower(s: Session, watts: number | null): void;
export function advance(s: Session, input: SessionInput, dt: number): ScoreEvent[];
export function advanceFixed(s: Session, elapsedS: number, input: SessionInput): void;
export function simulationFor(s: Session): SimulationParams;
export function toRunResult(s: Session): RunResult;

// input.ts
export interface InputState {
  steer: number; throwPressed: boolean; pausePressed: boolean; panicPressed: boolean;
}
export function createInput(target: EventTarget): {
  read(): InputState; dispose(): void;
};
```

`advance` takes edge-triggered `throwPaper`, so `input.ts` reports a *press*, not a held key — otherwise one keypress empties the bundle across 120 substeps.

- [ ] **Step 1: Write the failing tests**

`apps/canvas/test/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { START_PAPERS } from '../src/world.js';
import {
  FIXED_DT, advance, advanceFixed, createSession, setPower,
  simulationFor, toRunResult,
} from '../src/session.js';

const still = { steer: 0, throwPaper: false };

describe('createSession', () => {
  it('starts stopped with no energy spent', () => {
    const s = createSession(42, DEFAULT_RIDER);
    expect(s.world.rider.speed).toBe(0);
    expect(s.kilojoules).toBe(0);
    expect(s.powerCurrent).toBe(0);
  });
});

describe('setPower', () => {
  it('records a target rather than snapping the current value', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 250);
    expect(s.powerTarget).toBe(250);
    expect(s.powerCurrent).toBe(0);
  });

  it('treats a null reading as zero rather than throwing', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, null);
    expect(s.powerTarget).toBe(0);
  });

  it('ignores an implausible reading', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 99_999);
    expect(s.powerTarget).toBeLessThanOrEqual(2000);
  });
});

describe('advance', () => {
  it('eases power toward the target instead of stepping to it', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 300);
    advance(s, still, 1 / 60);
    expect(s.powerCurrent).toBeGreaterThan(0);
    expect(s.powerCurrent).toBeLessThan(300);
  });

  it('converges on the target when it is held', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 300);
    for (let i = 0; i < 300; i++) advance(s, still, 1 / 60);
    expect(s.powerCurrent).toBeCloseTo(300, 0);
  });

  it('accumulates energy as power times time', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 200);
    for (let i = 0; i < 600; i++) advance(s, still, 1 / 60);
    // Roughly 200 W for 10 s, minus the easing ramp: about 2 kJ.
    expect(s.kilojoules).toBeGreaterThan(1.5);
    expect(s.kilojoules).toBeLessThan(2.1);
  });

  it('does nothing at all while paused', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 300);
    s.paused = true;
    advance(s, still, 1);
    expect(s.world.rider.distance).toBe(0);
    expect(s.kilojoules).toBe(0);
  });

  it('spends exactly one paper for one throw input', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, { steer: 0, throwPaper: true }, 1 / 60);
    expect(s.world.rider.papers).toBe(START_PAPERS - 1);
  });
});

describe('advanceFixed', () => {
  it('divides a long frame into fixed substeps', () => {
    const a = createSession(42, DEFAULT_RIDER);
    const b = createSession(42, DEFAULT_RIDER);
    setPower(a, 250);
    setPower(b, 250);

    // 0.2 s is 24 substeps — inside MAX_SUBSTEPS, so nothing is clamped away.
    advanceFixed(a, 0.2, still);
    for (let i = 0; i < 24; i++) advance(b, still, FIXED_DT);

    expect(a.world.rider.distance).toBeCloseTo(b.world.rider.distance, 3);
  });

  it('caps substeps so a stalled tab cannot freeze the loop', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 250);
    const start = Date.now();
    advanceFixed(s, 600, still);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('throws only once even when a frame spans many substeps', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advanceFixed(s, 0.5, { steer: 0, throwPaper: true });
    expect(s.world.rider.papers).toBe(START_PAPERS - 1);
  });
});

describe('simulationFor', () => {
  it('reports the grade of the block the rider is on', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    const sim = simulationFor(s);
    expect(sim.grade).toBe(s.world.blocks[0]!.gradePercent);
  });

  it('reports a higher rolling resistance on the lawn', () => {
    const s = createSession(42, DEFAULT_RIDER);
    advance(s, still, 1 / 60);
    s.world.rider.lateral = 3.8;
    const road = simulationFor(s).crr;
    s.world.rider.lateral = 2.2;
    expect(simulationFor(s).crr).toBeGreaterThan(road);
  });

  it('never asks for a grade beyond the trainer clamp', () => {
    const s = createSession(42, DEFAULT_RIDER);
    for (let i = 0; i < 200; i++) {
      s.world.rider.distance = i * 120;
      advance(s, still, 1 / 60);
      expect(Math.abs(simulationFor(s).grade)).toBeLessThanOrEqual(8);
    }
  });
});

describe('toRunResult', () => {
  it('summarises the ride', () => {
    const s = createSession(42, DEFAULT_RIDER);
    setPower(s, 200);
    for (let i = 0; i < 1200; i++) advance(s, still, 1 / 60);
    const r = toRunResult(s);
    expect(r.seed).toBe(42);
    expect(r.distanceM).toBeGreaterThan(0);
    expect(r.durationMs).toBeGreaterThan(0);
    expect(r.avgPower).toBeGreaterThan(100);
    expect(r.kilojoules).toBeGreaterThan(0);
  });

  it('reports zero average power for a zero-length ride', () => {
    expect(toRunResult(createSession(42, DEFAULT_RIDER)).avgPower).toBe(0);
  });
});

describe('smoke run', () => {
  it('plays a full run to game over without breaking', () => {
    const s = createSession(1337, DEFAULT_RIDER);
    setPower(s, 240);
    for (let i = 0; i < 60 * 60 * 10; i++) {
      advance(s, { steer: Math.sin(i / 90) > 0 ? -1 : 1, throwPaper: i % 45 === 0 }, 1 / 60);
      if (s.world.gameOver) break;
      expect(Number.isFinite(s.world.rider.distance)).toBe(true);
      expect(s.world.rider.papers).toBeGreaterThanOrEqual(0);
    }
    expect(s.world.rider.distance).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run apps/canvas/test/session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the session**

`apps/canvas/src/session.ts`:

```ts
import type { RunResult, ScoreEvent } from '@paperboy/game-core';
import type { RiderProfile, SimulationParams } from '@paperboy/trainer';
import { clampGrade } from '@paperboy/trainer';
import { createWorld, gradeAt, surfaceCrr } from './world.js';
import type { WorldState } from './world.js';
import { stepWorld } from './rules.js';

export const POWER_TAU_S = 0.25;
export const FIXED_DT = 1 / 120;
/**
 * main.ts clamps a frame to 0.25 s, which at FIXED_DT needs exactly 30
 * substeps. A lower cap would silently slow the game down whenever a frame
 * ran long, rather than only when the tab had genuinely stalled.
 */
export const MAX_SUBSTEPS = 30;
export const MAX_PLAUSIBLE_WATTS = 2000;

export interface Session {
  world: WorldState;
  profile: RiderProfile;
  powerTarget: number;
  powerCurrent: number;
  kilojoules: number;
  paused: boolean;
}

export interface SessionInput {
  steer: number;
  throwPaper: boolean;
}

export function createSession(seed: number, profile: RiderProfile): Session {
  return {
    world: createWorld(seed),
    profile,
    powerTarget: 0,
    powerCurrent: 0,
    kilojoules: 0,
    paused: false,
  };
}

export function setPower(s: Session, watts: number | null): void {
  if (watts === null || !Number.isFinite(watts) || watts < 0) {
    s.powerTarget = 0;
    return;
  }
  s.powerTarget = Math.min(MAX_PLAUSIBLE_WATTS, watts);
}

export function advance(
  s: Session, input: SessionInput, dt: number,
): ScoreEvent[] {
  if (s.paused || s.world.gameOver) return [];

  // Trainers notify at 1-4 Hz. Easing rather than stepping keeps the rider
  // from lurching once per notification.
  const alpha = 1 - Math.exp(-dt / POWER_TAU_S);
  s.powerCurrent += (s.powerTarget - s.powerCurrent) * alpha;
  s.kilojoules += (s.powerCurrent * dt) / 1000;

  return stepWorld(
    s.world,
    { steer: input.steer, throwPaper: input.throwPaper, powerWatts: s.powerCurrent },
    s.profile,
    dt,
  );
}

export function advanceFixed(
  s: Session, elapsedS: number, input: SessionInput,
): void {
  const steps = Math.min(MAX_SUBSTEPS, Math.floor(elapsedS / FIXED_DT));
  for (let i = 0; i < steps; i++) {
    // A throw is edge-triggered: only the first substep of a frame may throw.
    advance(s, { steer: input.steer, throwPaper: input.throwPaper && i === 0 }, FIXED_DT);
  }
}

export function simulationFor(s: Session): SimulationParams {
  return {
    grade: clampGrade(gradeAt(s.world, s.world.rider.distance)),
    headwind: 0,
    crr: surfaceCrr(s.world.rider.lateral),
    cw: 0.51,
  };
}

export function toRunResult(s: Session): RunResult {
  const seconds = s.world.elapsed;
  return {
    seed: s.world.seed,
    score: s.world.score.score,
    distanceM: Math.round(s.world.rider.distance),
    durationMs: Math.round(seconds * 1000),
    avgPower: seconds > 0 ? Math.round((s.kilojoules * 1000) / seconds) : 0,
    kilojoules: Math.round(s.kilojoules),
    papersDelivered: s.world.score.papersDelivered,
  };
}
```

- [ ] **Step 4: Run the session tests**

Run: `npx vitest run apps/canvas/test/session.test.ts`
Expected: all passing, including the ten-minute smoke run.

- [ ] **Step 5: Implement input**

`apps/canvas/src/input.ts`:

```ts
export interface InputState {
  steer: number;
  throwPressed: boolean;
  pausePressed: boolean;
  panicPressed: boolean;
}

export function createInput(target: EventTarget): {
  read(): InputState;
  dispose(): void;
} {
  const held = new Set<string>();
  let throwPressed = false;
  let pausePressed = false;
  let panicPressed = false;

  const down = (e: Event) => {
    const key = (e as KeyboardEvent).key;
    held.add(key);
    if (key === ' ') throwPressed = true;
    if (key === 'p' || key === 'P') pausePressed = true;
    if (key === 'Escape') panicPressed = true;
    if (key === ' ' || key.startsWith('Arrow')) e.preventDefault();
  };
  const up = (e: Event) => held.delete((e as KeyboardEvent).key);
  const blur = () => held.clear();

  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);

  return {
    read() {
      const state: InputState = {
        steer:
          (held.has('ArrowLeft') ? -1 : 0) + (held.has('ArrowRight') ? 1 : 0),
        throwPressed,
        pausePressed,
        panicPressed,
      };
      // Edge-triggered inputs are consumed by reading them.
      throwPressed = false;
      pausePressed = false;
      panicPressed = false;
      return state;
    },
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    },
  };
}
```

- [ ] **Step 6: Implement the HUD**

`apps/canvas/src/hud.ts`:

```ts
import { PALETTE } from './render/palette.js';
import type { Session } from './session.js';

export function drawHud(
  ctx: CanvasRenderingContext2D,
  s: Session,
  width: number,
  trainerLabel: string,
): void {
  const w = s.world;
  ctx.save();
  ctx.font = '600 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = PALETTE.hud;

  ctx.fillText(`${w.score.score}`, 20, 18);
  if (w.score.multiplier > 1) {
    ctx.fillStyle = PALETTE.subscriberGlow;
    ctx.fillText(`x${w.score.multiplier}`, 20, 44);
  }

  ctx.fillStyle = PALETTE.hud;
  ctx.fillText(`${w.rider.papers} papers`, 160, 18);
  ctx.fillText('♦'.repeat(w.rider.lives), 160, 44);

  ctx.textAlign = 'right';
  ctx.fillText(`${(w.rider.speed * 3.6).toFixed(1)} km/h`, width - 20, 18);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = '400 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`${Math.round(s.powerCurrent)} W`, width - 20, 46);
  ctx.fillText(`${Math.round(w.rider.distance)} m`, width - 20, 64);
  ctx.fillText(trainerLabel, width - 20, 82);
  ctx.restore();
}
```

- [ ] **Step 7: Implement the shell**

`apps/canvas/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Paperboy — Canvas</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: #12141f; overflow: hidden;
             font: 15px ui-monospace, SFMono-Regular, Menlo, monospace;
             color: #f2ead9; }
      canvas { display: block; }
      #overlay { position: fixed; inset: 0; display: grid; place-items: center;
                 background: rgba(18, 20, 31, .88); text-align: center; }
      #overlay[hidden] { display: none; }
      .panel { max-width: 34rem; padding: 2rem; line-height: 1.6; }
      h1 { font-size: 2rem; margin: 0 0 .5rem; letter-spacing: .04em; }
      button, input { font: inherit; padding: .6rem 1rem; margin: .3rem;
                      background: #262a3d; color: inherit;
                      border: 1px solid #3c4257; border-radius: 6px; }
      button:hover { background: #333852; cursor: pointer; }
      .dim { color: rgba(242, 234, 217, .6); }
    </style>
  </head>
  <body>
    <canvas id="stage"></canvas>
    <div id="overlay">
      <div class="panel" id="panel"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Implement the bootstrap**

`apps/canvas/src/main.ts`:

```ts
import {
  dailySeed, loadStats, randomSeed, recordRun, seedFromString,
} from '@paperboy/game-core';
import {
  DEFAULT_RIDER, FtmsSource, KeyboardSource, createWebBluetoothConnector,
} from '@paperboy/trainer';
import type { TrainerSource } from '@paperboy/trainer';
import { createInput } from './input.js';
import { drawHud } from './hud.js';
import { renderFrame } from './render/scene.js';
import {
  advanceFixed, createSession, setPower, simulationFor, toRunResult,
} from './session.js';
import type { Session } from './session.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;
const input = createInput(window);

let session: Session | null = null;
let source: TrainerSource | null = null;
let trainerLabel = 'no trainer';
let lastFrame = performance.now();

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

async function useSource(next: TrainerSource): Promise<void> {
  await source?.stop();
  source = next;
  next.onStatus((s) => {
    trainerLabel =
      s.kind === 'connected'
        ? `${s.deviceName ?? 'trainer'}${s.canControlResistance ? '' : ' (read-only)'}`
        : s.message ?? s.kind;
  });
  next.onSample((s) => {
    if (session !== null) setPower(session, s.power);
  });
  await next.start();
}

function showMenu(): void {
  const stats = loadStats(window.localStorage);
  panel.innerHTML = `
    <h1>PAPERBOY</h1>
    <p class="dim">Pedal to move. ← → steer, Space throws, P pauses,
      Esc kills resistance.</p>
    <p>High score <b>${stats.highScore}</b> · best ${stats.bestDistanceM} m
      · ${stats.runs} runs</p>
    <p>
      <button id="connect">Connect KICKR</button>
      <button id="keyboard">Keyboard (hold W)</button>
    </p>
    <p>
      <input id="seed" placeholder="seed (optional)" />
      <button id="daily">Daily route</button>
      <button id="start">Ride</button>
    </p>
    <p class="dim">Chrome or Edge only. Close Zwift and the Wahoo app first.</p>
  `;
  overlay.hidden = false;

  const seedInput = document.getElementById('seed') as HTMLInputElement;
  document.getElementById('connect')!.addEventListener('click', () => {
    void useSource(new FtmsSource(createWebBluetoothConnector()));
  });
  document.getElementById('keyboard')!.addEventListener('click', () => {
    void useSource(new KeyboardSource());
  });
  document.getElementById('daily')!.addEventListener('click', () => {
    seedInput.value = String(dailySeed(new Date()));
  });
  document.getElementById('start')!.addEventListener('click', () => {
    const raw = seedInput.value.trim();
    const seed =
      raw === '' ? randomSeed()
      : /^\d+$/.test(raw) ? Number(raw)
      : seedFromString(raw);
    startRun(seed);
  });
}

function startRun(seed: number): void {
  session = createSession(seed, DEFAULT_RIDER);
  overlay.hidden = true;
  lastFrame = performance.now();
}

function endRun(s: Session): void {
  const result = toRunResult(s);
  const stats = recordRun(result, window.localStorage);
  const best = stats.perSeedBest[String(result.seed)] ?? result.score;
  panel.innerHTML = `
    <h1>${result.score}</h1>
    <p>${result.papersDelivered} papers · ${result.distanceM} m
      · ${Math.round(result.durationMs / 1000)} s</p>
    <p class="dim">${result.avgPower} W average · ${result.kilojoules} kJ</p>
    <p>Best on seed <b>${result.seed}</b>: ${best}
      · all-time ${stats.highScore}</p>
    <p>
      <button id="again">Same route again</button>
      <button id="menu">Menu</button>
    </p>
  `;
  overlay.hidden = false;
  document.getElementById('again')!.addEventListener('click', () =>
    startRun(result.seed),
  );
  document.getElementById('menu')!.addEventListener('click', showMenu);
  session = null;
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  const state = input.read();

  if (session !== null) {
    if (state.panicPressed) {
      source?.setSimulation({ grade: 0, headwind: 0, crr: 0.004, cw: 0.51 });
      session.paused = true;
    }
    if (state.pausePressed) session.paused = !session.paused;

    advanceFixed(session, dt, {
      steer: state.steer,
      throwPaper: state.throwPressed,
    });
    source?.setSimulation(simulationFor(session));

    renderFrame(ctx, session.world, window.innerWidth, window.innerHeight);
    drawHud(ctx, session, window.innerWidth, trainerLabel);

    if (session.world.gameOver) endRun(session);
  }

  requestAnimationFrame(frame);
}

window.addEventListener('beforeunload', () => {
  source?.setSimulation({ grade: 0, headwind: 0, crr: 0.004, cw: 0.51 });
  void source?.stop();
});

showMenu();
requestAnimationFrame(frame);
```

- [ ] **Step 9: Verify in the browser**

Run: `npm --workspace @paperboy/canvas run dev` and open `http://localhost:5181`.

Check with the keyboard source first — no bike needed:

1. Hold `W`: the rider accelerates and the street scrolls.
2. `←`/`→` steer; the lawn visibly slows you and the road is fast.
3. Space throws one paper per press. Mailbox hits score 500 and raise the multiplier.
4. Hitting a hazard costs a life and the rider blinks.
5. Three crashes ends the run and shows the summary card.
6. "Same route again" reproduces the identical street.

Then with the KICKR connected: pedal, confirm power appears in the HUD, and confirm resistance changes as blocks with different grades go by. Press `Escape` and confirm resistance drops immediately.

- [ ] **Step 10: Commit**

```bash
git add apps/canvas
git commit -m "feat(canvas): wire the trainer into a playable run with HUD and menus"
```

**Phase 4 gate:** Version A is playable end to end. This is the point at which the project is worth showing to someone.

---

## Phase 5 — Version B: Phaser 3

Version B must be the *same game* — same routes, same scoring, same physics, because all of that comes from the shared packages — implemented with Phaser's idioms rather than a hand-rolled loop. Where Version A hand-sorts a flat array and draws immediate-mode paths, Version B uses the Phaser display list, per-object depth, and Arcade physics bodies.

**The one architectural wrinkle worth knowing before starting.** Arcade physics is axis-aligned, and an isometric projection is not an axis-aligned view of the world. Version B therefore runs physics in **world space** — bodies positioned at `(distance, lateral)` scaled to pixels — and keeps a separate **view container** per entity whose screen position is derived each frame by projection. Collision is Arcade's; rendering is the display list's. Do not try to put the bodies in screen space; the boxes will not line up with the art.

### Task 19: Phaser scaffold and world-space entity model

**Files:**
- Create: `apps/phaser/package.json`, `apps/phaser/vite.config.ts`, `apps/phaser/tsconfig.json`, `apps/phaser/index.html`
- Create: `apps/phaser/src/iso.ts`
- Create: `apps/phaser/src/logic/entities.ts`
- Test: `apps/phaser/test/entities.test.ts`

**Interfaces:**
- Consumes: `generateBlock`, `BLOCK_LENGTH_M`, `RIDABLE_MIN`, `RIDABLE_MAX`, `INITIAL_SCORE_STATE`, `applyScoreEvent`, `ScoreEvent` from `@paperboy/game-core`; `stepPhysics`, `RiderProfile` from `@paperboy/trainer`.
- Produces:

```ts
// iso.ts — same maths as Version A, restated so the apps stay independent.
export const PX_PER_M = 24;   // world-space physics scale
export interface IsoConfig { tileW: number; tileH: number; heightScale: number }
export const PHASER_ISO: IsoConfig;
export function project(
  distance: number, lateral: number, height: number, cameraDistance: number,
  cfg?: IsoConfig,
): { x: number; y: number };
export function toBodyX(distance: number): number;
export function toBodyY(lateral: number): number;
export function fromBodyX(x: number): number;
export function fromBodyY(y: number): number;

// logic/entities.ts
export interface EntityRecord {
  id: string;
  kind: 'house' | 'hazard' | 'stack';
  distance: number;
  lateral: number;
  width: number;
  spec: unknown;
}
export interface StreamResult { added: EntityRecord[]; removed: string[] }
export class BlockStreamer {
  constructor(seed: number);
  readonly blocks: BlockSpec[];
  update(riderDistance: number): StreamResult;
  gradeAt(distance: number): number;
}
export function surfaceCrr(lateral: number): number;
```

`BlockStreamer` returns *deltas* rather than a whole world, because Phaser needs to create and destroy game objects rather than re-read an array each frame. That difference — pull versus push — is one of the things the bake-off is measuring.

- [ ] **Step 1: Scaffold**

`apps/phaser/package.json`:

```json
{
  "name": "@paperboy/phaser",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": {
    "@paperboy/trainer": "*",
    "@paperboy/game-core": "*",
    "phaser": "^3.86.0"
  }
}
```

`apps/phaser/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5182, host: 'localhost' } });
```

`apps/phaser/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`apps/phaser/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Paperboy — Phaser</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: #12141f; overflow: hidden;
             font: 15px ui-monospace, SFMono-Regular, Menlo, monospace;
             color: #f2ead9; }
      #overlay { position: fixed; inset: 0; display: grid; place-items: center;
                 background: rgba(18, 20, 31, .88); text-align: center; }
      #overlay[hidden] { display: none; }
      .panel { max-width: 34rem; padding: 2rem; line-height: 1.6; }
      h1 { font-size: 2rem; margin: 0 0 .5rem; letter-spacing: .04em; }
      button, input { font: inherit; padding: .6rem 1rem; margin: .3rem;
                      background: #262a3d; color: inherit;
                      border: 1px solid #3c4257; border-radius: 6px; }
      button:hover { background: #333852; cursor: pointer; }
      .dim { color: rgba(242, 234, 217, .6); }
    </style>
  </head>
  <body>
    <div id="game"></div>
    <div id="overlay"><div class="panel" id="panel"></div></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing tests**

`apps/phaser/test/entities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BLOCK_LENGTH_M } from '@paperboy/game-core';
import {
  PX_PER_M, fromBodyX, fromBodyY, project, toBodyX, toBodyY,
} from '../src/iso.js';
import { BlockStreamer, surfaceCrr } from '../src/logic/entities.js';

describe('world-space body coordinates', () => {
  it('round-trips distance through the body x axis', () => {
    expect(fromBodyX(toBodyX(137.5))).toBeCloseTo(137.5, 6);
  });

  it('round-trips lateral through the body y axis', () => {
    expect(fromBodyY(toBodyY(4.25))).toBeCloseTo(4.25, 6);
  });

  it('scales by the documented pixels-per-metre', () => {
    expect(toBodyX(10)).toBe(10 * PX_PER_M);
  });
});

describe('project', () => {
  it('puts the camera point at the origin', () => {
    expect(project(100, 0, 0, 100)).toEqual({ x: 0, y: 0 });
  });

  it('moves up and right as distance increases', () => {
    const near = project(100, 4, 0, 100);
    const far = project(140, 4, 0, 100);
    expect(far.x).toBeGreaterThan(near.x);
    expect(far.y).toBeLessThan(near.y);
  });

  it('raises an object as its height grows', () => {
    expect(project(100, 4, 2, 100).y).toBeLessThan(project(100, 4, 0, 100).y);
  });
});

describe('BlockStreamer', () => {
  it('emits entities for the road ahead on first update', () => {
    const s = new BlockStreamer(42);
    const { added } = s.update(0);
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((e) => e.kind === 'house')).toBe(true);
  });

  it('emits nothing new when the rider has not moved', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    expect(s.update(0).added).toHaveLength(0);
  });

  it('emits more entities as the rider advances', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    expect(s.update(BLOCK_LENGTH_M * 4).added.length).toBeGreaterThan(0);
  });

  it('reports removals for entities left behind', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    const { removed } = s.update(BLOCK_LENGTH_M * 8);
    expect(removed.length).toBeGreaterThan(0);
  });

  it('never emits the same id twice', () => {
    const s = new BlockStreamer(42);
    const seen = new Set<string>();
    for (let d = 0; d < BLOCK_LENGTH_M * 20; d += 40) {
      for (const e of s.update(d).added) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
    }
  });

  it('generates the same route as any other streamer on the same seed', () => {
    const a = new BlockStreamer(42);
    const b = new BlockStreamer(42);
    expect(a.update(500).added.map((e) => e.id))
      .toEqual(b.update(500).added.map((e) => e.id));
  });

  it('reports the grade of the block the rider is on', () => {
    const s = new BlockStreamer(42);
    s.update(0);
    expect(s.gradeAt(10)).toBe(s.blocks[0]!.gradePercent);
    expect(s.gradeAt(BLOCK_LENGTH_M + 10)).toBe(s.blocks[1]!.gradePercent);
  });
});

describe('surfaceCrr', () => {
  it('is slow on the lawn and fast on the sidewalk', () => {
    expect(surfaceCrr(2.2)).toBeGreaterThan(surfaceCrr(3.8));
  });

  it('penalises the curb', () => {
    expect(surfaceCrr(5.0)).toBeGreaterThan(surfaceCrr(7.0));
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run apps/phaser/test/entities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the projection**

`apps/phaser/src/iso.ts`:

```ts
export const PX_PER_M = 24;

export interface IsoConfig {
  tileW: number;
  tileH: number;
  heightScale: number;
}

export const PHASER_ISO: IsoConfig = {
  tileW: 26,
  tileH: 13,
  heightScale: 18,
};

export function project(
  distance: number,
  lateral: number,
  height: number,
  cameraDistance: number,
  cfg: IsoConfig = PHASER_ISO,
): { x: number; y: number } {
  const a = lateral;
  const b = cameraDistance - distance;
  return {
    x: (a - b) * (cfg.tileW / 2),
    y: (a + b) * (cfg.tileH / 2) - height * cfg.heightScale,
  };
}

export const toBodyX = (distance: number): number => distance * PX_PER_M;
export const toBodyY = (lateral: number): number => lateral * PX_PER_M;
export const fromBodyX = (x: number): number => x / PX_PER_M;
export const fromBodyY = (y: number): number => y / PX_PER_M;
```

- [ ] **Step 5: Implement the streamer**

`apps/phaser/src/logic/entities.ts`:

```ts
import { BLOCK_LENGTH_M, generateBlock } from '@paperboy/game-core';
import type { BlockSpec } from '@paperboy/game-core';

export const STREAM_AHEAD_M = 400;
export const STREAM_BEHIND_M = 200;

export interface EntityRecord {
  id: string;
  kind: 'house' | 'hazard' | 'stack';
  distance: number;
  lateral: number;
  width: number;
  spec: unknown;
}

export interface StreamResult {
  added: EntityRecord[];
  removed: string[];
}

/**
 * Emits create/destroy deltas rather than a world snapshot, because Phaser
 * wants to own its game objects. Version A pulls a fresh array each frame;
 * this pushes changes. Same route, different shape.
 */
export class BlockStreamer {
  readonly blocks: BlockSpec[] = [];
  #seed: number;
  #nextIndex = 0;
  #live = new Map<string, EntityRecord>();

  constructor(seed: number) {
    this.#seed = seed;
  }

  update(riderDistance: number): StreamResult {
    const added: EntityRecord[] = [];
    const needUntil = riderDistance + STREAM_AHEAD_M;

    while (this.#nextIndex * BLOCK_LENGTH_M < needUntil) {
      const block = generateBlock(this.#seed, this.#nextIndex);
      this.blocks.push(block);
      this.#nextIndex += 1;

      for (const h of block.houses) {
        added.push({
          id: h.id, kind: 'house', distance: h.distance,
          lateral: 0.75, width: 1.4, spec: h,
        });
      }
      for (const z of block.hazards) {
        added.push({
          id: z.id, kind: 'hazard', distance: z.distance,
          lateral: z.lateral, width: z.width, spec: z,
        });
      }
      for (const s of block.stacks) {
        added.push({
          id: s.id, kind: 'stack', distance: s.distance,
          lateral: s.lateral, width: 0.6, spec: s,
        });
      }
    }

    for (const record of added) this.#live.set(record.id, record);

    const cutoff = riderDistance - STREAM_BEHIND_M;
    const removed: string[] = [];
    for (const [id, record] of this.#live) {
      if (record.distance < cutoff) {
        removed.push(id);
        this.#live.delete(id);
      }
    }

    const keepFrom = cutoff - BLOCK_LENGTH_M;
    while (
      this.blocks.length > 0 &&
      this.blocks[0]!.startDistance + BLOCK_LENGTH_M < keepFrom
    ) {
      this.blocks.shift();
    }

    return { added, removed };
  }

  gradeAt(distance: number): number {
    const block = this.blocks.find(
      (b) => distance >= b.startDistance && distance < b.startDistance + b.length,
    );
    return block?.gradePercent ?? 0;
  }
}

export function surfaceCrr(lateral: number): number {
  if (lateral < 3.0) return 0.02;
  if (lateral < 4.5) return 0.005;
  if (lateral < 5.5) return 0.014;
  return 0.005;
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run apps/phaser/test/entities.test.ts`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add apps/phaser package.json
git commit -m "feat(phaser): scaffold app with world-space entity streaming"
```

---

### Task 20: The Phaser run model

Version A keeps one mutable `WorldState` and a `stepWorld` function over it. Version B keeps a `PaperboyRun` object that owns its state, emits stream deltas, and — crucially — does **not** detect hazard collisions itself. Collision is Arcade's job in Task 21, so the run exposes a `crash()` the scene calls. That inversion is the point of the comparison.

Landing resolution still comes from `@paperboy/game-core`, so both versions score a given throw identically.

**Files:**
- Create: `apps/phaser/src/logic/run.ts`
- Test: `apps/phaser/test/run.test.ts`

**Interfaces:**
- Consumes: `BlockStreamer`, `surfaceCrr` (Task 19); `classifyLanding`, `applyScoreEvent`, `INITIAL_SCORE_STATE`, `BLOCK_LENGTH_M`, `RIDABLE_MIN`, `RIDABLE_MAX`, `RunResult`, `ScoreEvent`, `HouseSpec`, `StackSpec` from `@paperboy/game-core`; `stepPhysics`, `clampGrade`, `RiderProfile`, `SimulationParams` from `@paperboy/trainer`.
- Produces:

```ts
export interface RunInput { steer: number; throwPaper: boolean }
export interface HouseRuntime {
  spec: HouseSpec; delivered: boolean; windowBroken: boolean; resolved: boolean;
}
export interface PaperRuntime {
  id: number; distance: number; lateral: number; height: number;
  vDistance: number; vLateral: number; vHeight: number;
}
export interface UpdateOutcome { events: ScoreEvent[]; stream: StreamResult }
export class PaperboyRun {
  constructor(seed: number, profile: RiderProfile);
  readonly seed: number;
  readonly streamer: BlockStreamer;
  readonly rider: {
    distance: number; lateral: number; speed: number;
    papers: number; lives: number; invulnerableUntil: number;
  };
  readonly papers: PaperRuntime[];
  readonly houses: Map<string, HouseRuntime>;
  score: ScoreState;
  elapsed: number;
  kilojoules: number;
  gameOver: boolean;
  paused: boolean;
  powerTarget: number;
  powerCurrent: number;
  get invulnerable(): boolean;
  setPower(watts: number | null): void;
  throwPaper(): boolean;
  crash(): void;
  update(dt: number, input: RunInput): UpdateOutcome;
  simulation(): SimulationParams;
  result(): RunResult;
}
export const START_PAPERS = 20;
export const MAX_PAPERS = 30;
export const STACK_PAPERS = 10;
export const START_LIVES = 3;
export const STEER_RATE = 4.5;
export const INVULNERABLE_S = 1.5;
export const POWER_TAU_S = 0.25;
```

- [ ] **Step 1: Write the failing tests**

`apps/phaser/test/run.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import { BLOCK_LENGTH_M, RIDABLE_MAX, RIDABLE_MIN } from '@paperboy/game-core';
import {
  MAX_PAPERS, PaperboyRun, START_LIVES, START_PAPERS,
} from '../src/logic/run.js';

const still = { steer: 0, throwPaper: false };
const make = (seed = 42) => new PaperboyRun(seed, DEFAULT_RIDER);

describe('PaperboyRun setup', () => {
  it('starts stopped with a full bundle and full lives', () => {
    const r = make();
    expect(r.rider.papers).toBe(START_PAPERS);
    expect(r.rider.lives).toBe(START_LIVES);
    expect(r.rider.speed).toBe(0);
  });

  it('streams the first blocks on its first update', () => {
    const r = make();
    expect(r.update(1 / 60, still).stream.added.length).toBeGreaterThan(0);
  });

  it('registers streamed houses as runtime state', () => {
    const r = make();
    r.update(1 / 60, still);
    expect(r.houses.size).toBeGreaterThan(0);
  });
});

describe('riding', () => {
  it('accelerates under power', () => {
    const r = make();
    r.setPower(250);
    for (let i = 0; i < 300; i++) r.update(1 / 60, still);
    expect(r.rider.speed).toBeGreaterThan(3);
  });

  it('eases power rather than stepping to it', () => {
    const r = make();
    r.setPower(300);
    r.update(1 / 60, still);
    expect(r.powerCurrent).toBeLessThan(300);
    expect(r.powerCurrent).toBeGreaterThan(0);
  });

  it('clamps steering to the ridable band', () => {
    const r = make();
    for (let i = 0; i < 200; i++) r.update(1 / 60, { steer: -1, throwPaper: false });
    expect(r.rider.lateral).toBeGreaterThanOrEqual(RIDABLE_MIN);
    for (let i = 0; i < 400; i++) r.update(1 / 60, { steer: 1, throwPaper: false });
    expect(r.rider.lateral).toBeLessThanOrEqual(RIDABLE_MAX);
  });

  it('does nothing while paused', () => {
    const r = make();
    r.setPower(300);
    r.paused = true;
    r.update(1, still);
    expect(r.rider.distance).toBe(0);
  });
});

describe('throwing', () => {
  it('spends a paper and launches it toward the houses', () => {
    const r = make();
    r.update(1 / 60, still);
    expect(r.throwPaper()).toBe(true);
    expect(r.rider.papers).toBe(START_PAPERS - 1);
    expect(r.papers[0]!.vLateral).toBeLessThan(0);
  });

  it('refuses to throw an empty bundle', () => {
    const r = make();
    r.rider.papers = 0;
    expect(r.throwPaper()).toBe(false);
  });

  it('scores a mailbox delivery using the shared rule', () => {
    const r = make();
    r.update(1 / 60, still);
    const house = [...r.houses.values()].find((h) => h.spec.subscriber)!;
    r.rider.distance = house.spec.distance;
    r.throwPaper();
    const p = r.papers[0]!;
    p.distance = house.spec.distance;
    p.lateral = house.spec.mailboxLateral;
    p.height = 0.01;
    p.vHeight = -5;
    p.vLateral = 0;
    p.vDistance = 0;

    const { events } = r.update(1 / 30, still);
    expect(events).toContainEqual({ type: 'mailbox' });
    expect(house.delivered).toBe(true);
  });

  it('never exceeds the paper cap when collecting a stack', () => {
    const r = make();
    r.update(1 / 60, still);
    r.rider.papers = MAX_PAPERS - 1;
    const stack = r.streamer.blocks[0]!.stacks[0];
    if (stack !== undefined) {
      r.rider.distance = stack.distance;
      r.rider.lateral = stack.lateral;
      r.update(1 / 60, still);
      expect(r.rider.papers).toBeLessThanOrEqual(MAX_PAPERS);
    }
  });
});

describe('crashing', () => {
  it('is driven from outside, since Arcade owns collision', () => {
    const r = make();
    r.rider.speed = 10;
    r.crash();
    expect(r.rider.lives).toBe(START_LIVES - 1);
    expect(r.rider.speed).toBeLessThan(2);
    expect(r.invulnerable).toBe(true);
  });

  it('breaks the combo', () => {
    const r = make();
    r.score = { ...r.score, multiplier: 5, streak: 4 };
    r.crash();
    expect(r.score.multiplier).toBe(1);
  });

  it('ignores a crash while invulnerable', () => {
    const r = make();
    r.crash();
    r.crash();
    expect(r.rider.lives).toBe(START_LIVES - 1);
  });

  it('ends the run when the last life goes', () => {
    const r = make();
    for (let i = 0; i < START_LIVES; i++) {
      r.rider.invulnerableUntil = 0;
      r.crash();
    }
    expect(r.gameOver).toBe(true);
  });
});

describe('progression', () => {
  it('emits a miss for a subscriber ridden past undelivered', () => {
    const r = make();
    r.update(1 / 60, still);
    const house = [...r.houses.values()].find((h) => h.spec.subscriber)!;
    r.rider.distance = house.spec.distance + 20;
    const { events } = r.update(1 / 60, still);
    expect(events).toContainEqual({ type: 'houseMissed' });
  });

  it('awards a block bonus when every subscriber on it was served', () => {
    const r = make();
    r.update(1 / 60, still);
    for (const h of r.houses.values()) h.delivered = true;
    r.rider.distance = BLOCK_LENGTH_M + 1;
    const { events } = r.update(1 / 60, still);
    expect(events).toContainEqual({ type: 'blockCleared' });
  });
});

describe('trainer feedback', () => {
  it('reports the grade of the current block within the trainer clamp', () => {
    const r = make();
    r.update(1 / 60, still);
    const sim = r.simulation();
    expect(sim.grade).toBe(r.streamer.blocks[0]!.gradePercent);
    expect(Math.abs(sim.grade)).toBeLessThanOrEqual(8);
  });

  it('reports a higher rolling resistance on the lawn than the sidewalk', () => {
    const r = make();
    r.update(1 / 60, still);
    r.rider.lateral = 3.8;
    const road = r.simulation().crr;
    r.rider.lateral = 2.2;
    expect(r.simulation().crr).toBeGreaterThan(road);
  });
});

describe('result', () => {
  it('summarises the ride', () => {
    const r = make();
    r.setPower(210);
    for (let i = 0; i < 1200; i++) r.update(1 / 60, still);
    const out = r.result();
    expect(out.seed).toBe(42);
    expect(out.distanceM).toBeGreaterThan(0);
    expect(out.avgPower).toBeGreaterThan(100);
  });
});

describe('determinism', () => {
  it('replays identically for a fixed input sequence', () => {
    const play = () => {
      const r = make(7);
      r.setPower(220);
      for (let i = 0; i < 1800; i++) {
        r.update(1 / 60, {
          steer: i % 120 < 60 ? -1 : 1,
          throwPaper: i % 30 === 0,
        });
      }
      return { d: r.rider.distance, s: r.score.score };
    };
    expect(play()).toEqual(play());
  });

  it('generates the same street as Version A does for the same seed', () => {
    const r = make(42);
    r.update(1 / 60, still);
    // Both apps call generateBlock(seed, index) from the shared package,
    // so house ids must match exactly.
    expect([...r.houses.keys()].some((id) => id.startsWith('h-0-'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run apps/phaser/test/run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the run model**

`apps/phaser/src/logic/run.ts`:

```ts
import {
  BLOCK_LENGTH_M, INITIAL_SCORE_STATE, RIDABLE_MAX, RIDABLE_MIN,
  applyScoreEvent, classifyLanding,
} from '@paperboy/game-core';
import type {
  HouseSpec, RunResult, ScoreEvent, ScoreState, StackSpec,
} from '@paperboy/game-core';
import { clampGrade, stepPhysics } from '@paperboy/trainer';
import type { RiderProfile, SimulationParams } from '@paperboy/trainer';
import { BlockStreamer, surfaceCrr } from './entities.js';
import type { StreamResult } from './entities.js';

export const START_PAPERS = 20;
export const MAX_PAPERS = 30;
export const STACK_PAPERS = 10;
export const START_LIVES = 3;
export const STEER_RATE = 4.5;
export const INVULNERABLE_S = 1.5;
export const POWER_TAU_S = 0.25;
export const MAX_PLAUSIBLE_WATTS = 2000;
export const HOUSE_RESOLVE_MARGIN_M = 8;
export const THROW_HEIGHT = 1.1;
export const THROW_V_LATERAL = -7;
export const THROW_V_UP = 3.2;
export const GRAVITY = 9.8;
export const STACK_PICKUP_DISTANCE_M = 1.5;
export const STACK_PICKUP_LATERAL_M = 1.0;

export interface RunInput {
  steer: number;
  throwPaper: boolean;
}

export interface HouseRuntime {
  spec: HouseSpec;
  delivered: boolean;
  windowBroken: boolean;
  resolved: boolean;
}

export interface StackRuntime {
  spec: StackSpec;
  taken: boolean;
}

export interface PaperRuntime {
  id: number;
  distance: number;
  lateral: number;
  height: number;
  vDistance: number;
  vLateral: number;
  vHeight: number;
}

export interface UpdateOutcome {
  events: ScoreEvent[];
  stream: StreamResult;
}

export class PaperboyRun {
  readonly seed: number;
  readonly streamer: BlockStreamer;
  readonly papers: PaperRuntime[] = [];
  readonly houses = new Map<string, HouseRuntime>();
  readonly stacks = new Map<string, StackRuntime>();

  readonly rider = {
    distance: 0,
    lateral: 3.8,
    speed: 0,
    papers: START_PAPERS,
    lives: START_LIVES,
    invulnerableUntil: 0,
  };

  score: ScoreState = { ...INITIAL_SCORE_STATE };
  elapsed = 0;
  kilojoules = 0;
  gameOver = false;
  paused = false;
  powerTarget = 0;
  powerCurrent = 0;

  #profile: RiderProfile;
  #blocksCleared = 0;
  #nextPaperId = 1;

  constructor(seed: number, profile: RiderProfile) {
    this.seed = seed;
    this.streamer = new BlockStreamer(seed);
    this.#profile = profile;
  }

  get invulnerable(): boolean {
    return this.elapsed < this.rider.invulnerableUntil;
  }

  setPower(watts: number | null): void {
    if (watts === null || !Number.isFinite(watts) || watts < 0) {
      this.powerTarget = 0;
      return;
    }
    this.powerTarget = Math.min(MAX_PLAUSIBLE_WATTS, watts);
  }

  throwPaper(): boolean {
    if (this.rider.papers <= 0 || this.gameOver) return false;
    this.rider.papers -= 1;
    this.papers.push({
      id: this.#nextPaperId++,
      distance: this.rider.distance,
      lateral: this.rider.lateral,
      height: THROW_HEIGHT,
      vDistance: this.rider.speed * 0.55,
      vLateral: THROW_V_LATERAL,
      vHeight: THROW_V_UP,
    });
    return true;
  }

  /** Called by the scene when Arcade reports an overlap. */
  crash(): void {
    if (this.gameOver || this.invulnerable) return;
    this.rider.lives -= 1;
    this.rider.speed *= 0.15;
    this.rider.invulnerableUntil = this.elapsed + INVULNERABLE_S;
    this.score = applyScoreEvent(this.score, { type: 'crash' });
    if (this.rider.lives <= 0) {
      this.rider.lives = 0;
      this.gameOver = true;
    }
  }

  update(dt: number, input: RunInput): UpdateOutcome {
    if (this.paused || this.gameOver) {
      return { events: [], stream: { added: [], removed: [] } };
    }

    const alpha = 1 - Math.exp(-dt / POWER_TAU_S);
    this.powerCurrent += (this.powerTarget - this.powerCurrent) * alpha;
    this.kilojoules += (this.powerCurrent * dt) / 1000;

    this.rider.lateral = Math.max(
      RIDABLE_MIN,
      Math.min(RIDABLE_MAX, this.rider.lateral + input.steer * STEER_RATE * dt),
    );

    const next = stepPhysics(
      { speed: this.rider.speed, distance: this.rider.distance },
      {
        powerWatts: this.powerCurrent,
        gradePercent: this.streamer.gradeAt(this.rider.distance),
        crr: surfaceCrr(this.rider.lateral),
        headwind: 0,
      },
      this.#profile,
      dt,
    );
    this.rider.speed = next.speed;
    this.rider.distance = next.distance;
    this.elapsed += dt;

    const stream = this.streamer.update(this.rider.distance);
    this.#absorb(stream);

    if (input.throwPaper) this.throwPaper();

    const events: ScoreEvent[] = [
      ...this.#updatePapers(dt),
      ...this.#resolvePassedHouses(),
      ...this.#resolveBlocks(),
    ];
    this.#collectStacks();

    for (const e of events) this.score = applyScoreEvent(this.score, e);
    return { events, stream };
  }

  simulation(): SimulationParams {
    return {
      grade: clampGrade(this.streamer.gradeAt(this.rider.distance)),
      headwind: 0,
      crr: surfaceCrr(this.rider.lateral),
      cw: 0.51,
    };
  }

  result(): RunResult {
    const seconds = this.elapsed;
    return {
      seed: this.seed,
      score: this.score.score,
      distanceM: Math.round(this.rider.distance),
      durationMs: Math.round(seconds * 1000),
      avgPower: seconds > 0 ? Math.round((this.kilojoules * 1000) / seconds) : 0,
      kilojoules: Math.round(this.kilojoules),
      papersDelivered: this.score.papersDelivered,
    };
  }

  #absorb(stream: StreamResult): void {
    for (const record of stream.added) {
      if (record.kind === 'house') {
        this.houses.set(record.id, {
          spec: record.spec as HouseSpec,
          delivered: false,
          windowBroken: false,
          resolved: false,
        });
      } else if (record.kind === 'stack') {
        this.stacks.set(record.id, {
          spec: record.spec as StackSpec,
          taken: false,
        });
      }
    }
    for (const id of stream.removed) {
      this.houses.delete(id);
      this.stacks.delete(id);
    }
  }

  #updatePapers(dt: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    let specs: HouseSpec[] | null = null;

    for (let i = this.papers.length - 1; i >= 0; i--) {
      const p = this.papers[i]!;
      p.vHeight -= GRAVITY * dt;
      p.distance += p.vDistance * dt;
      p.lateral += p.vLateral * dt;
      p.height += p.vHeight * dt;
      if (p.height > 0) continue;

      this.papers.splice(i, 1);
      specs ??= [...this.houses.values()].map((h) => h.spec);
      const outcome = classifyLanding(
        { distance: p.distance, lateral: p.lateral },
        specs,
      );

      if (outcome.band === 'street') continue;
      if (outcome.house === null || outcome.band === 'lawn') {
        events.push({ type: 'lawn' });
        continue;
      }

      const house = [...this.houses.values()].find(
        (h) => h.spec === outcome.house,
      );
      if (house === undefined) {
        events.push({ type: 'lawn' });
        continue;
      }

      if (outcome.band === 'window') {
        if (house.windowBroken) continue;
        house.windowBroken = true;
        if (house.spec.subscriber) {
          house.resolved = true;
          events.push({ type: 'windowSubscriber' });
        } else {
          events.push({ type: 'windowNonSubscriber' });
        }
        continue;
      }

      if (!house.spec.subscriber || house.delivered) continue;
      house.delivered = true;
      house.resolved = true;
      events.push({ type: outcome.band === 'mailbox' ? 'mailbox' : 'porch' });
    }
    return events;
  }

  #resolvePassedHouses(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    for (const house of this.houses.values()) {
      if (house.resolved) continue;
      if (house.spec.distance > this.rider.distance - HOUSE_RESOLVE_MARGIN_M) {
        continue;
      }
      house.resolved = true;
      if (house.spec.subscriber && !house.delivered) {
        events.push({ type: 'houseMissed' });
      }
    }
    return events;
  }

  #resolveBlocks(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    while (this.rider.distance > (this.#blocksCleared + 1) * BLOCK_LENGTH_M) {
      const index = this.#blocksCleared;
      const subs = [...this.houses.values()].filter(
        (h) =>
          h.spec.subscriber &&
          Math.floor(h.spec.distance / BLOCK_LENGTH_M) === index,
      );
      if (subs.length > 0 && subs.every((h) => h.delivered)) {
        events.push({ type: 'blockCleared' });
      }
      this.#blocksCleared += 1;
    }
    return events;
  }

  #collectStacks(): void {
    for (const stack of this.stacks.values()) {
      if (stack.taken) continue;
      if (
        Math.abs(stack.spec.distance - this.rider.distance) >
        STACK_PICKUP_DISTANCE_M
      ) continue;
      if (
        Math.abs(stack.spec.lateral - this.rider.lateral) >
        STACK_PICKUP_LATERAL_M
      ) continue;
      stack.taken = true;
      this.rider.papers = Math.min(MAX_PAPERS, this.rider.papers + STACK_PAPERS);
    }
  }
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run apps/phaser/test/run.test.ts && npm run typecheck`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add apps/phaser/src/logic/run.ts apps/phaser/test/run.test.ts
git commit -m "feat(phaser): add run model with externally-driven collisions"
```

---

### Task 21: Phaser scenes, HUD and wiring

Phaser scenes cannot be exercised headlessly in a useful way, so this task's verification is manual — which is itself a finding worth recording for Task 22.

**Files:**
- Create: `apps/phaser/src/views.ts`
- Create: `apps/phaser/src/scenes/StreetScene.ts`
- Create: `apps/phaser/src/scenes/HudScene.ts`
- Create: `apps/phaser/src/main.ts`

**Interfaces:**
- Consumes: `PaperboyRun`, `RunInput` (Task 20); `project`, `toBodyX`, `toBodyY`, `PX_PER_M` (Task 19); trainer sources and `@paperboy/game-core` persistence.
- Produces:

```ts
// views.ts
export interface ViewPalette { /* same colour roles as Version A */ }
export const COLOURS: Record<string, number>;   // Phaser wants 0xRRGGBB numbers
export function drawHouseView(
  g: Phaser.GameObjects.Graphics, spec: HouseSpec,
): void;
export function drawHazardView(
  g: Phaser.GameObjects.Graphics, spec: HazardSpec,
): void;
export function drawStackView(g: Phaser.GameObjects.Graphics): void;
export function drawRiderView(g: Phaser.GameObjects.Graphics): void;
export function drawPaperView(g: Phaser.GameObjects.Graphics): void;

// scenes/StreetScene.ts
export class StreetScene extends Phaser.Scene {
  constructor();
  startRun(seed: number): void;
  run: PaperboyRun | null;
  setInput(input: RunInput): void;
}

Pause and the panic key are handled in `main.ts` against `run.paused` and the
trainer source directly, not routed through `setInput` — the scene only needs
steering and throwing.
```

- [ ] **Step 1: Write the entity views**

`apps/phaser/src/views.ts`:

```ts
import type Phaser from 'phaser';
import type { HazardSpec, HouseSpec } from '@paperboy/game-core';
import { PHASER_ISO } from './iso.js';

export const COLOURS = {
  road: 0x33384a,
  roadLine: 0x6d7490,
  sidewalk: 0xb9b2a6,
  lawn: 0x5f7a5a,
  curb: 0x8d8779,
  paper: 0xf2ead9,
  rider: 0xe5533d,
  subscriberGlow: 0xffd98a,
  mailboxSubscriber: 0x4f9dd6,
  mailboxPlain: 0x6b6b6b,
  wallWarm: 0xc47a4e,
  wallCool: 0x7d6b53,
  roof: 0x4a3b33,
  car: 0xc9d1e8,
  dog: 0x8a6b4a,
  sprinkler: 0x7fc4d6,
  lawnmower: 0x7ba05b,
  drain: 0x2a2e3d,
  bin: 0x4c5a4a,
  skater: 0xd98d3f,
} as const;

const shade = (colour: number, amount: number): number => {
  const r = Math.round(((colour >> 16) & 255) * amount);
  const g = Math.round(((colour >> 8) & 255) * amount);
  const b = Math.round((colour & 255) * amount);
  return (r << 16) | (g << 8) | b;
};

/**
 * An isometric box drawn into a Graphics, centred on the container origin.
 * Unlike Version A this is drawn ONCE at creation and then only moved, which
 * is the whole reason Version B uses containers rather than immediate mode.
 */
function box(
  g: Phaser.GameObjects.Graphics,
  depthM: number, widthM: number, heightM: number, colour: number,
): void {
  const { tileW, tileH, heightScale } = PHASER_ISO;
  const dx = (depthM * tileW) / 2;
  const dy = (depthM * tileH) / 2;
  const lx = (widthM * tileW) / 2;
  const ly = (widthM * tileH) / 2;
  const h = heightM * heightScale;

  // Face toward the road.
  g.fillStyle(shade(colour, 0.72));
  g.fillPoints(
    [
      { x: -dx + lx, y: dy + ly }, { x: dx + lx, y: -dy + ly },
      { x: dx + lx, y: -dy + ly - h }, { x: -dx + lx, y: dy + ly - h },
    ] as Phaser.Types.Math.Vector2Like[],
    true,
  );

  // Face toward the rider.
  g.fillStyle(shade(colour, 0.56));
  g.fillPoints(
    [
      { x: -dx - lx, y: dy - ly }, { x: -dx + lx, y: dy + ly },
      { x: -dx + lx, y: dy + ly - h }, { x: -dx - lx, y: dy - ly - h },
    ] as Phaser.Types.Math.Vector2Like[],
    true,
  );

  // Top.
  g.fillStyle(colour);
  g.fillPoints(
    [
      { x: -dx - lx, y: dy - ly - h }, { x: dx - lx, y: -dy - ly - h },
      { x: dx + lx, y: -dy + ly - h }, { x: -dx + lx, y: dy + ly - h },
    ] as Phaser.Types.Math.Vector2Like[],
    true,
  );
}

export function drawHouseView(
  g: Phaser.GameObjects.Graphics, spec: HouseSpec,
): void {
  box(g, 9, 1.4, 3.2, spec.subscriber ? COLOURS.wallWarm : COLOURS.wallCool);
  g.fillStyle(spec.subscriber ? COLOURS.subscriberGlow : 0x3a4055);
  g.fillRect(-8, -46, 12, 14);
}

export function drawHazardView(
  g: Phaser.GameObjects.Graphics, spec: HazardSpec,
): void {
  const colour = (COLOURS as Record<string, number>)[spec.kind] ?? 0x999999;
  box(
    g,
    spec.kind === 'car' ? 4 : 1,
    spec.width,
    spec.kind === 'drain' ? 0.1 : 1.2,
    colour,
  );
}

export function drawStackView(g: Phaser.GameObjects.Graphics): void {
  box(g, 0.6, 0.6, 0.4, COLOURS.paper);
}

export function drawRiderView(g: Phaser.GameObjects.Graphics): void {
  box(g, 1.5, 0.6, 1.7, COLOURS.rider);
}

export function drawPaperView(g: Phaser.GameObjects.Graphics): void {
  box(g, 0.3, 0.3, 0.18, COLOURS.paper);
}
```

- [ ] **Step 2: Write the street scene**

`apps/phaser/src/scenes/StreetScene.ts`:

```ts
import Phaser from 'phaser';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import type { HazardSpec, HouseSpec } from '@paperboy/game-core';
import { PX_PER_M, project, toBodyX, toBodyY } from '../iso.js';
import { PaperboyRun } from '../logic/run.js';
import type { RunInput } from '../logic/run.js';
import {
  COLOURS, drawHazardView, drawHouseView, drawPaperView, drawRiderView,
  drawStackView,
} from '../views.js';

interface HazardView {
  container: Phaser.GameObjects.Container;
  zone: Phaser.GameObjects.Zone;
  spec: HazardSpec;
  distance: number;
  lateral: number;
}

export class StreetScene extends Phaser.Scene {
  run: PaperboyRun | null = null;

  #ground!: Phaser.GameObjects.Graphics;
  #rider!: Phaser.GameObjects.Container;
  #riderZone!: Phaser.GameObjects.Zone;
  #hazards = new Map<string, HazardView>();
  #statics = new Map<string, Phaser.GameObjects.Container>();
  #papers = new Map<number, Phaser.GameObjects.Container>();
  #input: RunInput = { steer: 0, throwPaper: false };

  constructor() {
    super('street');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1b1f3b');
    this.#ground = this.add.graphics().setDepth(-1e9);

    const riderGraphics = this.add.graphics();
    drawRiderView(riderGraphics);
    this.#rider = this.add.container(0, 0, [riderGraphics]);

    this.#riderZone = this.add.zone(0, 0, 0.8 * PX_PER_M, 1.5 * PX_PER_M);
    this.physics.add.existing(this.#riderZone);
  }

  setInput(input: RunInput): void {
    this.#input = input;
  }

  startRun(seed: number): void {
    for (const v of this.#hazards.values()) {
      v.container.destroy();
      v.zone.destroy();
    }
    this.#hazards.clear();
    this.#statics.forEach((c) => c.destroy());
    this.#statics.clear();
    this.#papers.forEach((c) => c.destroy());
    this.#papers.clear();
    this.run = new PaperboyRun(seed, DEFAULT_RIDER);
  }

  override update(_time: number, deltaMs: number): void {
    const run = this.run;
    if (run === null || run.gameOver) return;

    const dt = Math.min(0.05, deltaMs / 1000);
    const { stream } = run.update(dt, this.#input);
    this.#input = { steer: this.#input.steer, throwPaper: false };

    for (const record of stream.added) {
      if (record.kind === 'hazard') this.#addHazard(record.id, record.spec as HazardSpec);
      else if (record.kind === 'house') this.#addHouse(record.id, record.spec as HouseSpec);
      else this.#addStack(record.id, record.distance, record.lateral);
    }
    for (const id of stream.removed) {
      const hazard = this.#hazards.get(id);
      if (hazard !== undefined) {
        hazard.container.destroy();
        hazard.zone.destroy();
        this.#hazards.delete(id);
      }
      this.#statics.get(id)?.destroy();
      this.#statics.delete(id);
    }

    this.#moveHazards(run);
    this.#syncPapers(run);
    this.#drawGround(run);
    this.#syncPositions(run);
    this.#checkCollisions(run);
  }

  #place(
    container: Phaser.GameObjects.Container,
    distance: number, lateral: number, height: number, cameraDistance: number,
  ): void {
    const p = project(distance, lateral, height, cameraDistance);
    container.setPosition(
      this.scale.width * 0.34 + p.x,
      this.scale.height * 0.62 + p.y,
    );
    // Phaser draws higher depth last, and larger (lateral - distance) is
    // nearer the viewer, so this is the whole painter's sort.
    container.setDepth(lateral - distance);
  }

  #addHouse(id: string, spec: HouseSpec): void {
    const g = this.add.graphics();
    drawHouseView(g, spec);
    const container = this.add.container(0, 0, [g]);
    container.setData('distance', spec.distance);
    container.setData('lateral', 0.75);
    this.#statics.set(id, container);
  }

  #addStack(id: string, distance: number, lateral: number): void {
    const g = this.add.graphics();
    drawStackView(g);
    const container = this.add.container(0, 0, [g]);
    container.setData('distance', distance);
    container.setData('lateral', lateral);
    this.#statics.set(id, container);
  }

  #addHazard(id: string, spec: HazardSpec): void {
    const g = this.add.graphics();
    drawHazardView(g, spec);
    const container = this.add.container(0, 0, [g]);

    const zone = this.add.zone(
      toBodyX(spec.distance),
      toBodyY(spec.lateral),
      (spec.kind === 'car' ? 4 : 1) * PX_PER_M,
      spec.width * PX_PER_M,
    );
    this.physics.add.existing(zone);

    this.#hazards.set(id, {
      container, zone, spec,
      distance: spec.distance,
      lateral: spec.lateral,
    });
  }

  #moveHazards(run: PaperboyRun): void {
    for (const v of this.#hazards.values()) {
      if (!v.spec.moving) continue;
      if (v.spec.kind === 'car') {
        v.distance -= v.spec.speed * (this.game.loop.delta / 1000);
      } else {
        const t = run.elapsed + v.spec.phase * 10;
        v.lateral = v.spec.lateral + Math.sin(t * 0.8) * 0.8;
        v.distance = v.spec.distance + Math.sin(t * 0.4) * 2;
      }
      v.zone.setPosition(toBodyX(v.distance), toBodyY(v.lateral));
    }
  }

  #syncPapers(run: PaperboyRun): void {
    const live = new Set(run.papers.map((p) => p.id));
    for (const [id, container] of this.#papers) {
      if (!live.has(id)) {
        container.destroy();
        this.#papers.delete(id);
      }
    }
    for (const p of run.papers) {
      if (this.#papers.has(p.id)) continue;
      const g = this.add.graphics();
      drawPaperView(g);
      this.#papers.set(p.id, this.add.container(0, 0, [g]));
    }
  }

  #drawGround(run: PaperboyRun): void {
    const g = this.#ground;
    g.clear();
    const cam = run.rider.distance;
    const from = cam - 80;
    const to = cam + 280;

    const band = (l0: number, l1: number, colour: number) => {
      const a = project(from, l0, 0, cam);
      const b = project(to, l0, 0, cam);
      const c = project(to, l1, 0, cam);
      const d = project(from, l1, 0, cam);
      const ox = this.scale.width * 0.34;
      const oy = this.scale.height * 0.62;
      g.fillStyle(colour);
      g.fillPoints(
        [a, b, c, d].map((p) => ({ x: ox + p.x, y: oy + p.y })) as
          Phaser.Types.Math.Vector2Like[],
        true,
      );
    };

    band(1.5, 3.0, COLOURS.lawn);
    band(3.0, 4.5, COLOURS.sidewalk);
    band(4.5, 5.5, COLOURS.curb);
    band(5.5, 10.0, COLOURS.road);
  }

  #syncPositions(run: PaperboyRun): void {
    const cam = run.rider.distance;

    for (const container of this.#statics.values()) {
      this.#place(
        container,
        container.getData('distance') as number,
        container.getData('lateral') as number,
        0, cam,
      );
    }
    for (const v of this.#hazards.values()) {
      this.#place(v.container, v.distance, v.lateral, 0, cam);
    }
    for (const p of run.papers) {
      const container = this.#papers.get(p.id);
      if (container !== undefined) {
        this.#place(container, p.distance, p.lateral, p.height, cam);
      }
    }

    this.#rider.setVisible(
      !run.invulnerable || Math.floor(run.elapsed * 12) % 2 === 0,
    );
    this.#place(this.#rider, run.rider.distance, run.rider.lateral, 0, cam);
    this.#riderZone.setPosition(
      toBodyX(run.rider.distance),
      toBodyY(run.rider.lateral),
    );
  }

  #checkCollisions(run: PaperboyRun): void {
    if (run.invulnerable) return;
    for (const v of this.#hazards.values()) {
      // An explicit Arcade query, rather than a registered collider, so the
      // check happens after this frame's positions are final.
      if (this.physics.world.overlap(this.#riderZone, v.zone)) {
        run.crash();
        return;
      }
    }
  }
}
```

- [ ] **Step 3: Write the HUD scene**

`apps/phaser/src/scenes/HudScene.ts`:

```ts
import Phaser from 'phaser';
import type { StreetScene } from './StreetScene.js';

export class HudScene extends Phaser.Scene {
  #score!: Phaser.GameObjects.Text;
  #multiplier!: Phaser.GameObjects.Text;
  #supplies!: Phaser.GameObjects.Text;
  #telemetry!: Phaser.GameObjects.Text;

  constructor() {
    super('hud');
  }

  create(): void {
    const mono = {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      color: '#f2ead9',
    };
    this.#score = this.add.text(20, 18, '0', { ...mono, fontSize: '20px' });
    this.#multiplier = this.add.text(20, 44, '', {
      ...mono, fontSize: '18px', color: '#ffd98a',
    });
    this.#supplies = this.add.text(160, 18, '', { ...mono, fontSize: '20px' });
    this.#telemetry = this.add
      .text(this.scale.width - 20, 18, '', { ...mono, fontSize: '14px' })
      .setOrigin(1, 0);
  }

  override update(): void {
    const street = this.scene.get('street') as StreetScene;
    const run = street.run;
    if (run === null) return;

    this.#score.setText(String(run.score.score));
    this.#multiplier.setText(run.score.multiplier > 1 ? `x${run.score.multiplier}` : '');
    this.#supplies.setText(
      `${run.rider.papers} papers  ${'♦'.repeat(run.rider.lives)}`,
    );
    this.#telemetry.setText(
      [
        `${(run.rider.speed * 3.6).toFixed(1)} km/h`,
        `${Math.round(run.powerCurrent)} W`,
        `${Math.round(run.rider.distance)} m`,
      ].join('\n'),
    );
  }
}
```

- [ ] **Step 4: Write the bootstrap**

`apps/phaser/src/main.ts`:

```ts
import Phaser from 'phaser';
import {
  dailySeed, loadStats, randomSeed, recordRun, seedFromString,
} from '@paperboy/game-core';
import {
  FtmsSource, KeyboardSource, createWebBluetoothConnector,
} from '@paperboy/trainer';
import type { TrainerSource } from '@paperboy/trainer';
import { HudScene } from './scenes/HudScene.js';
import { StreetScene } from './scenes/StreetScene.js';

const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const street = new StreetScene();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
  scene: [street, new HudScene()],
});

window.addEventListener('resize', () =>
  game.scale.resize(window.innerWidth, window.innerHeight),
);

let source: TrainerSource | null = null;
const held = new Set<string>();

window.addEventListener('keydown', (e) => {
  held.add(e.key);
  if (e.key === ' ') {
    street.setInput({ steer: readSteer(), throwPaper: true });
    e.preventDefault();
  }
  if (e.key === 'p' || e.key === 'P') {
    if (street.run !== null) street.run.paused = !street.run.paused;
  }
  if (e.key === 'Escape') {
    source?.setSimulation({ grade: 0, headwind: 0, crr: 0.004, cw: 0.51 });
    if (street.run !== null) street.run.paused = true;
  }
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());

const readSteer = (): number =>
  (held.has('ArrowLeft') ? -1 : 0) + (held.has('ArrowRight') ? 1 : 0);

setInterval(() => {
  const run = street.run;
  if (run === null) return;
  street.setInput({ steer: readSteer(), throwPaper: false });
  source?.setSimulation(run.simulation());
  if (run.gameOver) endRun();
}, 1000 / 30);

async function useSource(next: TrainerSource): Promise<void> {
  await source?.stop();
  source = next;
  next.onSample((s) => street.run?.setPower(s.power));
  await next.start();
}

function showMenu(): void {
  const stats = loadStats(window.localStorage);
  panel.innerHTML = `
    <h1>PAPERBOY <span class="dim">Phaser</span></h1>
    <p class="dim">Pedal to move. ← → steer, Space throws, P pauses,
      Esc kills resistance.</p>
    <p>High score <b>${stats.highScore}</b> · best ${stats.bestDistanceM} m</p>
    <p>
      <button id="connect">Connect KICKR</button>
      <button id="keyboard">Keyboard (hold W)</button>
    </p>
    <p>
      <input id="seed" placeholder="seed (optional)" />
      <button id="daily">Daily route</button>
      <button id="start">Ride</button>
    </p>
  `;
  overlay.hidden = false;

  const seedInput = document.getElementById('seed') as HTMLInputElement;
  document.getElementById('connect')!.addEventListener('click', () => {
    void useSource(new FtmsSource(createWebBluetoothConnector()));
  });
  document.getElementById('keyboard')!.addEventListener('click', () => {
    void useSource(new KeyboardSource());
  });
  document.getElementById('daily')!.addEventListener('click', () => {
    seedInput.value = String(dailySeed(new Date()));
  });
  document.getElementById('start')!.addEventListener('click', () => {
    const raw = seedInput.value.trim();
    const seed =
      raw === '' ? randomSeed()
      : /^\d+$/.test(raw) ? Number(raw)
      : seedFromString(raw);
    street.startRun(seed);
    overlay.hidden = true;
  });
}

function endRun(): void {
  const run = street.run;
  if (run === null) return;
  const result = run.result();
  const stats = recordRun(result, window.localStorage);
  street.run = null;

  panel.innerHTML = `
    <h1>${result.score}</h1>
    <p>${result.papersDelivered} papers · ${result.distanceM} m
      · ${Math.round(result.durationMs / 1000)} s</p>
    <p class="dim">${result.avgPower} W average · ${result.kilojoules} kJ</p>
    <p>All-time ${stats.highScore}</p>
    <p>
      <button id="again">Same route again</button>
      <button id="menu">Menu</button>
    </p>
  `;
  overlay.hidden = false;
  document.getElementById('again')!.addEventListener('click', () => {
    street.startRun(result.seed);
    overlay.hidden = true;
  });
  document.getElementById('menu')!.addEventListener('click', showMenu);
}

window.addEventListener('beforeunload', () => {
  source?.setSimulation({ grade: 0, headwind: 0, crr: 0.004, cw: 0.51 });
  void source?.stop();
});

showMenu();
```

- [ ] **Step 5: Verify in the browser**

Run: `npm --workspace @paperboy/phaser run dev` and open `http://localhost:5182`.

Check the same six behaviours listed in Task 18 Step 9, plus two specific to this version:

7. Houses, hazards and the rider occlude each other correctly as they pass — this exercises Phaser's depth sort rather than a hand-rolled one.
8. Riding for several minutes does not grow memory: `#statics` and `#hazards` should stay roughly constant, since streamed-out entities are destroyed.

Then compare against Version A on the same seed. The routes must be identical — same houses, same subscribers, same hazards. If they differ, something is consuming the shared RNG differently and that is a bug, not a variation.

- [ ] **Step 6: Commit**

```bash
git add apps/phaser
git commit -m "feat(phaser): add street and HUD scenes with Arcade collision"
```

---

### Task 22: The bake-off

Both versions exist. This task is where you decide what you learned.

**Files:**
- Create: `docs/superpowers/bake-off.md`

- [ ] **Step 1: Verify both versions play the same game**

Run each app on seed `paperboy`, ride the first three blocks, and confirm:

```
same houses in the same places       yes / no
same subscribers                     yes / no
same hazards                         yes / no
same score for the same throws       yes / no
```

Any "no" is a bug in the shared layer, not a difference between the versions. Fix it before judging anything else.

- [ ] **Step 2: Measure**

For each version record: bundle size (`npm --workspace <app> run build`, note the dist total), frame time under load (Chrome DevTools performance panel, ten seconds of riding, note the median), source lines outside the shared packages (`find apps/<name>/src -name '*.ts' | xargs wc -l`), and how much of that source is under test.

- [ ] **Step 3: Ride both and write it down**

`docs/superpowers/bake-off.md` should answer, in prose rather than a scorecard:

- Which one feels better to ride, and can you say *why* — is it frame pacing, the depth sort, the camera, or just the art?
- Where did Phaser save real work, and where did it get in the way? The honest candidates: it gave you a display list and depth sorting for free, and it made headless testing of anything scene-shaped impractical.
- Which codebase would you rather change next week?
- Did the isometric projection end up simpler in immediate mode or in a scene graph?

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/bake-off.md
git commit -m "docs: record the canvas versus Phaser bake-off findings"
```
