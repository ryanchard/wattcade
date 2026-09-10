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

## The art is no longer comparable — read this before any visual claim

**As of this writing, Version A and Version B do not look like the same
game, and that gap is entirely unported artwork, not an engine difference.**
Version A's placeholder box sprites were replaced (commit `08a4c22`) with
real vector art: houses got pitched roofs with gable ends and overhanging
eaves, mullioned window grids, doors and porches, varied per house; the
rider became a kid on an actual bike with rolling wheels and a paper bag;
cars gained a set-back cabin and headlights; the dog, bin, lawnmower,
skater, and drain each got a distinct silhouette instead of sharing one
cuboid; and mailbox flags now drop once a house is served. Its signature
element is diegetic light — a lit subscriber house throws a warm porch-light
pool onto its own lawn, painted in its own ground pass before the entity
loop, so anything standing in the light is lit by it.

Version B still draws every entity as a plain isometric box
(`apps/phaser/src/views.ts`'s `box()`), unchanged since Task 21, with one
small exception: the shared sprinkler-fairness fix (below) added a toggled
droplet-spray overlay for sprinklers specifically, drawn in
`drawSprinklerSprayView`. Everything else — houses, rider, cars, dog, bin,
lawnmower, skater, drain — is still the original undifferentiated box.

**Practically: any claim about which version "looks better," reads its
street more legibly, or feels nicer to look at is not a comparison of
Canvas versus Phaser right now — it's a comparison of finished art against
placeholder art, on top of two different engines.** That comparison becomes
meaningful again once the same art pass is ported to Version B (or dropped
back to boxes on both sides for a controlled look). Until then, treat
open question 3 below as blocked on that porting work, not just on someone
sitting down to look.

## Why the comparison is fair

Before any of the numbers below mean anything, it has to be true that both
versions are actually playing the same game. Two pieces of evidence say they
are, and both come from earlier tasks in this project, not from this one:

- **Frame-for-frame parity — of the shared pure-logic layer specifically,
  not of everything either engine does.** During Task 20's review, both
  engines were driven for 20,000 frames on the same seed and the same input
  sequence, exercising rider physics, block streaming, landing
  classification, and scoring — the parts that route through
  `@paperboy/game-core` and `@paperboy/trainer`, or through logic
  (`stepWorld`/`PaperboyRun.update`) that mirrors it frame-for-frame in both
  apps. Distance difference came out at exactly `0.000e+0`, with every
  `papersDelivered`/multiplier/streak/score transition matching on every
  single frame (`progress.md`, Task 20 entry). The reviewer's first attempt
  at this harness *did* show drift — about 2.0 m by frame 5000 — and traced
  it to a bug in their own harness (it skipped the power ramp `session.ts`
  applies before `stepWorld`), not to either engine. The real bug that
  parity-testing did catch was Version B streaming blocks *after* physics on
  the first frame of a run, so `gradeAt(0)` silently fell back to a flat 0%
  grade for one frame — fixed in Task 20, verified with a bit-exact
  (`toBe`, not `toBeCloseTo`) regression test.

  **What that 20,000-frame run did NOT cover: hazard motion and collision.**
  Both sat outside the shared layer at the time — each app hand-rolled its
  own copy of the hazard weave and its own collision check — so a bit-exact
  match on distance and score says nothing about whether a hazard was in
  the same place in both engines. It wasn't: a later review (finding 2,
  `final-fixes-report.md`) found Version B's weave had silently dropped
  Version A's lateral clamp, putting 136 of 753 moving non-car hazards
  (18.1%, across 5 seeds x 40 blocks) at a different lateral by up to
  0.63 m — a real, measurable divergence the 20,000-frame parity claim
  never touched, precisely because it lived outside what that harness
  exercised. The weave has since been moved into `@paperboy/game-core`
  (`hazardPositionAt`) and both apps now call the identical function, so
  the parity claim is broader today than it was when this document was
  first written — but that broadening happened after this run, not because
  of it.
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
- **Sprinklers now cycle, and both engines agree on when they're dangerous.**
  Sprinklers have always had a `phase` field driving a visual on/off cycle,
  but collision used to treat every sprinkler as live on every frame — a
  sprinkler drawn OFF could still crash you. `isHazardActive(spec, elapsed)`
  in `packages/game-core` is now the single shared answer to "is this
  sprinkler actually spraying right now" (3 s on, 2 s off, phase-offset per
  sprinkler), and both engines' collision AND rendering consult it: Version
  A's `detectCollision` and `drawSprinkler`, Version B's `#checkCollisions`
  and the toggled spray overlay in `views.ts`. This is the shared-rules
  boundary doing exactly the job it exists for — a fairness bug that would
  otherwise have had to be found and fixed twice was fixed once, in the one
  place both engines read from.

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
| JS chunk, minified | 44.92 kB | 1,512.24 kB |
| JS chunk, gzipped | 16.13 kB | 349.53 kB |
| `index.html` | 1.24 kB | 1.19 kB |
| `dist/` total on disk | 48 K | 1.4 M |

(Re-measured after the art pass and the sprinkler-fairness fix. Version A's
bundle grew from 31.39/11.47 kB to 44.92/16.13 kB — the cost of the new
`render/entities.ts` and the expanded `render/primitives.ts`/`palette.ts`,
below. Version B's is essentially unchanged, 1,511.51 → 1,512.24 kB — the
sprinkler spray overlay is a handful of lines.)

Version A ships almost nothing beyond its own code — `@paperboy/game-core`
and `@paperboy/trainer` are its only dependencies, and both are workspace
packages, not third-party ones. Version B's bundle is essentially "the
Phaser library plus the game," and it shows: **the JS chunk is ~34x larger
minified and ~22x larger gzipped**, even with Version A's own JS now
meaningfully larger post-art-pass. Phaser's default build was used as-is
here — no manual-chunking, no arcade-physics-only trim, no WebGL-only
build — so this is the bundle Version B ships today, not a floor on what's
achievable with more build tuning.

### Dependency weight

Version A: zero runtime dependencies outside the shared workspace packages.

Version B: `phaser` `^3.86.0` in `package.json`, resolving to `3.90.0`
installed. On-disk installed size (`du -sh node_modules/phaser`): **146 M**,
broken down as `types/` 51 M, `plugins/` 43 M, `dist/` 34 M, `src/` 13 M,
`changelog/` 5.0 M. Almost none of that reaches the browser — the actual
shipped bundle is the 1.51 MB minified figure above — but it's 146 M that
now exists in `node_modules`, gets fetched on every clean install, and is
one more security-advisory surface to track that Version A simply doesn't
have. Unchanged by the art pass, since that work only touched Version A.

### Source lines outside the shared packages

```
find apps/<app>/src -name '*.ts' | xargs wc -l
```

Re-measured after the art pass and the sprinkler-fairness fix:

| | Version A (canvas) | Version B (phaser) |
|---|---|---|
| Files | 12 | 7 |
| Total lines | 2,542 | 1,222 |

Per file:

| Version A | lines | | Version B | lines |
|---|---|---|---|---|
| `main.ts` | 170 | | `main.ts` | 158 |
| `iso.ts` | 58 | | `iso.ts` | 40 |
| `hud.ts` | 34 | | `scenes/HudScene.ts` | 47 |
| `input.ts` | 60 | | | |
| `rules.ts` | 222 | | `logic/run.ts` | 370 |
| `session.ts` | 153 | | | |
| `world.ts` | 191 | | `logic/entities.ts` | 100 |
| `render/scene.ts` | 146 | | `scenes/StreetScene.ts` | 347 |
| `render/drawables.ts` | 62 | | | |
| `render/entities.ts` | 909 | | `views.ts` | 160 |
| `render/primitives.ts` | 373 | | | |
| `render/palette.ts` | 164 | | | |

The two apps' source is no longer close to the same size. Version A grew
from 1,282 to 2,542 lines — essentially all of it (+1,260 lines) in the
rendering layer: a new 909-line `render/entities.ts` (one draw function per
entity kind, per the silhouette-first art pass) plus growth in
`render/primitives.ts` (104 → 373, new shape primitives: `prism`, `wheel`,
`groundGlow`, `pointGlow`, `uprightEllipse`) and `render/palette.ts`
(33 → 164, more colours and the `hashPick` variant tables the art uses for
per-house/per-hazard silhouette variety). None of Version A's non-rendering
logic (`world.ts`, `session.ts`, `iso.ts`) changed size at all; `rules.ts`
grew by 7 lines for the `isHazardActive` gate.

Version B grew more modestly, from 1,134 to 1,222 lines, entirely from the
sprinkler-fairness fix: `StreetScene.ts` (306 → 347) gained the
`isHazardActive` gate on both collision and the spray-visibility toggle,
and `views.ts` (113 → 160) gained the droplet-spray overlay. Its *shape*
point still stands unchanged from before the art pass: Version A spreads
its logic across many small, single-purpose files; Version B still
concentrates a large fraction of its own code (370 + 347 = 717 of 1,222
lines) into two large files — `logic/run.ts` (the run model) and
`scenes/StreetScene.ts` (streaming absorption, entity lifecycle, position
sync, and collision, all in one `update()` method) — the same structural
observation as before, just with slightly larger numbers.

### Tests

```
npm test    # whole repo
```

Whole-repo suite, re-run after the art pass and the sprinkler-fairness fix:
**309 tests passing, 1 skipped**, across 24 test files (up from 297/1 across
22 files). The one skip is still a real-hardware test gated on a KICKR
capture file that doesn't exist yet in this environment
(`packages/trainer/test/replaySource.test.ts`) — not a failure, an unmet
precondition, unaffected by either recent change.

Per app:

| | Version A (canvas) | Version B (phaser) |
|---|---|---|
| Test files | 5 | 3 |
| Tests | 106 | 43 |
| Test source lines | 1,109 | 495 |

Version B's test files went from 2 to 3 (`hazardActive.test.ts`, 95 lines,
verifying the shared `isHazardActive` gate at the exact point
`#checkCollisions` consults it — see below) and Version A's `rules.ts`
gained one test alongside its `isHazardActive` gate. Version A still has
roughly 2.5x as many app-level tests as Version B and a bit over 2x the test
source. That gap exists for the same reason as before: most of Version B's
app-specific code cannot be unit-tested at all (next section) — and, as of
the art pass, that's now also true for most of Version A's *new* code, just
for a different reason (it's drawing code, not scene-lifecycle code).

### How much of each app's source is actually under test

"Under test" here means: the file is imported and directly exercised by a
test file, not merely reachable through some chain of imports. Re-measured
after both apps changed:

**Version A** — tested: `iso.ts` (58), `world.ts` (191), `rules.ts` (222),
`session.ts` (153), `render/drawables.ts` (62) = **686 of 2,542 lines
(27%)**. Untested: `main.ts` (170), `hud.ts` (34), `input.ts` (60),
`render/scene.ts` (146), `render/entities.ts` (909), `render/primitives.ts`
(373), `render/palette.ts` (164) = 1,856 lines (73%).

This is a large swing from before the art pass, where Version A's tested
fraction was 53%. Nothing about what's tested changed — the same five files
(`iso.ts`, `world.ts`, `rules.ts`, `session.ts`, `render/drawables.ts`) are
still the ones with tests, and neither real bug this project has found in
Version A (the panic key, the 120 Hz freeze) lived outside them. What
changed is that essentially all 1,260 new lines landed in the untested
bucket, because they're `CanvasRenderingContext2D` drawing calls — the kind
of code a unit test can assert makes a certain sequence of `fill()` calls,
but not that the result looks like a house. Version A's coverage *ratio*
dropping is a direct, mechanical consequence of adding real art, not a sign
that anything got less careful.

**Version B** — tested: `logic/entities.ts` (100), `logic/run.ts` (370) =
**470 of 1,222 lines (38%)**. Untested: `iso.ts` (40), `main.ts` (158),
`views.ts` (160), `scenes/HudScene.ts` (47), `scenes/StreetScene.ts` (347) =
752 lines (62%). `hazardActive.test.ts` was deliberately not counted as
"testing" `StreetScene.ts` here, even though it exists specifically to pin
the fix inside `#checkCollisions` — it imports only `isHazardActive` from
`@paperboy/game-core` and hand-reproduces `#checkCollisions`'s box-overlap
arithmetic alongside it (the same technique Task 21's fix report used for
the hazard-depth sweep), rather than exercising the real `StreetScene`
class, for the same reason as always: a live `Phaser.Scene` can't be
constructed headlessly here. It's a real, working proof that the gate is
wired correctly at that call site — just not a test of `StreetScene.ts`
itself, which is why the raw line-coverage number doesn't move for it.

Two things are worth naming together here. First, **Version B's tested
percentage (38%) is now closer to Version A's (27%) than it was before the
art pass (41% vs 53%)** — not because Version B got more rigorously tested,
but because Version A's growth was concentrated entirely in inherently
visual code that was never going to be unit-testable regardless of engine.
Second, **in absolute terms the gap is still wide and in Version A's
favour**: 1,856 untested lines for Version A versus 752 for Version B.
Version A has far more untested code today, but almost none of it is
structurally central — it's draw calls. Version B's smaller pile of
untested code is still concentrated in the one file that matters most:
`StreetScene.ts` (347 lines, still the largest file in either app) does
entity streaming, position sync, *and* collision detection in one
`update()` method, and none of that method has a test that exercises the
real class.

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

**Saved — but more narrowly than it first looks.** Depth is **not** assigned
once in Version B; `#place()` in `apps/phaser/src/scenes/StreetScene.ts` is
called every frame, for every static, hazard, paper and the rider, via
`#syncPositions()`, and it recomputes `setDepth(lateral - distance)` every
single time. It has to — hazards move, papers fly, the rider steers — so
depth is reassigned at exactly the same per-frame frequency as Version A's
`collectDrawables()`. There is no per-frame cost saving here; both engines
redo this work every frame for every visible entity.

What Phaser genuinely removes is the *sort and the array bookkeeping around
it*, not the per-frame recomputation. Version A's `collectDrawables()`
(`apps/canvas/src/render/drawables.ts`) walks every house, hazard, stack and
paper into a fresh array, computes a `depthKey` for each, and calls a single
explicit `.sort()` on the whole array every frame, then hands that ordered
list to the renderer. Version B skips the array-and-sort step entirely:
each `Container` just states its own depth via `setDepth()`, and Phaser's
display list keeps itself ordered without any code in `StreetScene.ts`
having to gather everything into one place and sort it. That's a real
convenience — one call per entity instead of a call per entity *plus* a
sort over the whole set — but it's a smaller win than "sorted once and
never touched again" would imply, and it does not change the fact that both
engines touch every visible entity's depth every single frame.

Scene composition is also close to free: `HudScene.ts` is a second
`Phaser.Scene` that reads `StreetScene.run` and renders text, wired in with
nothing more than `scene: [street, new HudScene()]` in the `Phaser.Game`
constructor — though it's worth noting Version A's equivalent, `drawHud()`,
is a single 34-line function called after `renderFrame()`, so the two
approaches land at about the same line count (34 vs 47) for the same
feature; the win here is conceptual separation, not code saved.

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
- *Headless testability.* Covered above — 62% of Version B's app source is
  effectively untestable without a real browser, concentrated in the file
  doing the most structurally important work.

## What the art pass cost Version A's redraw-every-frame model

Version A's rendering is immediate-mode: `renderFrame()` walks
`collectDrawables()`'s sorted list and reissues canvas draw calls for every
visible entity, every frame, regardless of whether anything about that
entity changed since the last frame. Before the art pass a house was one
`box()` call — three filled paths (two walls, one roof-as-flat-top). The art
pass's own commit message describes the new house as "~30 filled paths
rather than one box," and a direct count run against the current
`drawHouse()` (sampling twelve synthetic house ids to catch every
combination of the two per-house random variants — a 1-in-3 cross gable and
a 1-in-2 chimney) puts it at **41 to 50 filled `fill()` calls per house**,
not ~30: the commit's own estimate under-counted the decorated variants
(cross gable, chimney, the window grid, porch, and mailbox flag) that push
a fully-dressed house well past its plainest form.

That per-entity cost multiplied by "every visible entity, every frame" is
exactly why the same commit also added a screen-space X cull to
`renderFrame()` (`offScreenX()` in `apps/canvas/src/render/scene.ts`):
`collectDrawables()` culls a generous, camera-independent 260 m ahead, but
the isometric projection is parallel, so a house 260 m up the street is
drawn at full size roughly 3,400 px off the right edge of a typical
viewport — work `fill()` would still pay for if nothing skipped it. Adding
that cull is reported (same commit message) to have roughly halved the
frame's total canvas calls on a full street, from 6,973 to 3,775. That
specific pair of numbers comes from the commit's own measurement, not one
reproduced here, and it was already checked and confirmed accurate.

The structural point stands regardless of the exact figures: Version A's
cost model was always "draw everything visible, every frame," and that was
a cheap promise to make when an entity was three filled paths. It's a much
more expensive promise now that a house is 41-50, and the fix so far has
been a smarter cull, not a change to the underlying pull-every-frame
architecture. Version B's push model — draw a `Graphics` once at creation,
then only reposition it — doesn't pay this particular tax at all; adding
comparably detailed art to Version B's boxes would cost more *once*, at
creation, rather than on every frame for every visible instance. This is
the clearest concrete case in either codebase where the two architectures'
costs would actually diverge under load, and it is a direct consequence of
Version A now having real art to draw.

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

I'd still rather extend the *rules layer* of Version A, but the art pass has
made this a more mixed call than it was, and it's worth saying so rather
than repeating the earlier answer unchanged. The coverage percentages no
longer point the same direction they did: Version A's tested share dropped
to 27%, Version B's is now the higher of the two at 38%. That swing is
mechanical, not a real quality signal — it happened because Version A's
growth was concentrated in categorically untestable drawing code — but it
does mean "more of its logic sits behind tests" is no longer a clean
argument for Version A the way it was. What still points to Version A: no
external dependency to track or upgrade, a rules layer (`world.ts`,
`rules.ts`, `session.ts`) that hasn't grown or changed shape at all and is
still spread across small, single-purpose files, and — in absolute terms —
its untested code is boilerplate (DOM wiring, canvas draw calls) rather
than anything structurally central, versus Version B's smaller but more
concentrated untested block sitting inside the one file
(`scenes/StreetScene.ts`) that does streaming, position sync, and collision
all at once. A change to hazard *behaviour* still touches only
`world.ts`/`rules.ts` in Version A versus `logic/run.ts` and
`scenes/StreetScene.ts` together in Version B. A change to hazard *art*,
though, now means touching a 909-line file (`render/entities.ts`) that has
no tests at all, in either version's sense of the word — that part of
Version A is no longer meaningfully smaller or simpler to extend than
Version B's untested scene code, just untestable for a different reason.

The visual cost-model asymmetry from the previous section reinforces the
same point from a different angle: Version A's "draw it every frame,
forever" model was cheap to extend when an entity was three filled paths,
and is measurably less cheap now that a house is 41-50. Version B's
"create it once, then reposition and let the display list keep it sorted"
model doesn't pay a per-frame tax for detail the way Version A's does. For
a game that stays about this visually simple, none of this changes the
day-to-day experience of extending either codebase much; for one that
keeps adding detail per entity, Version B's model has more headroom left
in it than Version A's.

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
   sort, or camera behaviour — the brief's own framing for what to listen
   for. **"Or just the art" is no longer a fair fourth option right now**:
   see the art-parity note near the top of this document. Version A has
   finished vector art and Version B still has placeholder boxes, so any
   difference that traces to "the art" today is a known, already-explained
   gap, not a discovery — it will need re-asking once Version B's art is
   ported.
2. **Frame time under load.** Chrome DevTools Performance panel, ten
   seconds of riding through a busy block (several hazards, houses, and
   in-flight papers on screen at once), median frame time for each version.
   Given the bundle-size and dependency gap above, it's plausible Version B
   costs more per frame even with fewer draw calls at steady state — plausible,
   not measured; only a real profile settles it.
3. **Visual/state agreement at the rendering layer — currently blocked on
   the art gap, not just unverified.** Ride both on seed `paperboy` through
   the first three blocks and confirm houses land in the same places, the
   same houses are subscribers, the same hazards appear in the same places,
   and the same throws score the same amount. The shared pure-logic layer
   (rider physics, streaming, landing, scoring) is bit-exact by the
   20,000-frame parity run above, and hazard position is now also shared by
   construction (`hazardPositionAt` in `@paperboy/game-core`, finding 2 of
   `final-fixes-report.md`) rather than independently re-derived — but that
   specific parity run predates the hazard fix and never exercised it, so
   "hazards appear in the same places" rests on the newer, narrower
   guarantee, not on the 20,000-frame number. What's unverified either way
   is whether each engine's *renderer* draws that shared state correctly —
   a wrong lane, a swapped colour, a depth-sort glitch that only shows up
   with specific entity overlaps. That check is still meaningful
   for *positions* (does a house/hazard/paper sit where the shared state
   says it should) even with mismatched art, but any comparison of how
   correct-looking or legible the two scenes are is not answerable until
   Version B's art matches Version A's — see the note near the top of this
   document.
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
