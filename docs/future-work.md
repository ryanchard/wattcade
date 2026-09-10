# Future work

Notes from riding the games, in rough priority order. Each item says what was
observed, why it matters, and what it would take. Nothing here is scheduled.

---

## 1. Virtual shifting, and controller support — SHIPPED

Kept here rather than deleted, because the numbers are the interesting part
and the next person to touch the mapping will want them.

**Observed:** "I can't get watts up without more resistance."

**Why it happened.** In FTMS simulation mode the trainer computes its own load
from the parameters we send — grade, wind speed, rolling resistance, wind
coefficient — combined with *its* measurement of wheel speed. On a flat track
at grade 0 there is very little to push against, so producing a big number
meant spinning absurdly fast rather than pressing hard. The cadence games made
it worse deliberately: they send `cw 0.28` precisely so that spinning is
cheap, which is right for steering and wrong for effort. A rider with real
gears works around this by shifting up; a rider on a Zwift Cog or a fixed
sprocket cannot.

**What shipped.** A twelve-speed block owned by the shell (`apps/arcade/src/
gearing.ts`), applied in `effectiveSimulation` to whatever a game's
`simulation()` returns. Neutral is gear 4 and is the identity — the same
object, not merely an equal one — so a rider who never shifts gets exactly
what each game's author tuned. Each gear is 18% taller than the one below,
which is about one sprocket.

Two levers, because one is not enough:

- `cw` is multiplied by the ratio. This is the honest one — it is what a
  taller gear does on the road — but drag goes as v², so at the speeds
  Paperboy runs at it is worth little and at a standstill nothing.
- a small grade contribution, `1.3 × (ratio − 1)` percent, which is
  speed-independent and bites the moment the cranks turn. One-sided on
  purpose: a tall gear tilts the road up, a low gear only thins the air. The
  game chose its road, and gearing may make it harder to turn the pedals
  without turning one of Paperboy's climbs into a descent.

`crr` is untouched. It is the surface the game picked — Paperboy's lawns
against its tarmac, The Pack's dogs — and a gear that turned grass into road
would be changing the game rather than the load.

What that is worth, as watts requested at a fixed wheel speed from a flat
`grade 0, crr 0.005, cw 0.51` for an 85 kg rider:

| gear | ratio | +grade |  4 m/s |  8 m/s | 15 m/s |
| ---: | ----: | -----: | -----: | -----: | -----: |
|    1 |  0.61 |   0.0% |   27 W |  113 W |  586 W |
|    4 |  1.00 |   0.0% |   33 W |  164 W |  923 W |
|    8 |  1.94 |   1.2% |   89 W |  368 W | 1884 W |
|   12 |  3.76 |   3.6% |  198 W |  763 W | 3746 W |

Top gear is ~6× neutral at 4 m/s and ~4× at 15. Scaling `cw` alone would have
been 2.4× and 3.6×, and at 2 m/s barely 1.5× — which is the whole argument for
the grade term, and there is a test asserting the split.

**The clamp is still the last word.** `applyGear` runs its grade through
`clampGrade` and `encodeSimulationParams` clamps again. Paperboy's steepest 6%
plus the top gear saturates at 8% and stays there. The gear is applied inside
the under-load test, so pause, a hidden tab, the page unloading and the safety
stop all still return the frozen flat value whatever gear the rider is in.

**Spin Cycle and Fish opted out** through `GameModule.singleSpeed`. Cadence is
the steering wheel in both, and a gear that made spinning expensive would make
steering cost a sprint — the exact trade both were built to avoid.

**Controller support** came with it (`apps/arcade/src/gamepad.ts`): polled once
a frame from the shell's own loop, translated into the same key names the
keyboard produces, so no game had to learn what a gamepad is. Shoulders and
triggers shift, the d-pad or left stick steers, South or West throws, Start
pauses, Select or East stops. A pad the browser could not map gets the first
axis and the first button and nothing else, because an index means nothing on
an unknown layout.

**Still to confirm on hardware.** Nobody has ridden it. Whether 18% a gear is
the right step, whether neutral at 4 leaves enough low range, and whether the
shoulder buttons are where a rider's fingers actually land with a pad bungeed
to the bars — all of that wants a ride and a controller.

---

## 2. The velodrome is too easy — FATIGUE SHIPPED

**Observed:** "I won every race first time."

That was a real failure of the ladder: the rivals scale off FTP, every race
finishes in a sprint, and a rider with a high sprint-to-FTP ratio out-kicked
all six regardless of whether they read any of the patterns. Nothing anyone
spent ever ran out — both riders' kilojoules were tracked and then read
exactly once, at the end, for the results card.

**What shipped: W′, for the player and for every rival.**
`@paperboy/game-core`'s `fatigue.ts` is the critical-power model — a finite
anaerobic store that drains at exactly `(P − CP)` above threshold, refills
below it, and takes the sprint away when it is gone. It is shared, pure and
headless for the same reason `classifyLanding` and `isHazardActive` are: a
game and a rival must run the identical implementation or the tactics are
dishonest.

Recovery is **not** the mirror of depletion. Depletion is bookkeeping;
refilling is physiology and much slower. It uses Skiba's reconstitution —
exponential toward full with `tau = 546·e^(−0.01·DCP) + 316` seconds, where
DCP is how far below CP the rider has dropped — so soft-pedalling just under
threshold barely refills anything and stopping dead refills fastest. The one
liberty is `RECOVERY_TAU_SCALE = 1/3`: Skiba's constants are fitted to
interval sessions of many minutes and a race here is seventy seconds, and at
the published tau twenty seconds of shelter returns about 3% of the deficit,
which would make "recover in their draft between the attacks" — a counter this
game prints on its own results card — unimplementable.

**Nobody was asked for a third number.** W′ is seeded from the FTP and sprint
already on the profile, because sprint-to-FTP ratio is exactly what FTP cannot
tell you: 22.0 kJ for a 235 W rider who sprints at 1184 W, 15.0 kJ for the
200/700 default. The box is editable for anyone who has had theirs measured,
and a store the rider has not touched keeps tracking the two numbers it is
seeded from.

**A spent rider fades.** `sustainablePower()` scales the watts above CP down
toward CP over the last fifth of the store, and the drain is taken from the
faded power rather than the demanded power, so the tail is exponential: a
949 W kick on the last fifth of a 22 kJ store sags away over about fifteen
seconds rather than switching off. Both riders go through it. That is the
mechanism that makes "force the pace" real.

**Sitting in became a saving rather than only a speed bonus.** A rival's base
curve is now read as an intended pace, and `RIVAL_SHELTER_BANK = 0.5` splits
what the wheel in front is worth — half into closing on it, half into the
tank. All of it as speed was the old behaviour and is why a rival could never
be worn down; all of it as energy is worse, because a scripted rival glued to
your wheel at exactly your pace would never come past and leading a whole race
would cost nothing. The saving is subtracted in watts (`draftSavingWatts`)
rather than scaled off the demand: only the air term moves, and a scaled
demand had a sheltered rival accelerating slower than the rider it was sitting
on and dropping the wheel in the first ten seconds of every race.

**Two archetypes now read their own state.** The Wheelsucker will not spend
what it has left to hold a wheel, so forcing the pace is at last a way to get
rid of it. The Champion goes when the rider is spent, and does not answer an
attack she cannot afford.

What a race costs the owner (FTP 235, 22.0 kJ), simulated:

| plan | Diesel | Flyer | Attacker | Feinter | Wheelsucker | Champion |
| --- | --- | --- | --- | --- | --- | --- |
| sit in, kick at 200 m | won, 40% | lost | lost | lost | won, 40% | won by 0.2 m, 41% |
| cover every move, then kick | won, 40% | won, 48% | won, 54% | won, 48% | won, 85% | won, 50% |
| even tempo, no kick | won, 0% | won, 0% | won, 0% | won, 0% | lost | lost |

One kick is 40% of the store, which is the whole point: it is still there, and
it is now the only one you get. The same three plans on a diesel's profile —
same FTP, a 550 W sprint, a 14.4 kJ store — lose the Champion by 21 m instead
of winning by 0.2, and have to win on pacing instead.

**Still to confirm on hardware.** Nobody has ridden it. `RECOVERY_TAU_SCALE`
and `FADE_FROM_FRACTION` are the two that will want moving, and the thing to
watch is whether the last lap feels like legs going or like a slider closing.

**Difficulty levels are still worth having** — scaling rival power and
aggression by a chosen tier — but they treat the symptom, and a harder Diesel
is still beaten by the same one kick.

---

## 3. A final level: all six rivals at once

The natural top of the ladder, and it is the race the current design most
wants. Six riders means a bunch, and a bunch means the draft finally behaves
like it does in real racing: shelter deep in the group, wind on the front,
someone always willing to chase.

It also makes the archetypes interact rather than take turns — the Flyer goes
early, the Attacker bridges, the Wheelsucker sits on whoever is strongest, and
the Champion watches. That is a race, not a duel.

**Effort:** larger than it looks. The race model currently assumes exactly two
riders. Generalising to N means per-rider drafting off whoever is directly
ahead, tactics that consider a field rather than one opponent, and a
side-on view that stays readable with seven bodies in it. Best attempted after
W′, since without a fatigue model a bunch race is decided by the same one kick.

---

## 4. Distance options

Default 1 km, with longer options. Straightforward and clearly right — a
kilometre is a sprint, and the tactical archetypes have more room to express
themselves over 4 km than over four laps.

**Effort:** small. Race distance is already a constant. It needs the choice
surfacing in the UI, rival power curves expressing themselves in proportional
rather than absolute time, and separate high scores per distance so a 1 km
result never competes with a 4 km one.

**Worth noting:** longer races make the fatigue model matter more, not less.
Over 4 km, pacing is the whole game.

---

## 5. The card layout is lopsided

**Observed:** the velodrome's card is bigger than the others because it carries
the rival ladder, so the hub looks unbalanced.

**Suggested fix, and it is the right one:** move rival selection *into* the
game. Every card becomes the same size, the hub stays a clean grid, and the
velodrome gets a proper start screen where choosing an opponent — and, once
they exist, a difficulty and a distance — belongs anyway.

This generalises: any game with pre-ride options should own that screen rather
than pushing it onto the hub. The hub's job is to pick a game and show the
trainer's state.

**Effort:** small to moderate, and it makes the arcade contract slightly
richer: a game may optionally provide a setup screen shown before the ride
starts.

---

## Also outstanding

- **Screenshots.** `docs/images/` is empty and the README has a section
  waiting.
- **The KICKR conformance test is still skipped.** Running the probe
  (`tools/ble-probe`) once and committing the capture would turn the README's
  "tested on a Wahoo KICKR" from a claim into something the suite checks.
- **Neutral cadence is hard-coded at 80 rpm** in Spin Cycle and Fish. A rider
  whose natural spin is 70 or 95 fights both games from the first second.
  Either calibrate from the opening seconds or put it on the rider profile.
- **A shared leaderboard.** Scores are per-browser `localStorage`, so the
  rivals are named after real people who cannot actually compete. This is the
  first feature that would need a backend, however small.
