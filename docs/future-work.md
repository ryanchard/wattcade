# Future work

Notes from riding the games, in rough priority order. Each item says what was
observed, why it matters, and what it would take. Nothing here is scheduled.

---

## 1. Virtual shifting, and controller support

These arrived as two separate notes and are really one feature.

**Observed:** "I can't get watts up without more resistance."

**Why it happens.** In FTMS simulation mode the trainer computes its own load
from the parameters we send — grade, wind speed, rolling resistance, wind
coefficient — combined with *its* measurement of wheel speed. On a flat track
at grade 0 there is very little to push against, so producing a big number
means spinning absurdly fast rather than pressing hard. The games make this
worse deliberately: the cadence games send `cw 0.28` precisely so that
spinning is cheap, which is right for steering and wrong for effort.

A rider with real gears can work around this by shifting up. A rider on a
single-speed setup — a Zwift Cog, a fixed sprocket, a direct-drive with one
gear — cannot, and is stuck at whatever load the game asks for.

**The fix is a virtual gear.** Keep a gear ratio in software, multiply the load
we request by it, and let the rider change it mid-ride. The rider then finds a
gear where their comfortable cadence produces the power they want, exactly as
they would on the road. This is what Zwift's Click and Play hardware does.

**And this is why the controller note belongs here.** Shifting needs two
inputs, and the whole design rule of these games is that hands are busy and
effort is hard — so keyboard shifting is no good. A cheap Bluetooth gamepad
bungeed to the bars gives shift paddles exactly where a rider expects them.
The Gamepad API is straightforward and the arcade shell already owns input, so
it is one implementation for every game.

**Effort:** moderate. The gear multiplier is small — a value in the shell,
applied to whatever `simulation()` a game requests, before `clampGrade`. The
gamepad layer is a self-contained addition to the shell. The fiddly part is
deciding what a "gear" means for each game: on the velodrome it should feel
like a real gear, while in Fish it probably should not exist at all.

**Careful with:** the ±8% clamp stays absolute. A gear multiplier must never be
able to push past it, and the panic key must still flatten the trainer
regardless of gear.

---

## 2. The velodrome is too easy

**Observed:** "I won every race first time."

That is a real failure of the ladder, and the cause is already understood. The
rivals scale off FTP, every race finishes in a sprint, and a rider with a high
sprint-to-FTP ratio out-kicks all six regardless of whether they read any of
the patterns. The tactical game the ladder was built around never has to
happen.

**The fix is the fatigue model (W′), not harder rivals.** Making the rivals
faster would just make the sprint start earlier. What is missing is that
nothing you spend ever runs out:

- A full-gas finish costs roughly 39% of a typical anaerobic battery.
- Covering all five of one rival's attacks costs about 34%.

So with W′ in place you physically cannot both police a race and win the
sprint — which is the decision the ladder was supposed to be about. It also
fixes the Flyer, whose entire lesson is "do not chase" but who currently
punishes chasing not at all.

**Effort:** moderate, and it touches the shared physics rather than one game.
It needs a W′ value on the rider profile (seedable from FTP and sprint power),
depletion above threshold, recovery below, and a HUD readout. Then a
ride-and-tune loop, because the numbers only mean something once felt.

### The rivals need a battery too, not just the player

Verified in the code, and it is worse than "the player's sprint is free".

Drafting *is* modelled symmetrically — a rival on your wheel gets exactly the
shelter you would, and the source says so: "model it symmetrically or the
tactics are dishonest". But neither side has anything that depletes. Both
riders' kilojoules are tracked and then read exactly once, at the end, to
compute average power for the results card. Nothing feeds back into
behaviour.

So a rival cannot be worn down. Drag one round the track at 400 W for four
laps and it finishes as fresh as one that sat in the whole way. The saving a
rival banks by drafting is a speed bonus in the moment, not a stored
resource, because there is no store.

**This makes one of the six counters fiction.** Ryan the Wheelsucker is
described as beatable by "force the pace, or play chicken and jump before they
do". The first half cannot work — there is no mechanism by which forcing the
pace costs them anything. Only the timing half functions, and the game is
advertising a tactic it does not implement.

Forcing the pace, wearing someone down, making them chase, sitting in to save
yourself: none of that vocabulary means anything until BOTH sides have a
finite battery. W' is therefore not just a difficulty fix for the player — it
is what makes the rivals' stated counters true.

**Difficulty levels are the cheaper alternative** and worth having anyway —
scaling rival power and aggression by a chosen tier. But they treat the
symptom. A harder Diesel is still beaten by the same one kick.

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
