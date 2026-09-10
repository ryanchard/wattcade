import Phaser from 'phaser';
import {
  dailySeed, loadStats, randomSeed, recordRun, seedFromString,
} from '@paperboy/game-core';
import {
  FtmsSource, KeyboardSource, createWebBluetoothConnector,
} from '@paperboy/trainer';
import type { TrainerSource } from '@paperboy/trainer';
import { FLAT_SIMULATION } from './logic/run.js';
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
  if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();

  // OS auto-repeat fires a stream of keydowns while a key is held. Steering
  // reads the held set so it is unaffected, but an edge-triggered throw would
  // rapid-fire — which is the exact thing edge-triggering exists to prevent.
  if (e.repeat) return;

  if (e.key === ' ') street.setInput({ steer: readSteer(), throwPaper: true });
  if (e.key === 'p' || e.key === 'P') {
    if (street.run !== null) street.run.paused = !street.run.paused;
  }
  // Escape does NOT write to the trainer here. It sets state; the single
  // authoritative setSimulation below sends the flat value. Writing zero here
  // would be overwritten by that call before the 4 Hz flush ever fired.
  if (e.key === 'Escape' && street.run !== null) street.run.paused = true;
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());

const readSteer = (): number =>
  (held.has('ArrowLeft') ? -1 : 0) + (held.has('ArrowRight') ? 1 : 0);

// Steering is read once per rendered frame from inside StreetScene.update(),
// not latched from this 30 Hz interval — that would quantise it to ~33 ms
// steps, unlike Version A's per-frame input poll. Throwing stays edge-
// triggered via the keydown handler above.
street.setSteerSource(readSteer);

setInterval(() => {
  const run = street.run;
  if (run === null) return;
  // Exactly one setSimulation per tick, and it must be the last word: the
  // writer coalesces to the newest value, so an earlier zero would be lost.
  source?.setSimulation(run.effectiveSimulation());
  if (run.gameOver) endRun();
}, 1000 / 30);

async function useSource(next: TrainerSource): Promise<void> {
  await source?.stop();
  source = next;
  next.onSample((s) => street.run?.setPower(s.power));
  next.onStatus((s) => {
    // Without this the rider coasts forever on the last reading after a
    // mid-ride disconnect, because samples simply stop arriving.
    if (s.kind === 'disconnected' || s.kind === 'error') street.run?.setPower(0);
  });
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
  // Leave the trainer relaxed while the summary is up. Once street.run is
  // null the interval above stops touching it entirely.
  source?.setSimulation(FLAT_SIMULATION);
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

function releaseTrainer(): void {
  source?.setSimulation(FLAT_SIMULATION);
  void source?.stop();
}
window.addEventListener('beforeunload', releaseTrainer);
// beforeunload does not fire reliably on mobile/bfcache navigations —
// pagehide is the belt to its suspenders.
window.addEventListener('pagehide', releaseTrainer);

// Backgrounding the tab (or letting the screen sleep) must not leave
// resistance applied indefinitely. Pausing makes the 30 Hz interval above
// send FLAT_SIMULATION on its own (run.effectiveSimulation() while
// run.paused), but that interval is throttled in a hidden tab, so the
// direct call here relaxes the trainer immediately rather than waiting on
// whatever the throttled interval's next tick happens to be. This does NOT
// auto-unpause on return — that choice belongs to the rider.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || street.run === null) return;
  street.run.paused = true;
  source?.setSimulation(FLAT_SIMULATION);
});

showMenu();
