# Paperboy Trainer Game — Design

**Date:** 2026-09-10
**Status:** Approved for planning

## 1. Purpose

A browser game in the spirit of the 1985 arcade *Paperboy*, where forward speed comes
from pedalling a Wahoo KICKR smart trainer over Web Bluetooth, and the game pushes
resistance back to the trainer so terrain is felt in the legs.

Two independent renderers are built against one shared game specification, so their
feel and code can be compared directly.

### Success criteria

1. A rider on a KICKR v5/v6 or KICKR BIKE can open the page in Chrome, connect the
   trainer, and ride a scored route without touching a config file.
2. Pedalling harder measurably accelerates the rider; hills measurably increase
   pedalling effort at the cranks.
3. Both renderers are playable and hold 60 fps on a modern laptop.
4. The game is fully developable and testable with no trainer attached.
5. A run ends in a score worth beating, and beating it requires another ride.

### Non-goals

- Browsers other than Chrome and Edge. Safari and Firefox do not implement Web
  Bluetooth and are out of scope permanently.
- Multiplayer, networking, or accounts.
- Trainers other than FTMS-capable Wahoo hardware. The code should not actively
  prevent other FTMS trainers from working, but they are untested.
- ERG mode, structured workouts, or training-platform features.
- Native or mobile packaging.

## 2. Hardware and platform constraints

These are properties of the platform, not decisions, and the design must respect them.

- **Web Bluetooth is Chromium-only.** Chrome and Edge on macOS, Windows, Linux, and
  Android. No Safari, no Firefox, no iOS.
- **Secure context required.** The page must be served from `localhost` or over HTTPS.
- **User gesture required.** `navigator.bluetooth.requestDevice()` must be called from
  a real click. It cannot be triggered on page load or from a timer.
- **Service allow-listing.** Any GATT service the page intends to touch must appear in
  the `requestDevice` filters or in `optionalServices`, or access throws.
- **Exclusive pairing.** A trainer talks to one application at a time. Zwift, the
  Wahoo app, and any other paired client must be fully closed.
- **macOS permission.** The browser itself needs Bluetooth permission in System
  Settings; a refusal surfaces as an empty device chooser rather than an error.
- **Disconnects are routine.** `gattserverdisconnected` must be handled as an expected
  event, not an exception path.

## 3. Repository structure

npm workspaces. TypeScript throughout. Vite for both apps and for the probe tool.

```
packages/trainer/      Bluetooth, FTMS protocol, rider physics
packages/game-core/    seeded route generation, scoring rules, persistence
apps/canvas/           Version A — vanilla TypeScript + Canvas 2D
apps/phaser/           Version B — Phaser 3
tools/ble-probe/       Milestone 0 hardware diagnostic
docs/superpowers/specs/
```

Shared packages are consumed from TypeScript source via workspace references; they
have no build step of their own.

### What is shared and what is not

**Shared** (`packages/trainer`, `packages/game-core`): Bluetooth transport, FTMS
encode/decode, physics integration, seeded RNG, route generation, scoring constants,
difficulty curve, persisted stats.

**Not shared** (each app implements its own): rendering, isometric projection, entity
and scene management, collision detection, HUD, audio, keyboard plumbing.

This boundary is deliberate. Sharing the rules means both apps are demonstrably the
same game, so differences in feel are attributable to the renderer. Not sharing
collision and scene management means there is something real to compare.

## 4. Milestone 0 — hardware probe

Built and run before any game code exists.

A single page that:

1. Requests a device filtered on FTMS (`0x1826`), with Cycling Power (`0x1818`),
   Cycling Speed and Cadence (`0x1816`), Heart Rate (`0x180D`), Device Information
   (`0x180A`), and Battery (`0x180F`) as optional services.
2. Enumerates every discovered service and characteristic with its properties.
3. Subscribes to Indoor Bike Data (`0x2AD2`) and renders each notification both as
   decoded fields and as raw hex, so the parser can be checked against ground truth.
4. Reads Fitness Machine Feature (`0x2ACC`) and reports which control operations the
   trainer claims to support.
5. Attempts `Request Control` (`0x00`), then `Start/Resume` (`0x07`), then a grade
   sweep from 0% to +6% to −3% via `Set Indoor Bike Simulation Parameters` (`0x11`),
   logging every indication and result code.
6. Records the session — every raw notification with a timestamp — and offers it as a
   JSON download.

**This milestone answers the one question that cannot be answered without the
hardware: whether this specific firmware accepts simulation-parameter writes from a
browser.** Its recorded output becomes the fixture corpus for parser unit tests and
the data behind the replay trainer source.

If sim-mode control is rejected, the game still ships against Approach B behaviour
(read-only, arcade tuning) and the design's terrain feedback degrades to visual only.

## 5. Trainer layer (`packages/trainer`)

### 5.1 The source interface

Everything upstream of the game is hidden behind one interface:

```ts
interface TrainerSample {
  t: number;               // performance.now() milliseconds
  power: number | null;    // watts at the cranks
  cadence: number | null;  // rpm
  speed: number | null;    // m/s as reported by the trainer
  distance: number | null; // cumulative metres
}

interface TrainerSource {
  readonly kind: 'ftms' | 'keyboard' | 'replay';
  readonly canControlResistance: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  onSample(fn: (s: TrainerSample) => void): () => void;
  onStatus(fn: (s: TrainerStatus) => void): () => void;
  setSimulation(p: SimulationParams): void;  // no-op when control unavailable
}
```

Three implementations:

- **`FtmsSource`** — the real trainer.
- **`KeyboardSource`** — holding `W` ramps power toward a ceiling, releasing decays it,
  with a plausible cadence derived from the power curve. This is the primary
  development loop and requires no hardware.
- **`ReplaySource`** — plays back a Milestone 0 capture in real time or faster. Used
  for deterministic tests and for tuning game feel against a real ride.

The game never learns which one it has beyond `canControlResistance`.

### 5.2 FTMS protocol

**Indoor Bike Data (`0x2AD2`, notify).** A uint16 little-endian flags field followed by
present fields in a fixed order:

| Bit | Field | Encoding |
|-----|-------|----------|
| 0 | More Data | **Instantaneous Speed is present when this bit is CLEAR** — uint16, 0.01 km/h |
| 1 | Average Speed | uint16, 0.01 km/h |
| 2 | Instantaneous Cadence | uint16, 0.5 rpm |
| 3 | Average Cadence | uint16, 0.5 rpm |
| 4 | Total Distance | uint24, metres |
| 5 | Resistance Level | sint16 |
| 6 | Instantaneous Power | sint16, watts |
| 7 | Average Power | sint16, watts |
| 8 | Expended Energy | uint16 kcal + uint16 kcal/hr + uint8 kcal/min |
| 9 | Heart Rate | uint8, bpm |
| 10 | Metabolic Equivalent | uint8, 0.1 |
| 11 | Elapsed Time | uint16, seconds |
| 12 | Remaining Time | uint16, seconds |

Bit 0's inverted sense is the single most common source of misaligned parsers and is
called out here deliberately. The parser must be driven by the flags field and must
never assume fixed offsets.

**Fitness Machine Control Point (`0x2AD9`, write + indicate).** Opcodes used:

| Opcode | Operation | Parameters |
|--------|-----------|------------|
| `0x00` | Request Control | none |
| `0x07` | Start / Resume | none |
| `0x08` | Stop / Pause | uint8 control code |
| `0x11` | Set Indoor Bike Simulation Parameters | wind sint16 (0.001 m/s), grade sint16 (0.01 %), Crr uint8 (0.0001), Cw uint8 (0.01 kg/m) |

Responses arrive as an indication `[0x80, requestOpcode, resultCode]` where `0x01` is
success. Requirements on the writer:

- **Serialised.** Exactly one control-point write may be outstanding; the next waits
  for its indication or a 2-second timeout.
- **Rate-limited.** Simulation parameters are sent at most 4 times per second. The
  game may call `setSimulation` every frame; the layer coalesces to the latest value.
- **Gated.** Nothing is written until `Request Control` has returned success. Failure
  flips `canControlResistance` to false and the game continues read-only.
- **Clamped.** Grade is clamped to ±8% before encoding, regardless of what the game
  asks for.
- **Reset on teardown.** Grade returns to 0% on disconnect, on page unload, and on the
  panic key.

### 5.3 Physics

Measured crank power drives a forward-integrated point-mass model.

```
F_gravity = m · g · sin(atan(grade))
F_rolling = Crr · m · g · cos(atan(grade))
F_aero    = ½ · ρ · CdA · (v + headwind)²
a         = (P · η / max(v, v_min) − F_gravity − F_rolling − F_aero) / m
```

Defaults: `η = 0.97`, `ρ = 1.225 kg/m³`, `CdA = 0.32 m²`, `Crr = 0.005`,
`v_min = 0.5 m/s` to keep the standing-start term finite. Rider mass and FTP are
settings, defaulting to 85 kg and 200 W.

The `v_min` floor means low-speed acceleration is approximated rather than exact. This
is accepted: it is stable, it is monotonic in power, and the error is confined to the
first moment of a standing start.

Surfaces modify `Crr` — grass and lawns roughly quadruple it, a curb strike applies a
brief impulse and a speed penalty. Terrain supplies grade, which feeds both the
simulated speed and the value sent to the trainer, so what the rider sees and what
their legs feel come from the same number.

FTP scales difficulty rather than physics: the difficulty curve chooses grades such
that holding the target game speed corresponds to a chosen fraction of the rider's
FTP. Physics constants themselves stay honest.

### 5.4 Safety

Grade is clamped to ±8%. A panic key (`Escape`) zeroes resistance and stops the ride
immediately. Resistance resets to zero on disconnect and on page unload. A trainer
that stops reporting for 5 seconds is treated as disconnected.

## 6. Game design (`packages/game-core` plus both apps)

### 6.1 The street

An isometric street scrolling diagonally, camera following the rider. Three bands
across the path: a left sidewalk running in front of the houses, a middle strip of
lawns and driveways, and the road on the right carrying traffic.

Houses appear on the left side only. This is faithful to the arcade and it keeps
throwing unambiguous — papers always fly left, so throwing needs no aiming input
beyond timing.

### 6.2 Entities

- **House** — subscriber or not, colour-coded. Owns a mailbox target, a porch target,
  and a window target. Tracks delivered and broken state.
- **Paper** — a projectile on a fixed left-ward arc from the rider, with a shadow so
  its landing point is readable.
- **Hazards** — cars, dogs, sprinklers on an on/off cycle, lawnmowers, storm drains,
  bins, skateboarders.
- **Paper stack** — a sidewalk pickup restoring papers.
- **Surface patch** — grass or curb, modifying rolling resistance.

### 6.3 Scoring

| Event | Points |
|-------|--------|
| Paper in mailbox | 500 |
| Paper on porch | 250 |
| Paper on lawn | 0 |
| Non-subscriber window smashed | 100 |
| Subscriber window smashed | −250, subscriber lost for the rest of the run |
| Every subscriber on a block served | 1000 block bonus |

Positive points from a scoring event are multiplied by the current combo multiplier
before being added to the score. Penalties and the block bonus are not multiplied —
multiplying a penalty would make a good run punish mistakes disproportionately.

A **combo multiplier** starts at 1× and rises one step per successful delivery,
capping at 8×. A successful delivery is a paper landing in a mailbox or on a porch.
The multiplier resets to 1× on any of: a subscriber house passed without a
successful delivery, a paper landing on a lawn, a smashed subscriber window, or a
crash. Smashing a non-subscriber window scores but neither raises nor resets the
multiplier.

Papers are finite — 20 at the start of a run, capped at 30, with sidewalk stacks
restoring 10. Throwing with an empty bundle does nothing. Three lives; a crash costs
one and grants 1.5 seconds of invulnerability, during which the rider cannot score.

### 6.4 Replayability

The arcade's fixed Monday-to-Sunday week is replaced with structure that rewards
repeat rides:

- **Seeded neighbourhoods.** Every run is generated from a seed, so the same seed is
  the same street. Random seed, date-derived daily seed, or a seed typed in by hand.
- **Escalating blocks.** Hazard density, traffic speed, and the subscriber-to-window
  ratio ramp with distance. A run ends when lives run out, not when the map does.
- **The combo multiplier** as the primary chase mechanic.
- **Persistent stats** in localStorage: all-time high score, best distance, per-seed
  best, lifetime papers delivered.
- **End-of-run card** showing score alongside ride data — distance, elapsed time,
  average power, kilojoules — so the score and the workout are legible together.

### 6.5 Route generation

A seeded PRNG (mulberry32) generates a route as a sequence of blocks. Given a seed,
generation is fully deterministic and independent of frame timing. Generation must
guarantee that every block has a traversable line: no arrangement of hazards may
completely span the ridable width. This is an invariant with a test, not an intention.

## 7. Controls

| Key | Action |
|-----|--------|
| ← / → | Steer across the street |
| Space | Throw a paper |
| W | Simulate pedalling (keyboard trainer source only) |
| Escape | Panic — zero resistance, stop the ride |
| P | Pause |

## 8. Testing

Test-driven, using Vitest on the shared packages.

**`packages/trainer`**
- FTMS parsing against recorded byte fixtures from Milestone 0, plus synthetic vectors
  covering every flag combination that matters — in particular both senses of bit 0.
- Control-point encoding checked byte-for-byte against the spec tables above,
  including negative grades and clamping.
- Write serialisation and rate limiting, on fake timers.
- Physics steady-states: 200 W on the flat settles in the low-30s km/h; power to zero decays
  speed monotonically; a positive grade lowers steady-state speed for fixed power.

**`packages/game-core`**
- Same seed produces an identical route; different seeds do not.
- No generated block is impassable.
- Scoring and combo transitions across the full event table.

**Both apps**
- A headless smoke test driving the loop from a scripted `TrainerSource` for a fixed
  number of ticks, asserting the run advances and terminates correctly.

Hardware itself cannot be tested in CI. The replay source exists so that everything
downstream of the radio can be.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Firmware rejects browser sim-mode writes | Milestone 0 finds out before any game code is written; game degrades to read-only arcade tuning |
| Web Bluetooth flakiness or mid-ride disconnects | Disconnect treated as an expected event; auto-reconnect; game pauses rather than dies |
| Isometric depth sorting artifacts | Painter's algorithm over a per-frame depth sort, with an explicit test route built to expose overlap |
| Game feel too easy or too punishing | Physics constants and the difficulty curve live in one tunable module, adjustable against replayed real rides |
| Latency between pedal stroke and screen | Trainer notifications arrive near 1–4 Hz; speed is interpolated between samples rather than stepped |
