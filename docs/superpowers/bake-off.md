# The bake-off: Canvas versus Phaser

The same Paperboy-on-a-bike-trainer game got built twice: once by hand on
Canvas 2D (`apps/canvas`, Version A), once on Phaser 3 (`apps/phaser`,
Version B). Both sit on the same two packages — `@paperboy/game-core` (route
generation, RNG, scoring, landing classification) and `@paperboy/trainer`
(FTMS Bluetooth, physics stepping, the KICKR control-point writer) — so
anything that differs between them is a rendering/engine decision, not a
rules decision.

This document is what got measured and read, plus what still needs a human
with a screen and a pair of legs. Nothing below about how either version
*feels* to ride is a real observation — there is no display in the
environment this was written in, and nobody has yet watched either one
render a frame. Where the brief asked for a ride report, this says so
plainly instead of making one up.

## Why the comparison is fair

Before any of the numbers below mean anything, it has to be true that both
versions are actually playing the same game. Two pieces of evidence say they
are, and both come from earlier tasks in this project, not from this one:

- **Frame-for-frame parity.** During Task 20's review, both engines were
  driven for 20,000 frames on the same seed and the same input sequence.
  Distance difference came out at exactly `0.000e+0`, with every
  `papersDelivered`/multiplier/streak/score transition matching on every
  single frame (`progress.md`, Task 20 entry). The reviewer's first attempt
  at this harness *did* show drift — about 2.0 m by frame 5000 — and traced
  it to a bug in their own harness (it skipped the power ramp `session.ts`
  applies before `stepWorld`), not to either engine. The real bug that
  parity-testing did catch was Version B streaming blocks *after* physics on
  the first frame of a run, so `gradeAt(0)` silently fell back to a flat 0%
  grade for one frame — fixed in Task 20, verified with a bit-exact
  (`toBe`, not `toBeCloseTo`) regression test.
- **Identical hazard collision thresholds.** Version A originally used one
  flat collision half-depth for every hazard kind, which didn't even match
  its own drawn car sprite. Both engines were swept in 0.0001 m steps to find
  the exact last-hit distance per hazard kind (Task 21's fix report):

  | Hazard kind | Version A (canvas) | Version B (phaser) |
  |---|---|---|
  | car | 2.7499 m | 2.7499 m |
  | non-car (dog, etc.) | 1.25 m | 1.25 m |

  Both match to the sweep's resolution. Collision now triggers at the same
  distance in both engines, derived from the same rule
  (`hazardHalfDepth` in `apps/canvas/src/rules.ts`, and the identical
  `kind === 'car' ? 4 : 1` expression duplicated in
  `apps/phaser/src/scenes/StreetScene.ts` and `apps/phaser/src/views.ts`).

Given that, Step 1 of the brief — ride both on seed `paperboy`, check same
houses/subscribers/hazards/score — reduces to a claim about the shared
layer, which is exactly what the parity test above already exercises
mechanically for every seed, not just one. It does **not** cover whether the
rendered scene visually agrees with that state (a house drawn in the wrong
lane, a depth-sort glitch), which only a human watching both apps can catch.
That's on the open-questions list below, not answered here.

One more thing worth naming up front: Version A had two real bugs, found in
code review rather than by any test — its panic key silently failed to zero
trainer resistance (a queued zero was overwritten by an unconditional
`setSimulation` call before the 4 Hz flush ever sent it), and its fixed-step
loop froze entirely above 120 Hz refresh rates (`Math.floor(elapsedS /
FIXED_DT)` computed fresh every frame with no carried remainder floors to
zero once `dt` drops below `FIXED_DT`). Both were root-caused and fixed in
Task 18, and both fixes — the `effectiveSimulation()`/single-call pattern
and the accumulator-with-latched-throw pattern — were built into Version B
from the start rather than being discovered a second time. That history
matters for the "which codebase next week" judgement below: both of these
were real, non-obvious concurrency/timing bugs in code that no unit test
happened to touch, and the project's answer to that so far has been careful
human review, in both versions, not test coverage.

## What was measured

### Production bundle

```
npm --workspace @paperboy/canvas run build
npm --workspace @paperboy/phaser run build
```

| | Version A (canvas) | Version B (phaser) |
|---|---|---|
| JS chunk, minified | 31.39 kB | 1,511.51 kB |
| JS chunk, gzipped | 11.47 kB | 349.21 kB |
| `index.html` | 1.24 kB | 1.19 kB |
| `dist/` total on disk | 36 K | 1.4 M |

Version A ships almost nothing beyond its own code — `@paperboy/game-core`
and `@paperboy/trainer` are its only dependencies, and both are workspace
packages, not third-party ones. Version B's bundle is essentially "the
Phaser library plus the game," and it shows: **the JS chunk is ~48x larger
minified and ~30x larger gzipped**, even though the two apps' own source is
roughly the same size (below). Phaser's default build was used as-is here —
no manual-chunking, no arcade-physics-only trim, no WebGL-only build — so
this is the bundle Version B ships today, not a floor on what's achievable
with more build tuning.

### Dependency weight

Version A: zero runtime dependencies outside the shared workspace packages.

Version B: `phaser` `^3.86.0` in `package.json`, resolving to `3.90.0`
installed. On-disk installed size (`du -sh node_modules/phaser`): **146 M**,
broken down as `types/` 51 M, `plugins/` 43 M, `dist/` 34 M, `src/` 13 M,
`changelog/` 5.0 M. Almost none of that reaches the browser — the actual
shipped bundle is the 1.51 MB minified figure above — but it's 146 M that
now exists in `node_modules`, gets fetched on every clean install, and is
one more security-advisory surface to track that Version A simply doesn't
have.

### Source lines outside the shared packages

```
find apps/<app>/src -name '*.ts' | xargs wc -l
```

| | Version A (canvas) | Version B (phaser) |
|---|---|---|
| Files | 11 | 7 |
| Total lines | 1,282 | 1,134 |

Per file:

| Version A | lines | | Version B | lines |
|---|---|---|---|---|
| `main.ts` | 170 | | `main.ts` | 158 |
| `iso.ts` | 58 | | `iso.ts` | 40 |
| `hud.ts` | 34 | | `scenes/HudScene.ts` | 47 |
| `input.ts` | 60 | | | |
| `rules.ts` | 215 | | `logic/run.ts` | 370 |
| `session.ts` | 153 | | | |
| `world.ts` | 191 | | `logic/entities.ts` | 100 |
| `render/scene.ts` | 202 | | `scenes/StreetScene.ts` | 306 |
| `render/drawables.ts` | 62 | | | |
| `render/primitives.ts` | 104 | | `views.ts` | 113 |
| `render/palette.ts` | 33 | | | |

Total app-level source is close either way (1,282 vs 1,134). What differs is
*shape*: Version A spreads its logic across ten small, single-purpose files
(none over 220 lines); Version B concentrates a third of its own code
(370 + 306 = 676 of 1,134 lines) into two large files — `logic/run.ts` (the
run model: physics, scoring, paper flight, house resolution) and
`scenes/StreetScene.ts` (streaming absorption, entity lifecycle, position
sync, and collision, all in one `update()` method).

### Tests

```
npm test    # whole repo
```

Whole-repo suite: **297 tests passing, 1 skipped**, across 22 test files.
The one skip is a real-hardware test gated on a KICKR capture file that
doesn't exist yet in this environment
(`packages/trainer/test/replaySource.test.ts`) — not a failure, an
unmet precondition. Reproduced directly by running `npm test` above; matches
the count already on record from Task 21.

Per app:

| | Version A (canvas) | Version B (phaser) |
|---|---|---|
| Test files | 5 | 2 |
| Tests | 105 | 39 |
| Test source lines | 1,087 | 400 |

Version A has roughly 2.7x as many app-level tests as Version B, and almost
3x the test source, for a slightly *larger* app. That's not because Version
B was tested less carefully — it's because most of Version B's app-specific
code cannot be unit-tested at all (next section).

### How much of each app's source is actually under test

"Under test" here means: the file is imported and directly exercised by a
test file, not merely reachable through some chain of imports.

**Version A** — tested: `iso.ts` (58), `world.ts` (191), `rules.ts` (215),
`session.ts` (153), `render/drawables.ts` (62) = **679 of 1,282 lines
(53%)**. Untested: `main.ts` (170), `hud.ts` (34), `input.ts` (60),
`render/scene.ts` (202), `render/primitives.ts` (104), `render/palette.ts`
(33) = 603 lines (47%) — DOM wiring, keyboard/menu glue, and the actual
`CanvasRenderingContext2D` drawing calls. None of that untested code is
where the interesting bugs were; both real bugs found in review (panic key,
120 Hz freeze) lived in `main.ts`/`session.ts`, in code that *is* covered —
`session.test.ts`'s `effectiveSimulation` and `advanceFixed` tests are what
pin those fixes today.

**Version B** — tested: `logic/entities.ts` (100), `logic/run.ts` (370) =
**470 of 1,134 lines (41%)**. Untested: `iso.ts` (40), `main.ts` (158),
`views.ts` (113), `scenes/HudScene.ts` (47), `scenes/StreetScene.ts` (306) =
664 lines (59%). The untested fraction is larger in absolute terms and as a
share of the app, and it's concentrated in exactly the file that matters
most structurally: `StreetScene.ts` (306 lines, the single largest file in
either app) does entity streaming, position sync, *and* collision detection
in one `update()` method, and none of it has a test.

This isn't for lack of trying. Task 21's fix report records a real attempt
to get a headless `Phaser.Game` running under `happy-dom` so `StreetScene`
could be exercised directly — it got as far as loading Phaser, then failed
inside `phaser/src/device/Fullscreen.js` on missing browser globals. The
same report resorted to a scratch harness that hand-reproduced Arcade's
AABB overlap arithmetic outside of Phaser entirely, specifically because the
real collision path requires a live `Phaser.Game`/`Scene`/canvas that
doesn't exist in CI or in this environment. Both of Version B's real
collision bugs — the rider's Arcade zone having its distance/lateral axes
swapped, and physics being tied to the display's refresh rate instead of a
fixed timestep — were caught by code review reading `StreetScene.ts`, not by
a test, for the same reason: nothing in the suite touches that file.

## Where Phaser saved work, and where it didn't

**Saved:** depth sorting is genuinely free in Version B. Every drawable
container gets `setDepth(lateral - distance)` once, and Phaser's own display
list handles draw order from then on (`StreetScene.ts`'s `#place`, one
line: `container.setDepth(...)`). Version A has to rebuild and sort a fresh
array every single frame — `collectDrawables()`
(`apps/canvas/src/render/drawables.ts`) walks every house, hazard, stack and
paper, computes a `depthKey`, and calls `.sort()` on the result, every
frame, whether or not anything moved relative to anything else. Scene
composition is also close to free: `HudScene.ts` is a second `Phaser.Scene`
that reads `StreetScene.run` and renders text, wired in with nothing more
than `scene: [street, new HudScene()]` in the `Phaser.Game` constructor —
though it's worth noting Version A's equivalent, `drawHud()`, is a single
34-line function called after `renderFrame()`, so the two approaches land at
about the same line count (34 vs 47) for the same feature; the win here is
conceptual separation, not code saved.

**Didn't save, or actively cost:**

- *Isometric projection.* Neither engine has native isometric support, so
  both hand-rolled the exact same trapezoid-projection math independently.
  `apps/phaser/src/iso.ts` says so directly in its own header comment:
  "Same maths as Version A ... restated here so the two apps stay
  independent." Phaser's scene graph bought nothing here; the formula in
  `project()` and `worldToScreen()` is identical.
- *A second coordinate system, purely for physics.* Because Arcade bodies
  need axis-aligned, non-isometric coordinates, Version B has to maintain
  *world-space pixel* positions (`toBodyX`/`toBodyY`, scaled by
  `PX_PER_M = 24`) for its `Zone` bodies, entirely separate from the
  *screen-space* positions its `Graphics` containers get from `project()`
  each frame. `StreetScene.ts` keeps both in sync by hand — a hazard's
  `distance`/`lateral` feed `zone.setPosition(toBodyX(...), toBodyY(...))`
  for physics and, separately, `#place()` → `project(...)` for the sprite.
  Version A never needed a third coordinate space at all: `detectCollision`
  in `rules.ts` runs its AABB check directly in world metres, the same
  numbers used for everything else. Phaser's physics engine, in other
  words, required inventing a coordinate system Version A didn't need,
  purely to have somewhere for Arcade to do its overlap test.
- *Headless testability.* Covered above — 59% of Version B's app source is
  effectively untestable without a real browser, concentrated in the file
  doing the most structurally important work.

## Collision: both ended up in world space anyway

This is worth stating plainly because it's the part where Phaser's physics
module looks like it should have bought the most and arguably bought the
least. Version A's collision check is direct: `detectCollision` compares
`w.rider.distance`/`w.rider.lateral` against each hazard's world-space
`distance`/`lateral` with a per-kind half-depth, no library involved.
Version B's collision check ultimately does the same comparison — a rider
`Zone` and a hazard `Zone`, both positioned in world-space pixels via
`toBodyX`/`toBodyY`, checked with an explicit
`this.physics.world.overlap(riderZone, hazardZone)` call made once per frame
after positions are final (StreetScene deliberately avoids a registered
collider for this reason, per its own comment).

Neither engine could put collision bodies in *screen* (isometric) space,
because isometric projection isn't axis-aligned — a rectangle in world space
becomes a diamond on screen, and Arcade's rectangle-vs-rectangle overlap
test needs axis-aligned rectangles to mean anything. So both versions do
collision in the same world-space metres/pixels, and what Phaser actually
contributed was: a function call (`overlap()`) and a `Body` object to hold
position and size. It did not save the harder part — deciding what
rectangle represents a car versus a dog versus the rider, and keeping that
rectangle's size in sync with the isometric sprite it's meant to gate. That
part had to be hand-derived and hand-matched in both engines, and it broke
in exactly the way you'd expect: Version A's own hazard hitbox didn't match
its own drawn car sprite, and only converged with Version B's after the
Task 21 fix swept both and pinned them to the same numbers (2.7499 m /
1.25 m, above). The `kind === 'car' ? 4 : 1` expression that decides a
hazard's collision depth is duplicated verbatim across `rules.ts`,
`views.ts`, and `StreetScene.ts` — three independent copies of the same
number, in two codebases, with a code comment in `rules.ts` warning future
editors that all three must change together. Phaser's physics module didn't
remove that duplication; it added a third copy of it.

## Which codebase would be easier to change next week

This is a judgement call, not a measurement, and it's made from reading the
code, not from playing either game.

I'd rather extend Version A. Three things point that way: it has no
external dependency to track or upgrade; a larger share of its logic sits
behind tests (53% vs 41%), and the untested remainder is boilerplate (DOM
wiring, canvas draw calls) rather than anything structurally central; and
its logic is spread across small, single-purpose files where a change to,
say, hazard behaviour touches `world.ts`/`rules.ts` and nothing else.
Version B's equivalent change would likely touch `logic/run.ts` and
`scenes/StreetScene.ts` together — the run model and the untested scene
file that owns collision, streaming, and position sync all at once — which
is a wider, less-verifiable blast radius for the same size of change.

That said, this cuts the other way as the game grows more visually
ambitious. Version A's cost model for a new visual feature is "draw it
every frame, forever" — `collectDrawables()` and `renderFrame()` both scale
with however many entities are on screen, every frame, whether or not
anything changed. Version B's cost model is "create it once, then it's
handled" — a new entity kind gets a `Graphics` drawn once and repositioned
thereafter, and depth sorting is free. For a game that stays about this
visually simple, that difference doesn't matter much; for one that grows
particle effects, animation, or many more simultaneously visible entities,
it would start to.

I'm also not weighting this against how either version actually plays,
because I don't know — that's the whole point of the open questions below.

## Open questions — needs a human, a screen, and legs

The following cannot be answered from source code or build output, and
nothing below should be read as a prediction of the answer:

1. **Which one feels better to ride, and why?** Load both
   (`http://localhost:5181` for Version A, `http://localhost:5182` for
   Version B — both dev servers were left running for this purpose and were
   not stopped) on the same seed and same input pattern, and pay attention
   to whether any difference in feel traces to frame pacing, the depth
   sort, camera behaviour, or just the art — the brief's own framing for
   what to listen for.
2. **Frame time under load.** Chrome DevTools Performance panel, ten
   seconds of riding through a busy block (several hazards, houses, and
   in-flight papers on screen at once), median frame time for each version.
   Given the bundle-size and dependency gap above, it's plausible Version B
   costs more per frame even with fewer draw calls at steady state — plausible,
   not measured; only a real profile settles it.
3. **Visual/state agreement at the rendering layer.** Ride both on seed
   `paperboy` through the first three blocks and confirm houses land in the
   same places, the same houses are subscribers, the same hazards appear
   in the same places, and the same throws score the same amount. The
   shared-layer state driving all four is already known to be bit-exact
   (see above); what's unverified is whether each engine's *renderer*
   draws that shared state correctly — a wrong lane, a swapped colour, a
   depth-sort glitch that only shows up with specific entity overlaps.
4. **Memory behaviour over a long ride.** Version B explicitly destroys
   streamed-out `Container`/`Zone` pairs in `StreetScene.ts` as the
   `BlockStreamer` reports removals; nothing in this environment can confirm
   over several real minutes of play that `#hazards`/`#statics` actually
   stay flat rather than slowly leaking. Watch the memory graph.
5. **The isometric-projection question the brief asks directly** — did it
   end up simpler in immediate mode or in a scene graph? On the numbers
   (58 lines of `iso.ts` for Version A, 40 for Version B, nearly identical
   math) it's a wash; the honest answer may be "neither had an advantage
   here, and Phaser's scene graph added a second coordinate system on top of
   it that immediate mode didn't need" — but that's this document's reading
   of the code, not a settled verdict.
6. **The KICKR capture file.** One test remains skipped
   (`packages/trainer/test/replaySource.test.ts`) for lack of a real-hardware
   capture. It exercises neither app directly, but closing it would mean
   both versions' shared trainer-replay path has been run against a real
   KICKR trace at least once, rather than only against synthetic input.
