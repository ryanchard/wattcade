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
        ($('sweep') as HTMLButtonElement).disabled = false;
      }
    }
    ($('download') as HTMLButtonElement).disabled = false;
  } catch (err) {
    log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
});

$('sweep').addEventListener('click', async () => {
  if (writer === null) return;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const grade of [0, 2, 4, 6, 3, 0, -3, 0]) {
    log(`grade -> ${grade}%  (pedal and report what you feel)`);
    writer.setSimulation({ grade, headwind: 0, crr: 0.004, cw: 0.51 });
    await wait(6000);
  }
  await writer.resetResistance();
  log('Sweep complete, resistance reset to 0%.');
});

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

window.addEventListener('beforeunload', () => {
  void writer?.resetResistance();
});
