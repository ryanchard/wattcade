# Wattcade

Small arcade games you play by pedalling an indoor smart trainer, in a
browser, over Web Bluetooth. Your watts and your cadence are the controller:
the browser reads them off the trainer and the games read them instead of a
gamepad. If you already own a turbo trainer for Zwift or Rouvy — a Wahoo
KICKR, a JetBlack, anything that speaks FTMS — this is a little game to play
around with on it. It is not a training platform and does not try to be: five
small games, built quickly and barely tuned.

The trainer is an output as well as an input. Each game declares the road it
wants — a grade, a headwind — and the shell sends that back down to the
trainer, so a hill gets heavier under your legs and slipping into somebody's
draft goes quiet. The resistance is the point; the pictures are there to tell
you why it changed.

**You do not need a trainer to try it.** There is a keyboard fallback: hold
`W` and the app synthesises power and cadence, so all five games are playable
on a laptop with no hardware at all. Nothing will push back at you, but
everything runs.

> **A note on the name.** The internal packages are still scoped
> `@paperboy/*`, and a working copy may well sit in a directory called
> `PaperBoy`. That is where this started — one game — and it grew into five.
> The product is Wattcade. Nothing has been renamed on disk, so the mismatch
> is expected rather than a mistake.

## The games

| Game | What you do | Controlled by | Wants cadence | Wants resistance |
| --- | --- | --- | --- | --- |
| Paperboy | Ride the round before sunrise and hit the subscribers' porches. | Power, plus left/right and space | – | Yes |
| The Pack | Dogs latch on and drag you back; sprint above your FTP long enough to throw one off. | Power only | – | Yes |
| Velodrome | Four laps against a rival, up a ladder of six. Sit in their shelter and the air costs you about 26% less. | Power only | – | Yes |
| Spin Cycle | Fly a pedal-powered flying machine. Spin faster to climb, slower to sink, 80 rpm to hold level. | Cadence | Yes | – |
| Fish | You are a fish. Cadence is your depth. Eat anything smaller than you; get away from anything bigger. | Cadence | Yes | – |

Paperboy is the only game with buttons. The Pack and Velodrome are legs-only
by construction: they declare no controls, so the shell never forwards a
keystroke to them at all.

Games marked as wanting cadence are unplayable on a trainer that reports power
and nothing else — some do. Games marked as wanting resistance still run on a
read-only trainer, but the thing they are about goes missing: Velodrome's
draft is the trainer easing off, and if it cannot ease off there is not much
race left. The hub warns you on the relevant cards once it knows what your
trainer can do, rather than letting you find out four minutes into a climb.

Every game sits under the same status band, drawn by the shell: what the
trainer can do, your watts, your cadence, and the clock, always in the same
places. Cadence shows an em dash rather than a zero when the trainer reports
none, because "not pedalling" and "this machine has no cadence sensor" are
different facts.

## What you need

- **An indoor smart trainer that speaks FTMS** (the Bluetooth Fitness Machine
  Service). Almost every turbo trainer sold in the last several years does —
  the same machines people ride with Zwift and Rouvy.
- **Chrome or Edge**, on desktop. Safari and Firefox do not implement Web
  Bluetooth and are not supported — there is no polyfill and no workaround;
  the pairing button simply cannot exist there. On Linux you may also need
  `chrome://flags/#enable-experimental-web-platform-features`.
- **A secure context.** Web Bluetooth needs HTTPS or `localhost`. The dev
  server and a GitHub Pages URL both qualify.
- **Nothing else holding the trainer.** A trainer pairs to one application at
  a time. Close Zwift, close the manufacturer's app, and close any other tab
  running Wattcade before you connect.

### Which trainers work

Wattcade speaks standard FTMS, not any manufacturer's proprietary protocol, so
any trainer that advertises the Fitness Machine Service should work.

It has been ridden on a **Wahoo KICKR**. That is the only hardware confirmed.
A **JetBlack** should work and has not been tested — like every other FTMS
trainer named here, that is a prediction rather than a claim.

Two capabilities decide how much of Wattcade you actually get, and trainers
differ on both:

- **Cadence.** Some report power and nothing else. Spin Cycle and Fish steer
  on cadence and are unplayable without it.
- **Simulation-parameter writes.** Some expose FTMS read-only. Paperboy, The
  Pack and Velodrome still run, but the resistance is the thing they are
  about, so a read-only trainer takes most of them away.

If you ride Wattcade on anything that is not a KICKR, an issue saying what
happened — working or not — is genuinely useful; the most useful version of it
is a capture from `tools/ble-probe`.

## Quick start

```sh
git clone https://github.com/ryanchard/wattcade.git
cd wattcade
npm install
npm run dev
```

Open the URL it prints — `http://localhost:5185` — enter your FTP, sprint
power and weight, then either connect a trainer or press **Ride from the
keyboard** and hold `W`. If you have a gamepad, plug it in first: its shoulder
buttons are the shift paddles, and the hub will say what it can see.

Running the checks:

```sh
npm test         # the whole suite, headless, no browser and no hardware
npm run typecheck
npm run build    # production build of the arcade into apps/arcade/dist
```

One test is skipped by design: it decodes a recorded KICKR capture, and
activates by itself if somebody runs the probe in `tools/ble-probe` and
commits one.

## Safety

This software changes the resistance of a machine you are sitting on, so the
rules it follows are worth stating plainly.

- **Grade is clamped to ±8%** in the FTMS encoder itself, on every path. There
  is no code route that can ask the trainer for a steeper hill, because the
  clamp is not in the games or in the shell — it is in the last function
  before the bytes go out.
- **Escape stops the ride and P pauses it.** Both work in every game, and
  both leave the trainer flat. They belong to the shell, not to the games, so
  no game can fail to implement them. A connected gamepad has both as well —
  Start pauses, Select or B stops — because a rider who needs to stop should
  not have to reach for a keyboard.
- **The virtual gear cannot reach past the clamp.** The shell keeps a
  twelve-speed block (neutral at 4) and multiplies whatever load a game asks
  for before it reaches the trainer, so a rider on a single sprocket can still
  find a resistance their legs agree with. It is applied inside the same
  under-load test as everything else, so a pause, a hidden tab or the safety
  stop still send flat whatever gear you are in, and its grade goes through
  `clampGrade` on the way out. Shift with a controller's shoulder buttons, or
  `[` and `]`. Spin Cycle and Fish are single-speed on purpose: cadence steers
  them, and steering must stay cheap.
- **One write per frame, and flat whenever you are not being asked to push.**
  Paused, finished, tab hidden, screen asleep, page closing: every one of
  those makes the value sent a flat road, regardless of what the game asked
  for. An earlier version of this project let each game write to the trainer
  itself, and shipped a panic key whose zero was overwritten milliseconds
  later by the game's own loop. That is why the shell now owns every write,
  and why `apps/arcade/test/ride.test.ts` exists.
- **The honest limit:** the reset on page close is best-effort. A browser will
  not wait for a Bluetooth write while it is unloading a page, so if you close
  the tab mid-climb the trainer may keep the last grade it was given. It is
  clamped, so it will not be dangerous, but it may feel stuck. Reconnect —
  connecting sends a flat road — or power-cycle the trainer, and it clears.

None of this makes a bike trainer a safe place to stop concentrating. Warm up,
and get off the bike the way you normally would.

## How it is built

An npm workspace, TypeScript throughout, strict mode, no framework and no
third-party runtime dependencies in the arcade.

| Path | What lives there |
| --- | --- |
| `packages/trainer` | Everything Bluetooth: GATT, FTMS decoding, the control-point writer, the road physics. |
| `packages/game-api` | Types only. The contract between the shell and a game. |
| `packages/game-core` | Shared game plumbing: seeded RNG, persistence, difficulty. |
| `packages/game-*` | The five games. |
| `apps/arcade` | The shell. One page that owns the trainer and hands it to a game. |
| `apps/phaser` | A second build of Paperboy on Phaser 3, kept as a comparison artifact. Not in the arcade. |
| `tools/ble-probe` | A scratch page for reading what a trainer actually advertises. |

The split exists for one reason: **no game touches Bluetooth.** A game does
not open a connection, does not write to the trainer, does not call
`requestAnimationFrame`, does not read the clock and does not touch the DOM
beyond the canvas context it is handed. It advances when told, draws when
told, and *declares* the resistance it would like. The shell decides what is
actually sent, because the shell is the only thing that knows whether you are
paused, whether the tab is hidden, or whether anybody is on the bike.

The practical payoff is that the games are pure functions of power, cadence
and time, so the entire suite runs in Node with no browser and no hardware.

## Adding a game

Implement `GameModule` from `@paperboy/game-api`, add it to
`apps/arcade/src/catalog.ts`, and you are done. The shell handles the frame
loop, the fixed-step timing, the power easing, the trainer connection, the
pause and stop keys, the status band, the results card and the high score
table.

```ts
export interface GameModule {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** True when this game is materially worse without resistance control. */
  readonly needsResistance: boolean;
  /** True when this game steers on cadence. */
  readonly needsCadence?: boolean;
  /** True when this game's load is its design and the shell must not gear it. */
  readonly singleSpeed?: boolean;
  /** Empty means legs only, and the shell forwards no keyboard at all. */
  readonly controls: readonly ControlHint[];
  readonly palette: GamePalette;
  create(opts: GameCreateOptions): GameSession;
}

export interface GameSession {
  /** One fixed substep, with power the shell has already eased. */
  advance(dtSeconds: number, powerWatts: number): void;
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  /** The road this game WANTS. The shell decides what is really sent. */
  simulation(): SimulationParams;
  readonly isOver: boolean;
  stop(): void;
  result(): RunResult;
  hud(): readonly HudLine[];
  /** Optional: real time for parallax and camera, never for gameplay. */
  animate?(dtSeconds: number, width: number, height: number): void;
  /** Optional, and only forwarded if `controls` is non-empty. */
  handleKeys?(keys: GameKeys): void;
  /** Optional: cadence in rpm, or null when the trainer reports none. */
  setCadence?(rpm: number | null): void;
}
```

The full contract, with the reasoning behind each field, is in
[`packages/game-api/src/index.ts`](packages/game-api/src/index.ts). Games can
also draw their own poster for the hub card and offer pre-run variants; both
are optional.

## Status, honestly

These are working prototypes built quickly, not a product.

- The games are barely tuned. Numbers were picked to be roughly plausible and
  then left alone.
- Most of them have never been properly ridden. Anything below about "it runs
  and the maths is tested" is an untested claim.
- There is no fatigue model. Nothing in any game knows or cares that you went
  too deep four minutes ago, so pacing — the actual skill in cycling — costs
  you nothing yet. This is the biggest gap.
- The high score table is per-browser `localStorage`. There is no account, no
  server and no sync.

## Canvas versus Phaser

Paperboy was deliberately built twice — once by hand in Canvas 2D, once on
Phaser 3 — over the same physics and rules packages, so that the only
differences were engine decisions. [`docs/superpowers/bake-off.md`](docs/superpowers/bake-off.md)
is the write-up: bundle sizes, line counts, what each engine gave for free and
what it charged for, and an explicit account of which claims are measurements
and which are not. Worth reading if you are weighing a 2D engine against
writing it yourself.

## Deploying

`.github/workflows/deploy.yml` builds the arcade and publishes it to GitHub
Pages on every push to `main`.

**It will not deploy until you enable Pages by hand:** repository
**Settings → Pages → Source: GitHub Actions.** Until that is set the workflow
runs, builds, and fails at the deploy step.

Vite's `base` is `'./'`, so the bundle works from any path — which a project
site needs, being served from `user.github.io/<repo>/` rather than a domain
root. A useful side effect: the built `index.html` also works opened directly
as a file, so a downloaded copy is playable on the keyboard. Web Bluetooth
needs a secure context, so a real trainer still requires the hosted URL or
`localhost`.

### Repository settings

GitHub's description and topics cannot be set from a file in the repository,
and they are what its own search reads. Settings → General for the first,
the gear beside **About** for the second. Suggested, and accurate:

Description:

```
Small arcade games you play by pedalling an indoor smart trainer — power and cadence as the controller, FTMS over Web Bluetooth, with a keyboard fallback.
```

Topics:

```
indoor-cycling, smart-trainer, turbo-trainer, ftms, web-bluetooth,
bluetooth-low-energy, wahoo-kickr, browser-game, canvas, typescript, exergaming
```

## Screenshots

There are none yet. `docs/images/` is where they go when somebody with a
screen and a pair of legs takes them.

## Trademarks

Wahoo, KICKR, JetBlack, Zwift and Rouvy are trademarks of their respective
owners, named here only to say what Wattcade connects to and what people
already ride; there is no affiliation with or endorsement by any of them.

## Licence

MIT. See [LICENSE](LICENSE).
