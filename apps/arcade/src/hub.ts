/**
 * The landing page: the moment before you clip in.
 *
 * Every function here returns markup and touches nothing else, so the copy
 * and the conditions that produce it are testable without a browser. The two
 * things that must be unmissable are the two that change how the games play:
 * what the trainer can do, and the rider's own numbers.
 *
 * The page deliberately has no visual identity of its own beyond dark and
 * quiet. Three games that look like pre-dawn suburbia, a night chase and a
 * lit velodrome cannot share one, so each card carries a swatch of its own
 * palette and the hub borrows identity from its contents.
 */
import type { GameModule, GameVariant, RunResult } from '@paperboy/game-api';
import type { RiderProfile } from '@paperboy/trainer';
import { sprintWatts } from '@paperboy/trainer';
import { formatDuration, statsFor } from './stats.js';
import type { ArcadeStats } from './stats.js';
import { resistanceWarning } from './trainerStatus.js';
import type { TrainerView } from './trainerStatus.js';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ));
}

export interface HubGame {
  readonly game: GameModule;
  readonly variants: readonly GameVariant[];
}

export interface HubModel {
  readonly trainer: TrainerView;
  readonly profile: RiderProfile;
  readonly stats: ArcadeStats;
  readonly games: readonly HubGame[];
  /** Whatever is currently typed in the seed box, preserved across redraws. */
  readonly seed: string;
}

/** How the rider controls a game, said as a sentence rather than a legend. */
export function controlsLine(game: GameModule): string {
  if (game.controls.length === 0) {
    return 'Legs only. Nothing to press while you ride.';
  }
  return game.controls
    .map((c) => `${c.keys} to ${c.action}`)
    .join(' · ')
    .replace(/^./, (c) => c.toUpperCase()) + '.';
}

function recordLine(game: GameModule, stats: ArcadeStats): string {
  const s = statsFor(stats, game.id);
  if (s.runs === 0) return 'Not ridden yet.';
  const parts = [`${s.runs} ride${s.runs === 1 ? '' : 's'}`];
  if (s.bestScore !== null) parts.push(`best ${s.bestScore}`);
  else if (s.bestDistanceM > 0) parts.push(`furthest ${s.bestDistanceM} m`);
  parts.push(formatDuration(s.secondsRidden));
  return parts.join(' · ');
}

function variantButton(gameId: string, v: GameVariant): string {
  const classes = ['variant'];
  if (v.cleared === true) classes.push('cleared');
  if (v.locked === true) classes.push('locked');
  return `
    <button class="${classes.join(' ')}" data-game="${escapeHtml(gameId)}"
      data-variant="${escapeHtml(v.id)}"${v.locked === true ? ' disabled' : ''}>
      <span class="variant-name">${escapeHtml(v.name)}</span>
      <span class="variant-detail">${escapeHtml(v.detail)}</span>
      ${v.note === undefined ? '' : `<span class="variant-note">${escapeHtml(v.note)}</span>`}
      <span class="variant-mark">${v.cleared === true ? 'beaten' : v.locked === true ? 'locked' : ''}</span>
    </button>`;
}

export function gameCard(
  entry: HubGame, model: HubModel,
): string {
  const { game, variants } = entry;
  const warning = resistanceWarning(game.needsResistance, model.trainer);
  const palette = game.palette;

  const start = variants.length > 0
    ? `<div class="variants">${variants.map((v) => variantButton(game.id, v)).join('')}</div>`
    : `
      <div class="start">
        ${game.usesSeed === true ? `
          <label class="seed">
            <span>Route</span>
            <input id="seed" name="seed" placeholder="anything, or leave it blank"
              value="${escapeHtml(model.seed)}">
          </label>
          <button class="ghost" id="daily">Today’s route</button>` : ''}
        <button class="go" data-game="${escapeHtml(game.id)}">Ride</button>
      </div>`;

  return `
    <article class="card" style="--base:${escapeHtml(palette.base)};
      --accent:${escapeHtml(palette.accent)};--detail:${escapeHtml(palette.detail)}">
      <div class="swatch" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="card-body">
        <h2>${escapeHtml(game.name)}</h2>
        <p class="blurb">${escapeHtml(game.blurb)}</p>
        ${warning === null ? '' : `<p class="warn">${escapeHtml(warning)}</p>`}
        <p class="controls">${escapeHtml(controlsLine(game))}</p>
        <p class="record">${escapeHtml(recordLine(game, model.stats))}</p>
        ${start}
      </div>
    </article>`;
}

export function trainerPanel(view: TrainerView): string {
  return `
    <section class="panel trainer" data-mode="${view.mode}">
      <p class="k">Trainer</p>
      <p class="headline">${escapeHtml(view.headline)}</p>
      <p class="detail">${escapeHtml(view.detail)}</p>
      <p class="actions">
        <button id="connect" class="go">Connect a trainer</button>
        <button id="keyboard" class="ghost">Ride from the keyboard</button>
      </p>
      <p class="fine">Chrome or Edge for a real trainer, and close Zwift and
        the Wahoo app first — a trainer pairs to one thing at a time. Connect
        once here and you can change games without getting off the bike.</p>
    </section>`;
}

export function riderPanel(profile: RiderProfile): string {
  return `
    <section class="panel rider">
      <p class="k">Rider</p>
      <div class="fields">
        <label>
          <span>FTP</span>
          <input id="ftp" type="number" min="60" max="600" step="5"
            value="${Math.round(profile.ftpWatts)}">
          <em>W</em>
        </label>
        <label>
          <span>Sprint</span>
          <input id="sprint" type="number" min="100" max="2500" step="10"
            value="${Math.round(sprintWatts(profile))}">
          <em>W</em>
        </label>
        <label>
          <span>Weight</span>
          <input id="mass" type="number" min="35" max="200" step="1"
            value="${Math.round(profile.massKg)}">
          <em>kg</em>
        </label>
      </div>
      <p class="fine">FTP is the hour effort, and it sets how hard the long
        parts are. Sprint is your best five seconds, and it sets how hard the
        short ones are — a rider who sprints at 1200 W and one who sprints at
        500 W should not be asked for the same thing. Weight barely matters on
        the flat, where you are mostly fighting the air, and decides
        everything the moment the road tilts up.</p>
    </section>`;
}

export function renderHub(model: HubModel): string {
  const t = model.games.reduce(
    (acc, entry) => {
      const s = statsFor(model.stats, entry.game.id);
      return { runs: acc.runs + s.runs, seconds: acc.seconds + s.secondsRidden };
    },
    { runs: 0, seconds: 0 },
  );
  const ridden = t.runs === 0
    ? 'Nothing ridden yet'
    : `${t.runs} ride${t.runs === 1 ? '' : 's'} · ${formatDuration(t.seconds)}`;

  return `
    <header class="masthead">
      <h1>Wattcade</h1>
      <p class="ridden">${escapeHtml(ridden)}</p>
    </header>
    <div class="panels">
      ${trainerPanel(model.trainer)}
      ${riderPanel(model.profile)}
    </div>
    <section class="games">
      ${model.games.map((entry) => gameCard(entry, model)).join('')}
    </section>
    <p class="fine footer">Esc stops a ride and relaxes the trainer. P pauses
      it. Both work in every game, and both leave the trainer flat.</p>`;
}

export interface ResultsModel {
  readonly game: GameModule;
  readonly result: RunResult;
  /** Name of the variant to offer next, when this run unlocked one. */
  readonly nextName: string | null;
  readonly nextId: string | null;
}

export function resultsCard(model: ResultsModel): string {
  const r = model.result;
  const rows = [
    ...r.lines,
    { label: 'distance', value: `${Math.round(r.distanceM)} m` },
    { label: 'time', value: formatDuration(r.durationS) },
    { label: 'average power', value: `${r.avgPower} W` },
  ];
  return `
    <section class="results" style="--accent:${escapeHtml(model.game.palette.accent)}">
      <p class="k">${escapeHtml(model.game.name)}</p>
      <p class="headline">${escapeHtml(r.headline)}</p>
      <p class="summary">${escapeHtml(r.summary)}</p>
      <dl class="rows">
        ${rows.map((row) => `
          <div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>
        `).join('')}
      </dl>
      <p class="actions">
        <button id="again" class="go">Ride it again</button>
        ${model.nextName === null ? '' : `
          <button id="next" class="go"
            data-variant="${escapeHtml(model.nextId ?? '')}">Next: ${escapeHtml(model.nextName)}</button>`}
        <button id="hub" class="ghost">Back to Wattcade</button>
      </p>
    </section>`;
}
