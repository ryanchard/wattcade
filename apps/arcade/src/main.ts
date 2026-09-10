/**
 * Wattcade: one page, one trainer connection, five games.
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
import type { RiderProfile } from '@paperboy/game-api';
import type { TrainerSource } from '@paperboy/trainer';
import type { GameModule, GameVariant, RunResult } from '@paperboy/game-api';
import { BAND_HEIGHT, drawBand, drawPaused } from './band.js';
import { CATALOG, gameById } from './catalog.js';
import { renderHub, resultsCard } from './hub.js';
import type { HubGame } from './hub.js';
import { browserPads, createPadInput } from './gamepad.js';
import type { PadFrame } from './gamepad.js';
import { loadGear, saveGear } from './gearing.js';
import { createInput, mergeKeys } from './input.js';
import { paintPoster } from './poster.js';
import { loadProfile, saveProfile, withEntries } from './profile.js';
import {
  FLAT_SIMULATION, clearRide, createRide, finishRide, isGeared, releaseRide,
  setCadence, setGear, setHidden, setPower, shiftDown, shiftUp, startRide,
  stopRide, tickRide, togglePaused,
} from './ride.js';
import {
  loadBoards, loadInitials, normaliseInitials, recordScore, renameEntry,
  saveInitials,
} from './scores.js';
import { loadStats, recordRun } from './stats.js';
import {
  cadenceState, createCadenceWatch, describeTrainer, noteCadence,
} from './trainerStatus.js';
import type { CadenceWatch, TrainerView } from './trainerStatus.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const sheet = document.getElementById('sheet') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;
const store = window.localStorage;

const ride = createRide();
const input = createInput(window);
/**
 * The controller. Polled, not subscribed: the Gamepad API has no button
 * events, so it is read once per frame from the same loop the keyboard is.
 */
const pads = createPadInput(browserPads(navigator));
/** The last poll, kept so the hub can say what is attached without polling
 * again from a render. */
let pad: PadFrame = pads.read();

let source: TrainerSource | null = null;
let trainer: TrainerView = describeTrainer(null, null);
/**
 * Whether this trainer reports cadence. Reset with the source, because it is
 * a fact about the machine currently on the other end and not about the page.
 */
let cadence: CadenceWatch = createCadenceWatch();
/** The cabinet only comes on once, however many times the hub is redrawn. */
let introDone = false;

let profile: RiderProfile = loadProfile(store);
// The gear the rider last left it in. Restored before the first frame, so a
// rider who found their gear yesterday is still in it today.
setGear(ride, loadGear(store));
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
window.addEventListener('resize', () => {
  resize();
  // The cards are fluid, so their art is redrawn at the new size rather than
  // stretched. Only when the hub is the thing on screen.
  if (ride.session === null && !overlay.hidden) paintPosters();
});
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
  cadence = createCadenceWatch();
  if (previous !== null) {
    previous.setSimulation(FLAT_SIMULATION);
    await previous.stop();
  }

  next.onStatus((s) => {
    trainer = describeTrainer(next.kind, s);
    // A dropped link must not leave the rider coasting forever on the last
    // reading — decay it toward zero the way stopping pedalling would.
    if (s.kind === 'disconnected' || s.kind === 'error') {
      setPower(ride, 0);
      // Cadence goes to "no reading", not to zero: a dropped link is not the
      // rider having stopped pedalling, and a cadence game should say so.
      setCadence(ride, null);
    }
    if (ride.session === null) showHub();
  });
  next.onSample((sample) => {
    setPower(ride, sample.power);
    setCadence(ride, sample.cadence);
    // Watched so the hub can warn, on the cards that are steered by it, that
    // this trainer has been asked for cadence and has not answered.
    noteCadence(cadence, sample.cadence);
  });
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
  sheet.className = introDone ? 'sheet hub' : 'sheet hub intro';
  introDone = true;
  sheet.innerHTML = renderHub({
    trainer,
    cadence: cadenceState(cadence),
    profile,
    stats: loadStats(store),
    scores: loadBoards(store),
    games: hubGames(),
    seed: seedText,
    pad: { connected: pad.connected, name: pad.name, standard: pad.standard },
    gear: ride.gear,
  });
  overlay.hidden = false;
  wireHub();
  paintPosters();
}

/**
 * Each card's art, drawn by the game that owns it at whatever size the
 * layout ended up giving the card. Nothing is cached: a poster is a few
 * dozen fills, it is drawn five times when the hub appears and on a resize,
 * and a stale bitmap would be a worse trade than redrawing it.
 */
function paintPosters(): void {
  const canvases = sheet.querySelectorAll<HTMLCanvasElement>('canvas[data-poster]');
  for (const node of Array.from(canvases)) {
    const game = gameById(node.dataset['poster'] ?? '');
    if (game !== null) paintPoster(node, game, window.devicePixelRatio || 1);
  }
}

function commitProfile(): void {
  const read = (id: string): string | undefined =>
    (document.getElementById(id) as HTMLInputElement | null)?.value;
  profile = withEntries(profile, {
    ftp: read('ftp'), mass: read('mass'), sprint: read('sprint'),
    wprime: read('wprime'),
  });
  saveProfile(store, profile);
}

function wireHub(): void {
  for (const id of ['ftp', 'mass', 'sprint', 'wprime']) {
    document.getElementById(id)?.addEventListener('change', commitProfile);
  }

  // Keystrokes typed into a box belong to the box. `[` is a perfectly good
  // character in a route name, and a rider naming a route should not find
  // that they have changed gear and had the page redrawn out from under them.
  for (const box of Array.from(sheet.querySelectorAll('input'))) {
    box.addEventListener('keydown', (e) => { e.stopPropagation(); });
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

/**
 * A shift. The gear is the shell's, so this is the only place it moves, and
 * it is written straight through to storage — a rider who found their gear
 * mid-race should not lose it because the tab closed before the hub redrew.
 */
function changeGear(up: boolean): void {
  const gear = up ? shiftUp(ride) : shiftDown(ride);
  saveGear(store, gear);
  // On the hub the gear is a line of copy rather than a HUD readout, so it
  // has to be redrawn to change. Only when the hub is the thing on screen.
  if (ride.session === null && !overlay.hidden) showHub();
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

  // The run goes on the board under the initials used last, and the card can
  // then say where it landed. The rider corrects the initials afterwards if
  // they are not theirs — which is the order an arcade does it in, and the
  // only order in which the place is news.
  const at = Date.now();
  const posted = recordScore(store, game.id, loadInitials(store), result, at);

  const nextId = result.nextVariantId ?? null;
  sheet.className = 'sheet card-only';
  sheet.innerHTML = resultsCard({
    game,
    result,
    nextId,
    nextName: nextId === null ? null : variantName(game, nextId),
    place: posted.place,
    initials: posted.entry?.initials ?? loadInitials(store),
  });
  overlay.hidden = false;
  input.setCapturing(false);
  wireInitials(game.id, at);

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

/**
 * The three-letter box on the results card.
 *
 * Keystrokes are stopped here rather than allowed to reach the shell: P is a
 * perfectly good initial, and a rider typing their name should not pause a
 * run that has already finished.
 */
function wireInitials(gameId: string, at: number): void {
  const box = document.getElementById('initials') as HTMLInputElement | null;
  if (box === null) return;
  box.addEventListener('keydown', (e) => { e.stopPropagation(); });
  box.addEventListener('input', () => {
    const typed = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (typed !== box.value) box.value = typed;
    if (typed === '') return;
    saveInitials(store, typed);
    renameEntry(store, gameId, at, typed);
  });
  // An emptied box is not a rider asking to be anonymous; it is a rider
  // part-way through retyping. Put the board's own default back.
  box.addEventListener('change', () => {
    if (box.value !== '') return;
    box.value = normaliseInitials('').trim();
    saveInitials(store, box.value);
    renameEntry(store, gameId, at, box.value);
  });
  box.select();
}

// --- the loop -------------------------------------------------------------

function frame(now: number): void {
  const dtSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  const { shell, game: typed } = input.read();
  pad = pads.read();
  // The pad speaks in key names, so a game is handed one set of keys and
  // cannot tell which hand produced them.
  const keys = mergeKeys(typed, pad.keys);
  const { width, height } = viewport();

  // Shifting works on the hub as well as mid-ride: a rider setting up should
  // be able to pick a gear before they clip in.
  if (shell.shiftUp || pad.shiftUp) changeGear(true);
  if (shell.shiftDown || pad.shiftDown) changeGear(false);
  // The band is the shell's; the game is rendered into what is left, so no
  // game ever has to know it is there.
  const stage = Math.max(1, height - BAND_HEIGHT);

  if (ride.session !== null) {
    // Both of these only ever set state. Neither writes to the trainer —
    // `tickRide` below is the single write, and it reads that state.
    if (shell.stop || pad.stop) stopRide(ride);
    if (shell.pause || pad.pause) togglePaused(ride);
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
      // The same cadence the session is handed, from the same field, so the
      // band can never disagree with the game it is sitting under.
      cadenceRpm: ride.cadenceRpm,
      // Null for a single-speed game, which is the honest reading: there is
      // no gear to see, not a gear sitting at zero.
      gear: isGeared(ride) ? ride.gear : null,
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

/**
 * A controller arriving or leaving while the rider is looking at the hub.
 * The frame loop notices either way — this is only so the hub's line changes
 * the moment it happens rather than the next time something else redraws it.
 */
for (const event of ['gamepadconnected', 'gamepaddisconnected']) {
  window.addEventListener(event, () => {
    pad = pads.read();
    if (ride.session === null && !overlay.hidden) showHub();
  });
}

showHub();
requestAnimationFrame(frame);
