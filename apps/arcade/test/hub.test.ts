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
import { controlsLine, escapeHtml, renderHub } from '../src/hub.js';
import type { HubModel } from '../src/hub.js';
import { describeTrainer, resistanceWarning } from '../src/trainerStatus.js';

const connected = (canControlResistance: boolean): TrainerStatus => ({
  kind: 'connected', deviceName: 'KICKR CORE', canControlResistance, message: null,
});

function model(over: Partial<HubModel> = {}): HubModel {
  return {
    trainer: describeTrainer('ftms', connected(true)),
    profile: DEFAULT_RIDER,
    stats: {},
    games: CATALOG.map((game) => ({
      game, variants: game.variants?.(createMemoryStorage()) ?? [],
    })),
    seed: '',
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
    expect(html.split('class="warn"').length - 1).toBe(warned);
  });

  it('drops the warnings the moment a real trainer connects', () => {
    expect(renderHub(model())).not.toContain('class="warn"');
  });

  it('shows the rider their three numbers', () => {
    const html = renderHub(model({
      profile: { ...DEFAULT_RIDER, ftpWatts: 265, massKg: 72, sprintWatts: 1240 },
    }));
    expect(html).toContain('value="265"');
    expect(html).toContain('value="72"');
    expect(html).toContain('value="1240"');
  });

  it('explains what each number changes', () => {
    const html = renderHub(model());
    expect(html).toContain('hour effort');
    expect(html).toContain('five seconds');
    expect(html).toMatch(/barely matters on\s+the flat/);
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
