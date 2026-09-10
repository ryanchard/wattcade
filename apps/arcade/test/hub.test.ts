/**
 * The hub's copy and its conditions. Both matter: a rider who cannot tell
 * that their trainer will not change resistance finds out four minutes into
 * a climb that never arrives.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@paperboy/game-core';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import type { TrainerStatus } from '@paperboy/trainer';
import type { GameModule } from '@paperboy/game-api';
import { CATALOG } from '../src/catalog.js';
import { wPrimeKilojoules } from '../src/profile.js';
import { GEAR_MAX, NEUTRAL_GEAR } from '../src/gearing.js';
import { controlsLine, escapeHtml, gearLine, padName, renderHub } from '../src/hub.js';
import type { HubModel } from '../src/hub.js';
import {
  cadenceState, cadenceWarning, createCadenceWatch, describeTrainer,
  noteCadence, READINGS_BEFORE_ABSENT, resistanceWarning,
} from '../src/trainerStatus.js';

const connected = (canControlResistance: boolean): TrainerStatus => ({
  kind: 'connected', deviceName: 'KICKR CORE', canControlResistance, message: null,
});

function model(over: Partial<HubModel> = {}): HubModel {
  return {
    trainer: describeTrainer('ftms', connected(true)),
    cadence: 'reporting',
    profile: DEFAULT_RIDER,
    stats: {},
    scores: {},
    games: CATALOG.map((game) => ({
      game, variants: game.variants?.(createMemoryStorage()) ?? [],
    })),
    seed: '',
    pad: { connected: false, name: null, standard: false },
    gear: NEUTRAL_GEAR,
    ...over,
  };
}

describe('describeTrainer', () => {
  it('says what a trainer with resistance control can do, in words', () => {
    const view = describeTrainer('ftms', connected(true));
    expect(view.mode).toBe('controls');
    expect(view.canControlResistance).toBe(true);
    expect(view.headline).toContain('KICKR CORE');
    expect(view.headline).toContain('resistance control');
  });

  it('distinguishes a read-only trainer from a connected one', () => {
    const view = describeTrainer('ftms', connected(false));
    expect(view.mode).toBe('readonly');
    expect(view.headline).toContain('reading power only');
    expect(view.canControlResistance).toBe(false);
  });

  it('calls the keyboard the keyboard rather than a trainer', () => {
    const view = describeTrainer('keyboard', {
      kind: 'connected', deviceName: 'Keyboard (simulated)',
      canControlResistance: false, message: 'Hold W to pedal',
    });
    expect(view.mode).toBe('keyboard');
    expect(view.headline).toContain('Keyboard');
  });

  it('says nothing is connected before anything is', () => {
    expect(describeTrainer(null, null).mode).toBe('none');
  });

  it('reports a dropped link and an error differently from idle', () => {
    const lost = describeTrainer('ftms', {
      kind: 'disconnected', deviceName: 'KICKR CORE',
      canControlResistance: false, message: null,
    });
    expect(lost.mode).toBe('lost');
    expect(lost.canControlResistance).toBe(false);
  });
});

describe('resistanceWarning', () => {
  it('warns nobody when the trainer can do what the game needs', () => {
    expect(resistanceWarning(true, describeTrainer('ftms', connected(true)))).toBeNull();
  });

  it('stays quiet for a game that does not need resistance', () => {
    expect(resistanceWarning(false, describeTrainer('keyboard', connected(false)))).toBeNull();
  });

  it('warns on a read-only trainer and on the keyboard', () => {
    expect(resistanceWarning(true, describeTrainer('ftms', connected(false)))).not.toBeNull();
    expect(resistanceWarning(true, describeTrainer('keyboard', connected(false)))).not.toBeNull();
  });
});

describe('renderHub', () => {
  it('names every game in the catalog', () => {
    const html = renderHub(model());
    for (const game of CATALOG) expect(html).toContain(game.name);
  });

  it('leaves the Phaser bake-off out of the arcade entirely', () => {
    // It is a development artifact. Two Paperboys on one page is a question
    // for the rider that has nothing to do with riding.
    expect(CATALOG.map((g) => g.id)).not.toContain('phaser');
    expect(renderHub(model())).not.toContain('Phaser');
  });

  it('puts the resistance warning on the card, not in a footnote', () => {
    const readonly = model({ trainer: describeTrainer('ftms', connected(false)) });
    const html = renderHub(readonly);
    const warned = CATALOG.filter((g) => g.needsResistance).length;
    expect(html.split('data-warn="resistance"').length - 1).toBe(warned);
  });

  it('drops the warnings the moment a real trainer connects', () => {
    expect(renderHub(model())).not.toContain('class="warn"');
  });

  it('warns about missing cadence only on the games steered by it', () => {
    const html = renderHub(model({ cadence: 'absent' }));
    const steered = CATALOG.filter((g) => g.needsCadence === true).length;
    expect(steered).toBeGreaterThan(0);
    expect(html.split('data-warn="cadence"').length - 1).toBe(steered);
  });

  it('says nothing about cadence until the trainer has been asked', () => {
    expect(renderHub(model({ cadence: 'unknown' }))).not.toContain('data-warn="cadence"');
    expect(renderHub(model({ cadence: 'reporting' }))).not.toContain('data-warn="cadence"');
  });

  it('gives every game a poster to draw and a place on the board', () => {
    const html = renderHub(model());
    for (const game of CATALOG) {
      expect(html).toContain(`data-poster="${game.id}"`);
    }
    // Five places per game, empty until somebody rides.
    expect(html.split('class="place empty"').length - 1).toBe(CATALOG.length * 5);
  });

  it('shows the rider their four numbers', () => {
    const html = renderHub(model({
      profile: { ...DEFAULT_RIDER, ftpWatts: 265, massKg: 72, sprintWatts: 1240 },
    }));
    expect(html).toContain('value="265"');
    expect(html).toContain('value="72"');
    expect(html).toContain('value="1240"');
    // The anaerobic store, in kilojoules, seeded from the other two.
    expect(html).toContain('id="wprime"');
    expect(html).toContain(`value="${wPrimeKilojoules({
      ...DEFAULT_RIDER, ftpWatts: 265, massKg: 72, sprintWatts: 1240,
    })}"`);
  });

  it('explains what each number changes, beside the number', () => {
    // Not one block of small print at the bottom: each of the four boxes
    // carries the line that says what moving it does.
    const html = renderHub(model());
    expect(html.split('class="does"').length - 1).toBe(4);
    expect(html).toContain('hour effort');
    expect(html).toContain('five seconds');
    expect(html).toMatch(/matters on\s+the flat/);
    expect(html).toMatch(/road tilts up/);
    expect(html).toMatch(/nothing left to\s+sprint with/);
  });

  it('locks a ladder rung the rider has not earned', () => {
    const html = renderHub(model());
    // Velodrome's ladder: the first rung is open and the rest are not.
    expect(html.split('disabled').length - 1).toBe(5);
  });

  it('keeps whatever route the rider typed across a redraw', () => {
    expect(renderHub(model({ seed: 'thursday' }))).toContain('value="thursday"');
  });

  it('escapes anything a game or a device puts on the page', () => {
    const nasty = describeTrainer('ftms', {
      kind: 'connected', deviceName: '<img src=x onerror=alert(1)>',
      canControlResistance: true, message: null,
    });
    const html = renderHub(model({ trainer: nasty }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});

describe('cadence', () => {
  it('does not accuse a trainer that has simply not reported yet', () => {
    const w = createCadenceWatch();
    noteCadence(w, null);
    expect(cadenceState(w)).toBe('unknown');
    expect(cadenceWarning(true, cadenceState(w))).toBeNull();
  });

  it('calls it absent once the trainer has had every chance', () => {
    const w = createCadenceWatch();
    for (let i = 0; i < READINGS_BEFORE_ABSENT; i++) noteCadence(w, null);
    expect(cadenceState(w)).toBe('absent');
    expect(cadenceWarning(true, cadenceState(w))).not.toBeNull();
  });

  it('never accuses a trainer that has reported once', () => {
    const w = createCadenceWatch();
    for (let i = 0; i < READINGS_BEFORE_ABSENT; i++) noteCadence(w, null);
    noteCadence(w, 88);
    expect(cadenceState(w)).toBe('reporting');
    expect(cadenceWarning(true, cadenceState(w))).toBeNull();
  });

  it('stays quiet for a game that is not steered by cadence', () => {
    expect(cadenceWarning(undefined, 'absent')).toBeNull();
    expect(cadenceWarning(false, 'absent')).toBeNull();
  });
});

describe('controlsLine', () => {
  it('says legs only when a game reads no keys', () => {
    const legs = CATALOG.find((g) => g.controls.length === 0) as GameModule;
    expect(controlsLine(legs)).toContain('Legs only');
  });

  it('spells out the keys a game does read', () => {
    const keyed = CATALOG.find((g) => g.controls.length > 0) as GameModule;
    const line = controlsLine(keyed).toLowerCase();
    for (const c of keyed.controls) expect(line).toContain(c.keys.toLowerCase());
    for (const c of keyed.controls) expect(line).toContain(c.action.toLowerCase());
  });

  it('keeps The Pack and Velodrome free of keys while riding', () => {
    // The owner's constraint: fewer controls while riding, because it is hard
    // to do things and ride with effort at the same time.
    for (const id of ['pack', 'velodrome']) {
      expect(CATALOG.find((g) => g.id === id)?.controls).toEqual([]);
    }
  });
});

describe('padName', () => {
  it('drops the half of a pad id that is meant for a driver', () => {
    expect(padName('Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e)'))
      .toBe('Xbox 360 Controller');
  });

  it('names an unnamed pad rather than showing a gap', () => {
    expect(padName(null)).toBe('Controller');
    expect(padName('')).toBe('Controller');
    expect(padName('   ')).toBe('Controller');
  });

  it('trims a name too long for the panel', () => {
    expect(padName('x'.repeat(90)).length).toBeLessThanOrEqual(40);
  });
});

describe('gearLine', () => {
  it('says the gear, and how many there are', () => {
    const line = gearLine(model({ gear: 7 }));
    expect(line).toContain('Gear 7');
    expect(line).toContain(String(GEAR_MAX));
  });

  it('offers the keyboard when there is no controller', () => {
    const line = gearLine(model());
    expect(line).toContain('No controller');
    expect(line).toContain('[ and ]');
    // Browsers hide a gamepad until one of its buttons is pressed, so this
    // line is also what a connected-but-untouched pad looks like.
    expect(line).toContain('press one of its buttons');
  });

  it('says where the paddles are once a controller is attached', () => {
    const line = gearLine(model({
      pad: { connected: true, name: '8BitDo Zero 2', standard: true },
    }));
    expect(line).toContain('8BitDo Zero 2');
    expect(line).toContain('Shoulder buttons shift');
  });

  it('is honest about a controller whose layout is not recognised', () => {
    // Promising shift paddles that the shell has refused to guess at would be
    // a rider pulling a trigger and wondering why nothing happens.
    const line = gearLine(model({
      pad: { connected: true, name: 'Strange Device', standard: false },
    }));
    expect(line).toContain('Strange Device');
    expect(line).toContain('cannot shift');
    expect(line).not.toContain('Shoulder buttons shift');
  });
});

describe('the hub’s controller line', () => {
  it('marks the state so it can be inked like the trainer’s', () => {
    expect(renderHub(model())).toContain('data-pad="none"');
    expect(renderHub(model({
      pad: { connected: true, name: 'A Pad', standard: true },
    }))).toContain('data-pad="standard"');
    expect(renderHub(model({
      pad: { connected: true, name: 'A Pad', standard: false },
    }))).toContain('data-pad="unmapped"');
  });

  it('shows the gear the rider left it in', () => {
    expect(renderHub(model({ gear: 11 }))).toContain('Gear 11');
  });

  it('says which games have no gears, once, in the footer', () => {
    const html = renderHub(model());
    expect(html).toContain('single-speed');
  });

  it('escapes a pad name the way it escapes everything else', () => {
    const html = renderHub(model({
      pad: { connected: true, name: '<script>bad</script>', standard: true },
    }));
    expect(html).not.toContain('<script>bad');
  });
});
