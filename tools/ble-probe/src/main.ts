import {
  ControlPointWriter,
  createWebBluetoothConnector,
  parseIndoorBikeData,
} from '@paperboy/trainer';
import type { GattLink } from '@paperboy/trainer';

const $ = (id: string) => document.getElementById(id)!;
const logEl = $('log');
const frames: { t: number; hex: string }[] = [];
let link: GattLink | null = null;
let writer: ControlPointWriter | null = null;
let deviceName = 'unknown';

function log(msg: string): void {
  logEl.textContent += `${new Date().toISOString().slice(11, 23)}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * The grade sweep runs with a rider on a real trainer, so it must be
 * abortable at every instant, not only between its 6-second steps. This
 * flags the abort AND wakes up whichever `wait()` call is currently
 * blocking the loop — that is what makes the abort take effect DURING a
 * step, rather than only being noticed once the current step's timer
 * happens to elapse on its own.
 */
class SweepAbort {
  #aborted = false;
  #wake: (() => void) | null = null;

  get aborted(): boolean {
    return this.#aborted;
  }

  abort(): void {
    if (this.#aborted) return;
    this.#aborted = true;
    this.#wake?.();
    this.#wake = null;
  }

  /** Resolves after `ms`, or immediately if abort() is called first. */
  wait(ms: number): Promise<void> {
    if (this.#aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#wake = null;
        resolve();
      }, ms);
      this.#wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

let activeSweep: SweepAbort | null = null;

function setSweepButtons(running: boolean): void {
  ($('sweep') as HTMLButtonElement).disabled = running || writer === null;
  ($('stop') as HTMLButtonElement).disabled = !running;
}

/** Escape and the Stop button both funnel through here. */
function stopSweep(): void {
  if (activeSweep === null || activeSweep.aborted) return;
  log('Stop requested — aborting sweep immediately.');
  activeSweep.abort();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') stopSweep();
});

const hex = (v: DataView) =>
  Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

$('connect').addEventListener('click', async () => {
  try {
    log('Requesting device…');
    link = await createWebBluetoothConnector()();
    deviceName = link.deviceName ?? 'unknown';
    log(`Connected to ${deviceName}`);
    log(`Control point present: ${link.controlPoint !== null}`);

    link.onDisconnect(() => log('!! gattserverdisconnected'));

    link.onIndoorBikeData((view) => {
      const raw = hex(view);
      frames.push({ t: Date.now(), hex: raw });
      // parseIndoorBikeData throws on a buffer shorter than its flags
      // declare. In a diagnostic tool a truncated frame is a FINDING, so
      // log it loudly and keep the raw bytes rather than dying.
      let d;
      try {
        d = parseIndoorBikeData(view);
      } catch (err) {
        log(`!! undecodable frame ${raw} — ${String(err)}`);
        return;
      }
      $('power').textContent = d.instantaneousPower?.toString() ?? '—';
      $('cadence').textContent = d.instantaneousCadence?.toString() ?? '—';
      $('speed').textContent =
        d.instantaneousSpeed === null
          ? '—'
          : (d.instantaneousSpeed * 3.6).toFixed(1);
      if (frames.length % 10 === 1) log(`raw ${raw}`);
    });

    await link.startNotifications();
    log('Subscribed to Indoor Bike Data.');

    if (link.controlPoint !== null) {
      writer = new ControlPointWriter(link.controlPoint);
      const granted = await writer.requestControl();
      log(`Request Control -> ${granted ? 'GRANTED' : 'REFUSED'}`);
      if (granted) {
        log(`Start/Resume -> ${await writer.startOrResume()}`);
        setSweepButtons(false);
      }
    } else {
      log('Grade sweep unavailable: trainer exposes no control point. Questions 1, 2, and 5 can still be answered.');
    }
    ($('download') as HTMLButtonElement).disabled = false;
  } catch (err) {
    log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
});

$('sweep').addEventListener('click', async () => {
  if (writer === null || activeSweep !== null) return;
  const abort = new SweepAbort();
  activeSweep = abort;
  setSweepButtons(true);
  try {
    for (const grade of [0, 2, 4, 6, 3, 0, -3, 0]) {
      if (abort.aborted) break;
      log(`grade -> ${grade}%  (pedal and report what you feel)`);
      writer.setSimulation({ grade, headwind: 0, crr: 0.004, cw: 0.51 });
      await abort.wait(6000);
    }
    await writer.resetResistance();
    log(
      abort.aborted
        ? 'Sweep ABORTED — resistance reset to 0%.'
        : 'Sweep complete, resistance reset to 0%.',
    );
  } catch (err) {
    log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
    await writer.resetResistance();
    log('Resistance reset to 0% after error.');
  } finally {
    activeSweep = null;
    setSweepButtons(false);
  }
});

$('stop').addEventListener('click', stopSweep);

$('download').addEventListener('click', () => {
  const capture = {
    version: 1 as const,
    device: deviceName,
    recordedAt: new Date().toISOString(),
    frames,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kickr-capture.json';
  a.click();
  URL.revokeObjectURL(url);
});

function panicReset(): void {
  activeSweep?.abort();
  void writer?.resetResistance();
}
window.addEventListener('beforeunload', panicReset);
// beforeunload does not fire reliably on mobile/bfcache navigations —
// pagehide is the belt to its suspenders, same rider-safety reasoning as
// the Stop button above.
window.addEventListener('pagehide', panicReset);
