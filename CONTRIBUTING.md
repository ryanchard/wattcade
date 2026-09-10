# Contributing

The README covers what Wattcade is and how to run it. This file is only the
things that are easy to break without noticing.

## The invariant that matters

**The shell makes exactly one write to the trainer per frame, and that write
is a flat road whenever the rider is not actively being asked to push against
something.**

This is not a style preference. An earlier version of this project let each
game talk to the trainer directly, and shipped a safety key whose zero was
overwritten milliseconds later by the game's own write loop — the panic button
did nothing. `apps/arcade/src/ride.ts` and its tests exist to make that
impossible, and `apps/arcade/test/ride.test.ts` is the file to read before
changing anything in the write path.

Consequences worth stating outright:

- A game never calls `setSimulation`, never opens a GATT connection and never
  imports anything that does. It returns the road it *wants* from
  `simulation()`, and `effectiveSimulation` decides what is really sent.
- Grade is clamped to ±8% in `packages/trainer/src/ftms/controlPoint.ts`, in
  the encoder, not at the call sites. Do not move the clamp outward and do not
  add a second path that skips it.
- If you add a new reason the rider should not be under load — a menu, a
  countdown, anything — add it to `isUnderLoad`, not to a game.

## Where code goes

- Bluetooth, FTMS and physics live in `packages/trainer`. Nothing else does
  any of those things.
- Anything the shell and a game both need to agree on is a type in
  `packages/game-api`, which is types only and has no runtime behaviour to get
  wrong.
- A game is a `GameModule` in its own package and knows nothing about the
  trainer, the DOM, the clock or `requestAnimationFrame`.

Anything drawn once for every game — the status band, the pause banner, the
results card — belongs to `apps/arcade`, implemented once. Five copies of a
watts readout is five chances for them to disagree.

## Style

- TypeScript strict. No `any`, and no `as` used to get around a real type
  error.
- No new runtime dependencies without a reason worth writing down. The arcade
  currently has no third-party ones at all, which is why it builds in under a
  second and works from a file:// URL.
- Comments explain *why*. The code already says what.

## Before you open a pull request

```sh
npm test
npm run typecheck
npm run build
```

All three must be clean. Tests run headless in Node — no browser, no trainer —
so there is no excuse for skipping them. If a change genuinely needs hardware
to verify, say so in the PR rather than implying it was ridden.

If you have a trainer that is not a Wahoo KICKR, the single most useful thing
you can contribute is a capture: run `tools/ble-probe`, and commit the result
as `packages/trainer/test/fixtures/kickr-capture.json`. There is already a
test waiting for it that turns itself on when the file exists.
