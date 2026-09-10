import {
  dailySeed, loadStats, randomSeed, recordRun, seedFromString,
} from '@paperboy/game-core';
import {
  DEFAULT_RIDER, FtmsSource, KeyboardSource, createWebBluetoothConnector,
} from '@paperboy/trainer';
import type { TrainerSource } from '@paperboy/trainer';
import { createInput } from './input.js';
import { drawHud } from './hud.js';
import { renderFrame } from './render/scene.js';
import {
  advanceFixed, createSession, setPower, simulationFor, toRunResult,
} from './session.js';
import type { Session } from './session.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;
const input = createInput(window);

let session: Session | null = null;
let source: TrainerSource | null = null;
let trainerLabel = 'no trainer';
let lastFrame = performance.now();

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

async function useSource(next: TrainerSource): Promise<void> {
  await source?.stop();
  source = next;
  next.onStatus((s) => {
    trainerLabel =
      s.kind === 'connected'
        ? `${s.deviceName ?? 'trainer'}${s.canControlResistance ? '' : ' (read-only)'}`
        : s.message ?? s.kind;
  });
  next.onSample((s) => {
    if (session !== null) setPower(session, s.power);
  });
  await next.start();
}

function showMenu(): void {
  const stats = loadStats(window.localStorage);
  panel.innerHTML = `
    <h1>PAPERBOY</h1>
    <p class="dim">Pedal to move. ← → steer, Space throws, P pauses,
      Esc kills resistance.</p>
    <p>High score <b>${stats.highScore}</b> · best ${stats.bestDistanceM} m
      · ${stats.runs} runs</p>
    <p>
      <button id="connect">Connect KICKR</button>
      <button id="keyboard">Keyboard (hold W)</button>
    </p>
    <p>
      <input id="seed" placeholder="seed (optional)" />
      <button id="daily">Daily route</button>
      <button id="start">Ride</button>
    </p>
    <p class="dim">Chrome or Edge only. Close Zwift and the Wahoo app first.</p>
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
    startRun(seed);
  });
}

function startRun(seed: number): void {
  session = createSession(seed, DEFAULT_RIDER);
  overlay.hidden = true;
  lastFrame = performance.now();
}

function endRun(s: Session): void {
  const result = toRunResult(s);
  const stats = recordRun(result, window.localStorage);
  const best = stats.perSeedBest[String(result.seed)] ?? result.score;
  panel.innerHTML = `
    <h1>${result.score}</h1>
    <p>${result.papersDelivered} papers · ${result.distanceM} m
      · ${Math.round(result.durationMs / 1000)} s</p>
    <p class="dim">${result.avgPower} W average · ${result.kilojoules} kJ</p>
    <p>Best on seed <b>${result.seed}</b>: ${best}
      · all-time ${stats.highScore}</p>
    <p>
      <button id="again">Same route again</button>
      <button id="menu">Menu</button>
    </p>
  `;
  overlay.hidden = false;
  document.getElementById('again')!.addEventListener('click', () =>
    startRun(result.seed),
  );
  document.getElementById('menu')!.addEventListener('click', showMenu);
  session = null;
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  const state = input.read();

  if (session !== null) {
    if (state.panicPressed) {
      source?.setSimulation({ grade: 0, headwind: 0, crr: 0.004, cw: 0.51 });
      session.paused = true;
    }
    if (state.pausePressed) session.paused = !session.paused;

    advanceFixed(session, dt, {
      steer: state.steer,
      throwPaper: state.throwPressed,
    });
    source?.setSimulation(simulationFor(session));

    renderFrame(ctx, session.world, window.innerWidth, window.innerHeight);
    drawHud(ctx, session, window.innerWidth, trainerLabel);

    if (session.world.gameOver) endRun(session);
  }

  requestAnimationFrame(frame);
}

window.addEventListener('beforeunload', () => {
  source?.setSimulation({ grade: 0, headwind: 0, crr: 0.004, cw: 0.51 });
  void source?.stop();
});

showMenu();
requestAnimationFrame(frame);
