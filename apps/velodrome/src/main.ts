import {
  DEFAULT_RIDER, FtmsSource, KeyboardSource, createWebBluetoothConnector,
} from '@paperboy/trainer';
import type { RiderProfile, TrainerSource } from '@paperboy/trainer';
import { drawHud } from './hud.js';
import { createRenderState, renderScene, updateRenderState } from './render.js';
import type { RenderState } from './render.js';
import {
  FLAT_SIMULATION, advanceFixed, createRace, effectiveSimulation,
  setPower, stopRace, toRaceResult,
} from './race.js';
import type { RaceState } from './race.js';
import { LADDER, rivalById } from './rivals.js';
import type { RivalSpec } from './rivals.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

let race: RaceState | null = null;
let renderState: RenderState = createRenderState();
let source: TrainerSource | null = null;
let trainerLabel = 'no trainer';
let lastFrame = performance.now();

// --- the rider's own numbers ----------------------------------------------

const RIDER_KEY = 'velodrome.rider';
const BEATEN_KEY = 'velodrome.beaten';
const MET_KEY = 'velodrome.met';

function readStore(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeStore(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify([...new Set(value)]));
  } catch {
    // A private window with storage disabled just means no ladder memory.
  }
}

function loadProfile(): RiderProfile {
  try {
    const raw = localStorage.getItem(RIDER_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<RiderProfile>;
      return {
        ...DEFAULT_RIDER,
        ftpWatts: clampNumber(parsed.ftpWatts, 60, 600, DEFAULT_RIDER.ftpWatts),
        massKg: clampNumber(parsed.massKg, 35, 200, DEFAULT_RIDER.massKg),
      };
    }
  } catch {
    // fall through to the default
  }
  return { ...DEFAULT_RIDER };
}

function clampNumber(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

let profile: RiderProfile = loadProfile();

// --- canvas ---------------------------------------------------------------

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

// --- the trainer ----------------------------------------------------------

async function useSource(next: TrainerSource): Promise<void> {
  await source?.stop();
  source = next;
  next.onStatus((st) => {
    trainerLabel = st.kind === 'connected'
      ? `${st.deviceName ?? 'trainer'}${st.canControlResistance ? '' : ' (read-only)'}`
      : st.message ?? st.kind;
    // A dropped connection must not leave the rider coasting forever on the
    // last reading.
    if (race !== null && (st.kind === 'disconnected' || st.kind === 'error')) {
      setPower(race, 0);
    }
    if (race === null) showMenu();
  });
  next.onSample((sample) => {
    if (race !== null) setPower(race, sample.power);
  });
  await next.start();
}

// --- screens --------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ));
}

function ladderMarkup(): string {
  const beaten = new Set(readStore(BEATEN_KEY));
  const met = new Set(readStore(MET_KEY));
  return LADDER.map((spec, i) => {
    const previous = LADDER[i - 1];
    const unlocked = previous === undefined || beaten.has(previous.id);
    const done = beaten.has(spec.id);
    const seen = met.has(spec.id);
    const classes = ['rung'];
    if (done) classes.push('done');
    if (!unlocked) classes.push('locked');
    // The tell is the prize for having lost to them once. Handing it over up
    // front would skip the entire game.
    const hint = seen
      ? `<span class="tell">Tell: ${escapeHtml(spec.tell)}</span>`
      : '<span class="tell dim">Ride them once to learn how they ride.</span>';
    return `
      <button class="${classes.join(' ')}" data-rival="${spec.id}"
        ${unlocked ? '' : 'disabled'}>
        <span class="num">${i + 1}</span>
        <span class="who">
          <span class="name">${escapeHtml(spec.name)}</span>
          <span class="line">${escapeHtml(spec.line)}</span>
          ${unlocked ? hint : '<span class="tell dim">Beat the rider above first.</span>'}
        </span>
        <span class="mark">${done ? 'BEATEN' : unlocked ? '' : 'LOCKED'}</span>
      </button>`;
  }).join('');
}

function showMenu(): void {
  panel.innerHTML = `
    <h1>VELODROME</h1>
    <p class="lede">Four laps. Two hundred and fifty metres each. One rival,
      and no controls at all — your legs are the whole game.</p>

    <div class="rider">
      <label>FTP
        <input id="ftp" type="number" min="60" max="600" step="5"
          value="${Math.round(profile.ftpWatts)}"> W
      </label>
      <label>Weight
        <input id="mass" type="number" min="35" max="200" step="1"
          value="${Math.round(profile.massKg)}"> kg
      </label>
    </div>
    <p class="dim small">Every rival rides at a percentage of YOUR FTP, so the
      ladder is the same fight at any fitness. Weight is there to keep the
      physics honest — on a flat track it barely matters: twenty kilos is
      worth about twelve watts. The air is what you are racing.</p>

    <div class="ladder">${ladderMarkup()}</div>

    <p class="sources">
      <button id="connect">Connect trainer</button>
      <button id="keyboard">Keyboard (hold W)</button>
      <span class="dim small">${escapeHtml(trainerLabel)}</span>
    </p>
    <p class="dim small">Chrome or Edge for a real trainer. Close Zwift and the
      Wahoo app first. Escape stops a race at any time.</p>
  `;
  overlay.hidden = false;

  const ftpInput = document.getElementById('ftp') as HTMLInputElement;
  const massInput = document.getElementById('mass') as HTMLInputElement;
  const commit = (): void => {
    profile = {
      ...profile,
      ftpWatts: clampNumber(ftpInput.value, 60, 600, profile.ftpWatts),
      massKg: clampNumber(massInput.value, 35, 200, profile.massKg),
    };
    try {
      localStorage.setItem(RIDER_KEY, JSON.stringify(
        { ftpWatts: profile.ftpWatts, massKg: profile.massKg },
      ));
    } catch {
      // no ladder memory in a private window; the race still runs
    }
  };
  ftpInput.addEventListener('change', commit);
  massInput.addEventListener('change', commit);

  document.getElementById('connect')!.addEventListener('click', () => {
    commit();
    void useSource(new FtmsSource(createWebBluetoothConnector()));
  });
  document.getElementById('keyboard')!.addEventListener('click', () => {
    commit();
    void useSource(new KeyboardSource());
  });

  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('.rung'))) {
    button.addEventListener('click', () => {
      commit();
      const spec = rivalById(button.dataset['rival'] ?? '');
      if (spec !== null) startRace(spec);
    });
  }
}

function startRace(spec: RivalSpec): void {
  race = createRace(profile, spec);
  renderState = createRenderState();
  writeStore(MET_KEY, [...readStore(MET_KEY), spec.id]);
  overlay.hidden = true;
  lastFrame = performance.now();
}

function endRace(s: RaceState): void {
  const spec = s.spec;
  const result = toRaceResult(s);
  const won = result.winner === 'player';
  if (won) writeStore(BEATEN_KEY, [...readStore(BEATEN_KEY), spec.id]);

  const index = LADDER.findIndex((r) => r.id === spec.id);
  const next = LADDER[index + 1];
  const heading = result.aborted ? 'STOPPED' : won ? 'WON' : 'LOST';

  panel.innerHTML = `
    <h1 class="${won ? 'won' : ''}">${heading}</h1>
    <p class="verdict">${escapeHtml(spec.name)}
      &middot; ${Math.abs(result.marginM).toFixed(1)} m
      ${result.marginM >= 0 ? 'ahead' : 'down'}</p>
    <p class="stats">
      <span>${result.timeS.toFixed(1)} s</span>
      <span>${result.avgPower} W avg</span>
      <span>${Math.round(result.draftShare * 100)}% sheltered</span>
    </p>
    ${result.aborted ? '' : `
      <p class="tellcard">
        <strong>Tell</strong> ${escapeHtml(spec.tell)}<br>
        <strong>Counter</strong> ${escapeHtml(spec.counter)}
      </p>`}
    <p>
      <button id="again">${won ? 'Race again' : 'Rematch'}</button>
      ${won && next !== undefined
        ? `<button id="next" class="primary">Next: ${escapeHtml(next.name)}</button>`
        : ''}
      <button id="menu">The ladder</button>
    </p>
  `;
  overlay.hidden = false;
  document.getElementById('again')!.addEventListener('click', () => startRace(spec));
  document.getElementById('menu')!.addEventListener('click', showMenu);
  const nextButton = document.getElementById('next');
  if (nextButton !== null && next !== undefined) {
    nextButton.addEventListener('click', () => startRace(next));
  }

  // Leave the trainer relaxed while the card is up rather than still holding
  // whatever cw was in effect at the line.
  source?.setSimulation(FLAT_SIMULATION);
  race = null;
}

// --- the loop -------------------------------------------------------------

/** The only key in the game. No steering, no buttons: position relative to
 * the rival is purely a function of how hard the rider is pedalling. */
let escapePressed = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') escapePressed = true;
});

function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  const s = race;
  if (s !== null) {
    if (escapePressed) {
      escapePressed = false;
      stopRace(s);
    }

    advanceFixed(s, dt);
    updateRenderState(renderState, s, window.innerWidth, window.innerHeight, dt);

    // Exactly ONE setSimulation call per frame, and it is the last word on
    // resistance this frame. ControlPointWriter coalesces pending writes and
    // flushes at most 4x a second, so only the value set here survives to the
    // wire: reduced cw in the shelter, full cw in the wind, and flat the
    // moment the race is paused or over. State decides; nothing else writes.
    source?.setSimulation(effectiveSimulation(s));

    renderScene(ctx, s, renderState, window.innerWidth, window.innerHeight);
    drawHud(ctx, s, window.innerWidth, window.innerHeight, trainerLabel);

    if (s.finished) endRace(s);
  }

  escapePressed = false;
  requestAnimationFrame(frame);
}

// --- letting go of the trainer --------------------------------------------

function releaseTrainer(): void {
  source?.setSimulation(FLAT_SIMULATION);
  void source?.stop();
}
window.addEventListener('beforeunload', releaseTrainer);
// beforeunload does not fire reliably on mobile or bfcache navigations.
window.addEventListener('pagehide', releaseTrainer);

// Backgrounding the tab can stop rAF entirely, which would otherwise leave
// the last cw applied indefinitely. Setting paused makes the loop's own
// single call flat if it runs again; the direct call here covers the case
// where it does not. This does NOT end the race — that is Escape's job — and
// it lifts itself when the tab comes back, because there is no pause key.
document.addEventListener('visibilitychange', () => {
  if (race === null || race.finished) return;
  if (document.hidden) {
    race.paused = true;
    source?.setSimulation(FLAT_SIMULATION);
  } else {
    race.paused = false;
    lastFrame = performance.now();
  }
});

showMenu();
requestAnimationFrame(frame);
