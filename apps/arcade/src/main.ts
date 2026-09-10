/**
 * The arcade: one page, one trainer connection, three games.
 *
 * This is the only file in the project that touches Bluetooth, the DOM and
 * `requestAnimationFrame`. Everything it decides — what the trainer is told,
 * what the rider's numbers are, what the hub says — lives in modules beside
 * it that have no browser in them and are tested without one.
 */
import { dailySeed, randomSeed, seedFromString } from '@paperboy/game-core';
import {
  FtmsSource, KeyboardSource, createWebBluetoothConnector,
} from '@paperboy/trainer';
import type { RiderProfile, TrainerSource } from '@paperboy/trainer';
import type { GameModule, GameVariant, RunResult } from '@paperboy/game-api';
import { BAND_HEIGHT, drawBand, drawPaused } from './band.js';
import { CATALOG, gameById } from './catalog.js';
import { renderHub, resultsCard } from './hub.js';
import type { HubGame } from './hub.js';
import { createInput } from './input.js';
import { loadProfile, saveProfile, withEntries } from './profile.js';
import {
  FLAT_SIMULATION, clearRide, createRide, finishRide, releaseRide, setHidden,
  setPower, startRide, stopRide, tickRide, togglePaused,
} from './ride.js';
import { loadStats, recordRun } from './stats.js';
import { describeTrainer } from './trainerStatus.js';
import type { TrainerView } from './trainerStatus.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const sheet = document.getElementById('sheet') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;
const store = window.localStorage;

const ride = createRide();
const input = createInput(window);

let source: TrainerSource | null = null;
let trainer: TrainerView = describeTrainer(null, null);

let profile: RiderProfile = loadProfile(store);
let seedText = '';
/** What to start again when the rider asks for "again". */
let lastStart: { gameId: string; variantId: string | null; seed: number | null } | null = null;

let lastFrame = performance.now();

// --- the canvas -----------------------------------------------------------

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function resize(): void {
  const { width, height } = viewport();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// --- the trainer ----------------------------------------------------------

/**
 * The whole point of the shell. A trainer pairs to one application at a time,
 * so it is connected here, once, and every game rides on the same link — no
 * unpairing, no browser chooser, no getting off the bike to change game.
 */
async function useSource(next: TrainerSource): Promise<void> {
  const previous = source;
  source = next;
  if (previous !== null) {
    previous.setSimulation(FLAT_SIMULATION);
    await previous.stop();
  }

  next.onStatus((s) => {
    trainer = describeTrainer(next.kind, s);
    // A dropped link must not leave the rider coasting forever on the last
    // reading — decay it toward zero the way stopping pedalling would.
    if (s.kind === 'disconnected' || s.kind === 'error') setPower(ride, 0);
    if (ride.session === null) showHub();
  });
  next.onSample((sample) => { setPower(ride, sample.power); });
  await next.start();
}

// --- screens --------------------------------------------------------------

function hubGames(): readonly HubGame[] {
  return CATALOG.map((game): HubGame => ({
    game,
    variants: game.variants?.(store) ?? [],
  }));
}

function showHub(): void {
  sheet.className = 'sheet hub';
  sheet.innerHTML = renderHub({
    trainer,
    profile,
    stats: loadStats(store),
    games: hubGames(),
    seed: seedText,
  });
  overlay.hidden = false;
  wireHub();
}

function commitProfile(): void {
  const read = (id: string): string | undefined =>
    (document.getElementById(id) as HTMLInputElement | null)?.value;
  profile = withEntries(profile, {
    ftp: read('ftp'), mass: read('mass'), sprint: read('sprint'),
  });
  saveProfile(store, profile);
}

function wireHub(): void {
  for (const id of ['ftp', 'mass', 'sprint']) {
    document.getElementById(id)?.addEventListener('change', commitProfile);
  }

  const seedInput = document.getElementById('seed') as HTMLInputElement | null;
  seedInput?.addEventListener('input', () => { seedText = seedInput.value; });
  document.getElementById('daily')?.addEventListener('click', () => {
    seedText = String(dailySeed(new Date()));
    if (seedInput !== null) seedInput.value = seedText;
  });

  document.getElementById('connect')?.addEventListener('click', () => {
    commitProfile();
    void useSource(new FtmsSource(createWebBluetoothConnector()));
  });
  document.getElementById('keyboard')?.addEventListener('click', () => {
    commitProfile();
    void useSource(new KeyboardSource());
  });

  for (const button of Array.from(
    sheet.querySelectorAll<HTMLButtonElement>('[data-game]'),
  )) {
    button.addEventListener('click', () => {
      commitProfile();
      const game = gameById(button.dataset['game'] ?? '');
      if (game === null) return;
      begin(game, button.dataset['variant'] ?? null, seedFor(game));
    });
  }
}

function seedFor(game: GameModule): number | null {
  if (game.usesSeed !== true) return null;
  const raw = seedText.trim();
  if (raw === '') return randomSeed();
  return /^\d+$/.test(raw) ? Number(raw) : seedFromString(raw);
}

function begin(game: GameModule, variantId: string | null, seed: number | null): void {
  const session = game.create({
    profile,
    ...(seed === null ? {} : { seed }),
    ...(variantId === null ? {} : { variantId }),
    store,
  });
  startRide(ride, game, session);
  lastStart = { gameId: game.id, variantId, seed };
  input.setCapturing(game.controls.length > 0);
  overlay.hidden = true;
  lastFrame = performance.now();
}

function variantName(game: GameModule, id: string): string | null {
  const found = game.variants?.(store).find((v: GameVariant) => v.id === id);
  return found?.name ?? null;
}

function showResults(game: GameModule, result: RunResult): void {
  recordRun(store, game.id, result);
  const nextId = result.nextVariantId ?? null;
  sheet.className = 'sheet card-only';
  sheet.innerHTML = resultsCard({
    game,
    result,
    nextId,
    nextName: nextId === null ? null : variantName(game, nextId),
  });
  overlay.hidden = false;
  input.setCapturing(false);

  document.getElementById('again')?.addEventListener('click', () => {
    const start = lastStart;
    if (start === null) return;
    const again = gameById(start.gameId);
    if (again !== null) begin(again, start.variantId, start.seed);
  });
  document.getElementById('next')?.addEventListener('click', () => {
    begin(game, nextId, null);
  });
  document.getElementById('hub')?.addEventListener('click', () => {
    clearRide(ride);
    showHub();
  });
}

// --- the loop -------------------------------------------------------------

function frame(now: number): void {
  const dtSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  const { shell, game: keys } = input.read();
  const { width, height } = viewport();
  // The band is the shell's; the game is rendered into what is left, so no
  // game ever has to know it is there.
  const stage = Math.max(1, height - BAND_HEIGHT);

  if (ride.session !== null) {
    // Both of these only ever set state. Neither writes to the trainer —
    // `tickRide` below is the single write, and it reads that state.
    if (shell.stop) stopRide(ride);
    if (shell.pause) togglePaused(ride);
  }

  tickRide(ride, source, { dtSeconds, keys, width, height: stage });

  const session = ride.session;
  if (session === null) {
    ctx.fillStyle = '#0B0D10';
    ctx.fillRect(0, 0, width, height);
  } else {
    session.render(ctx, width, stage);
    if (ride.paused) drawPaused(ctx, width, stage);
    drawBand(ctx, {
      trainer,
      watts: ride.powerCurrent,
      elapsedS: ride.elapsedS,
      lines: session.hud(),
    }, width, height);

    const result = finishRide(ride, store);
    if (result !== null && ride.game !== null) showResults(ride.game, result);
  }

  requestAnimationFrame(frame);
}

// --- letting go of the trainer --------------------------------------------

/**
 * The page is going away. Set the state that makes every subsequent
 * `effectiveSimulation` flat, AND write flat directly, because there may
 * never be another frame to do it in.
 */
function release(): void {
  releaseRide(ride);
  source?.setSimulation(FLAT_SIMULATION);
  void source?.stop();
}
window.addEventListener('beforeunload', release);
// beforeunload does not fire reliably on mobile or bfcache navigations.
window.addEventListener('pagehide', release);

/**
 * Backgrounding the tab, or letting the screen sleep, can stop rAF entirely —
 * which would leave the last grade applied indefinitely with nobody on the
 * bike. Setting hidden makes the loop's own single write flat if it runs
 * again; the direct write covers the case where it does not.
 *
 * This lifts itself on return rather than latching, because pausing is the
 * rider's decision and P is how they make it.
 */
document.addEventListener('visibilitychange', () => {
  setHidden(ride, document.hidden);
  if (document.hidden) {
    source?.setSimulation(FLAT_SIMULATION);
  } else {
    lastFrame = performance.now();
  }
});

showHub();
requestAnimationFrame(frame);
