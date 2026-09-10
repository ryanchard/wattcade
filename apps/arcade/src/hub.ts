/**
 * The landing page: the moment before you clip in.
 *
 * Every function here returns markup and touches nothing else, so the copy
 * and the conditions that produce it are testable without a browser. The two
 * things that must be unmissable are the two that change how the games play:
 * what the trainer can do, and the rider's own numbers.
 *
 * The page is a cabinet, not a screen. Wattcade is printed on warm stock with
 * flat ink and a marquee across the top, and each game sits behind its own
 * side-art panel — art the game draws itself, in its own palette, through
 * `GameModule.poster`. Five games that look like pre-dawn suburbia, a night
 * chase, a lit velodrome, an English afternoon and the bottom of the sea
 * cannot share a look, so the hub does not try to give them one: it gives
 * them a frame and lets each fill it.
 */
import type { GameModule, GameVariant, RunResult } from '@paperboy/game-api';
import type { RiderProfile } from '@paperboy/trainer';
import { sprintWatts } from '@paperboy/trainer';
import {
  BOARD_SIZE, boardFor, ordinal, postable,
} from './scores.js';
import type { ScoreBoards } from './scores.js';
import { formatDuration, statsFor } from './stats.js';
import type { ArcadeStats } from './stats.js';
import { cadenceWarning, resistanceWarning } from './trainerStatus.js';
import type { CadenceState, TrainerView } from './trainerStatus.js';

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
  /** Whether the trainer has been reporting cadence, once it is known. */
  readonly cadence: CadenceState;
  readonly profile: RiderProfile;
  readonly stats: ArcadeStats;
  readonly scores: ScoreBoards;
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

/**
 * The warnings a card carries about the rider's own setup. Both are about
 * the same thing — this game wants something your trainer is not giving it —
 * so they look alike and are tagged apart, and both stay absent whenever
 * there is nothing to say.
 */
function warnings(game: GameModule, model: HubModel): string {
  const lines: Array<{ kind: string; text: string }> = [];
  const resistance = resistanceWarning(game.needsResistance, model.trainer);
  if (resistance !== null) lines.push({ kind: 'resistance', text: resistance });
  const cadence = cadenceWarning(game.needsCadence, model.cadence);
  if (cadence !== null) lines.push({ kind: 'cadence', text: cadence });
  return lines
    .map((l) => `<p class="warn" data-warn="${l.kind}">${escapeHtml(l.text)}</p>`)
    .join('');
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

export function gameCard(entry: HubGame, model: HubModel): string {
  const { game, variants } = entry;
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
      <div class="art">
        <canvas class="poster" data-poster="${escapeHtml(game.id)}"
          role="img" aria-label="${escapeHtml(game.name)} cabinet art"></canvas>
        <h2 class="plate">${escapeHtml(game.name)}</h2>
      </div>
      <div class="card-body">
        <p class="blurb">${escapeHtml(game.blurb)}</p>
        ${warnings(game, model)}
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

/**
 * One of the rider's three numbers, with the line that says what changing it
 * changes. The line sits under the box rather than in a block of small print
 * at the bottom, because a rider deciding whether 250 is right needs to know
 * what 250 does at the moment they are looking at the box.
 */
function riderField(
  id: string, label: string, unit: string, value: number,
  min: number, max: number, step: number, does: string,
): string {
  return `
    <div class="field">
      <label>
        <span>${escapeHtml(label)}</span>
        <input id="${escapeHtml(id)}" type="number" min="${min}" max="${max}"
          step="${step}" value="${Math.round(value)}">
        <em>${escapeHtml(unit)}</em>
      </label>
      <p class="does">${escapeHtml(does)}</p>
    </div>`;
}

export function riderPanel(profile: RiderProfile): string {
  return `
    <section class="panel rider">
      <p class="k">Rider</p>
      <div class="fields">
        ${riderField('ftp', 'FTP', 'W', profile.ftpWatts, 60, 600, 5,
    'Your hour effort. It sets how hard the long parts are.')}
        ${riderField('sprint', 'Sprint', 'W', sprintWatts(profile), 100, 2500, 10,
    'Your best five seconds. It sets how hard the short ones are — a rider '
    + 'who sprints at 1200 W and one who sprints at 500 W should not be '
    + 'asked for the same thing.')}
        ${riderField('mass', 'Weight', 'kg', profile.massKg, 35, 200, 1,
    'Barely matters on the flat, where you are mostly fighting the air. '
    + 'Decides everything the moment the road tilts up.')}
      </div>
    </section>`;
}

/** One game's column of the board: five places, filled or waiting. */
function scoreBoard(entry: HubGame, model: HubModel): string {
  const board = boardFor(model.scores, entry.game.id);
  const rows: string[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const e = board.entries[i];
    rows.push(e === undefined
      ? `<li class="place empty"><span class="rank">${i + 1}</span>
          <span class="who">···</span><span class="what">—</span></li>`
      : `<li class="place"><span class="rank">${i + 1}</span>
          <span class="who">${escapeHtml(e.initials)}</span>
          <span class="what">${escapeHtml(e.display)}</span></li>`);
  }
  return `
    <div class="board" style="--accent:${escapeHtml(entry.game.palette.accent)}">
      <p class="board-game">${escapeHtml(entry.game.name)}</p>
      <ol class="places">${rows.join('')}</ol>
    </div>`;
}

export function scoresSection(model: HubModel): string {
  return `
    <section class="scores">
      <h2 class="section-plate">High scores</h2>
      <div class="boards">
        ${model.games.map((entry) => scoreBoard(entry, model)).join('')}
      </div>
      <p class="fine">Three letters, typed after the ride. A ride you stopped
        does not post a score. Velodrome is ranked on the clock, and only a
        race you finished puts a time up — everything else is ranked on the
        number the game itself shows you.</p>
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
    <header class="marquee">
      <div class="bulbs" aria-hidden="true"></div>
      <h1><span class="word" aria-hidden="true">Wattcade</span
        ><span class="sr">Wattcade</span></h1>
      <p class="marquee-line">
        <span>${model.games.length} games, one bike</span>
        <span class="ridden">${escapeHtml(ridden)}</span>
      </p>
      <div class="bulbs" aria-hidden="true"></div>
    </header>
    <div class="panels">
      ${trainerPanel(model.trainer)}
      ${riderPanel(model.profile)}
    </div>
    <section class="games" aria-label="Games">
      ${model.games.map((entry) => gameCard(entry, model)).join('')}
    </section>
    ${scoresSection(model)}
    <p class="fine footer">Esc stops a ride and relaxes the trainer. P pauses
      it. Both work in every game, and both leave the trainer flat.</p>`;
}

export interface ResultsModel {
  readonly game: GameModule;
  readonly result: RunResult;
  /** Name of the variant to offer next, when this run unlocked one. */
  readonly nextName: string | null;
  readonly nextId: string | null;
  /** Where this run landed on the game's board, when it landed at all. */
  readonly place: number | null;
  /** The initials it was posted under, for the rider to correct. */
  readonly initials: string;
}

/**
 * What the board did with this run, said before the rider types anything.
 * Seeing the place first and the initials second is the order an arcade does
 * it in, and the only order in which typing your initials means something.
 */
function placeLine(model: ResultsModel): string {
  if (model.place !== null) {
    return `<p class="posted">${escapeHtml(ordinal(model.place))} on
      ${escapeHtml(model.game.name)}.</p>`;
  }
  if (model.result.stopped) {
    return '<p class="posted quiet">Stopped, so nothing posted to the board.</p>';
  }
  if (postable(model.result) === null) {
    return '<p class="posted quiet">Nothing to post to the board this time.</p>';
  }
  return `<p class="posted quiet">Not quite a top ${BOARD_SIZE}.</p>`;
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
      ${placeLine(model)}
      ${model.place === null ? '' : `
        <label class="initials">
          <span>Initials</span>
          <input id="initials" maxlength="3" size="3" autocomplete="off"
            spellcheck="false" value="${escapeHtml(model.initials.trim())}">
        </label>`}
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
