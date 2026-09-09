// Regenerate with: node packages/trainer/test/fixtures/make-sample-capture.mjs
// Builds a synthetic Indoor Bike Data capture from known values, so the
// replay path is exercised in CI without hardware. This is NOT a substitute
// for a real capture: it proves the plumbing, not that our reading of the
// FTMS spec matches a real trainer's firmware.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// flags 0x0044 = instantaneous speed (bit 0 clear) + cadence + power
const FLAGS = 0x0044;

function frame(speedKmh, cadenceRpm, powerW) {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setUint16(0, FLAGS, true);
  v.setUint16(2, Math.round(speedKmh * 100), true);
  v.setUint16(4, Math.round(cadenceRpm * 2), true);
  v.setInt16(6, Math.round(powerW), true);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const frames = [];
let t = 0;
for (let i = 0; i < 120; i++) {
  // A plausible ride: warm up, two surges, ease off.
  const phase = i / 120;
  const power = Math.round(120 + 130 * Math.sin(phase * Math.PI * 3) ** 2);
  const cadence = power < 10 ? 0 : Math.min(105, 70 + power / 12);
  const speed = 12 + power / 12;
  frames.push({ t, hex: frame(speed, cadence, power) });
  t += 250; // 4 Hz, matching a real trainer's notify rate
}

const capture = {
  version: 1,
  device: 'Synthetic KICKR (generated, not real hardware)',
  recordedAt: '2026-09-10T00:00:00.000Z',
  frames,
};

const out = fileURLToPath(new URL('./sample-capture.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(capture, null, 2)}\n`);
console.log(`wrote ${out} (${frames.length} frames)`);
