import {
  DEFAULT_RIDER, FtmsSource, KeyboardSource, createWebBluetoothConnector,
} from '@paperboy/trainer';
import type { TrainerSource } from '@paperboy/trainer';
import { createInput } from './input.js';
import { drawHud } from './hud.js';
import { createRenderState, renderScene, updateRenderState } from './render.js';
import type { RenderState } from './render.js';
import {
  FLAT_SIMULATION, advanceFixed, createSession, effectiveSimulation,
  setPower, stopRun, toRunResult,
} from './session.js';
import type { Session } from './session.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;
const input = createInput(window);

let session: Session | null = null;
let renderState: RenderState = createRenderState();
let source: TrainerSource | null = null;
let trainerLabel = 'no trainer';
let lastFrame = performance.now();
/** Gap a moment ago, used only to derive a growing/shrinking trend for the
 * HUD arrow — never fed back into the pure session state. */
let lastGap = 0;
let gapTrend = 0;

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
  next.onStatus((st) => {
    trainerLabel =
      st.kind === 'connected'
        ? `${st.deviceName ?? 'trainer'}${st.canControlResistance ? '' : ' (read-only)'}`
        : st.message ?? st.kind;
    // A dropped connection must not leave the rider coasting forever on the
    // last power reading — decay it back toward zero like an actual stop
    // pedalling would.
    if (session !== null && (st.kind === 'disconnected' || st.kind === 'error')) {
      setPower(session, 0);
    }
  });
  next.onSample((sample) => {
    if (session !== null) setPower(session, sample.power);
  });
  await next.start();
}

function showMenu(): void {
  panel.innerHTML = `
    <h1>THE PACK</h1>
    <p class="dim">You are chased. Dogs latch on and drag you down.</p>
    <p class="dim">The ONLY control is how hard you pedal. No steering,
      no buttons — just legs. Sprint hard enough, long enough, to shake a
      dog off. Escape is a safety stop, nothing else.</p>
    <p>
      <button id="connect">Connect trainer</button>
      <button id="keyboard">Keyboard (hold W)</button>
    </p>
    <p><button id="start">Start the ride</button></p>
    <p class="dim">Chrome or Edge only for a real trainer. Close Zwift and
      the Wahoo app first.</p>
  `;
  overlay.hidden = false;

  document.getElementById('connect')!.addEventListener('click', () => {
    void useSource(new FtmsSource(createWebBluetoothConnector()));
  });
  document.getElementById('keyboard')!.addEventListener('click', () => {
    void useSource(new KeyboardSource());
  });
  document.getElementById('start')!.addEventListener('click', startRun);
}

function startRun(): void {
  session = createSession(DEFAULT_RIDER);
  renderState = createRenderState();
  lastGap = session.gap;
  gapTrend = 0;
  overlay.hidden = true;
  lastFrame = performance.now();
}

function endRun(s: Session): void {
  const result = toRunResult(s);
  panel.innerHTML = `
    <h1>CAUGHT</h1>
    <p class="big">${result.distanceM} m</p>
    <p>${Math.round(result.durationMs / 1000)} s
      &middot; ${result.dogsShaken} dog${result.dogsShaken === 1 ? '' : 's'} shaken
      &middot; ${result.avgPower} W average</p>
    <p><button id="again">Ride again</button></p>
  `;
  overlay.hidden = false;
  document.getElementById('again')!.addEventListener('click', startRun);
  // The trainer must be left relaxed while the summary card is up, not
  // still holding whatever grade was in effect at the moment of the catch.
  source?.setSimulation(FLAT_SIMULATION);
  session = null;
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  const inputState = input.read();

  if (session !== null) {
    if (inputState.escapePressed) stopRun(session);

    advanceFixed(session, dt);
    updateRenderState(renderState, session.speed, dt);

    if (dt > 0) {
      // A dead zone is applied inside drawHud; this is just the raw rate.
      gapTrend = (session.gap - lastGap) / dt;
      lastGap = session.gap;
    }

    // Exactly one setSimulation call per frame, and it must be the last
    // thing said about resistance this frame: ControlPointWriter coalesces
    // pending writes, so only the value set here — flat while paused or the
    // run is over, the pack-drag simulation otherwise — is the one that
    // survives to the next flush.
    source?.setSimulation(effectiveSimulation(session));

    renderScene(ctx, session, renderState, window.innerWidth, window.innerHeight);
    drawHud(ctx, session, gapTrend, window.innerWidth, trainerLabel);

    if (session.caught) endRun(session);
  }

  requestAnimationFrame(frame);
}

function releaseTrainer(): void {
  source?.setSimulation(FLAT_SIMULATION);
  void source?.stop();
}
window.addEventListener('beforeunload', releaseTrainer);
// beforeunload does not fire reliably on mobile/bfcache navigations —
// pagehide is the belt to its suspenders.
window.addEventListener('pagehide', releaseTrainer);

// Backgrounding the tab (or letting the screen sleep) can stop rAF from
// running at all, so without this the last grade sent to the trainer stays
// applied indefinitely. Setting paused makes the frame loop's own
// setSimulation call flat if it does run again; the direct call here covers
// the case where it doesn't run again for a while (rAF fully suspended), so
// the trainer is relaxed the moment the tab is hidden either way. This does
// NOT end the run — that is Escape's job alone. Unlike Escape, this pause is
// automatically lifted when the tab is visible again: there is no manual
// pause key in this game (no keyboard input during the ride except the
// Escape safety stop), so a hidden tab must not be a permanent freeze.
document.addEventListener('visibilitychange', () => {
  if (session === null || session.caught) return;
  if (document.hidden) {
    session.paused = true;
    source?.setSimulation(FLAT_SIMULATION);
  } else {
    session.paused = false;
    lastFrame = performance.now();
  }
});

showMenu();
requestAnimationFrame(frame);
