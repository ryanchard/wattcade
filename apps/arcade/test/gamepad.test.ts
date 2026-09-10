/**
 * The controller, tested against a synthetic pad.
 *
 * There is no hardware here and there is no display, so the pad is a literal:
 * `createPadInput` is pure over a function returning pad-shaped objects, and
 * `navigator.getGamepads` is only one such function. What cannot be checked
 * this way is whether a given physical controller reports the standard
 * mapping and whether its paddles land on the indices the spec says they do —
 * that needs a human and a controller.
 *
 * The property that matters most: a pad produces the SAME `GameKeys` a
 * keyboard does, so no game had to learn what a controller is.
 */
import { describe, expect, it } from 'vitest';
import {
  AXIS_DEADZONE, BUTTON, TRIGGER_THRESHOLD, browserPads, createPadInput,
  pickPad, signalsFor,
} from '../src/gamepad.js';
import type { PadLike } from '../src/gamepad.js';
import { mergeKeys } from '../src/input.js';

interface PadOptions {
  readonly down?: readonly number[];
  /** Buttons held part way — a trigger the rider is squeezing. */
  readonly analogue?: Readonly<Record<number, number>>;
  readonly axes?: readonly number[];
  readonly mapping?: string;
  readonly id?: string;
  readonly index?: number;
  readonly connected?: boolean;
}

function pad(opts: PadOptions = {}): PadLike {
  const down = new Set(opts.down ?? []);
  const analogue = opts.analogue ?? {};
  return {
    id: opts.id ?? 'Test Pad (STANDARD GAMEPAD Vendor: 0000 Product: 0000)',
    index: opts.index ?? 0,
    connected: opts.connected ?? true,
    mapping: opts.mapping ?? 'standard',
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: down.has(i),
      value: analogue[i] ?? (down.has(i) ? 1 : 0),
    })),
    axes: opts.axes ?? [0, 0, 0, 0],
  };
}

/** A poller over a list of frames, one per `read()`. */
function polling(frames: readonly (PadLike | null)[]): () => (PadLike | null)[] {
  let i = 0;
  return () => {
    const frame = frames[Math.min(i, frames.length - 1)] ?? null;
    i += 1;
    return [frame];
  };
}

describe('with nothing plugged in', () => {
  it('says so, and asks for nothing', () => {
    const input = createPadInput(() => []);
    const frame = input.read();
    expect(frame.connected).toBe(false);
    expect(frame.shiftUp).toBe(false);
    expect(frame.stop).toBe(false);
    expect(frame.keys.held.size).toBe(0);
  });

  it('ignores the holes the browser leaves in the list', () => {
    expect(createPadInput(() => [null, null]).read().connected).toBe(false);
  });

  it('ignores a pad the browser has already let go of', () => {
    const input = createPadInput(() => [pad({ connected: false })]);
    expect(input.read().connected).toBe(false);
  });
});

describe('pickPad', () => {
  it('prefers a pad whose layout is known', () => {
    const odd = pad({ index: 0, mapping: '', id: 'Some Wheel' });
    const good = pad({ index: 1, id: 'A Controller' });
    expect(pickPad([odd, good])).toBe(good);
  });

  it('takes an unknown one rather than nothing', () => {
    const odd = pad({ mapping: '' });
    expect(pickPad([null, odd])).toBe(odd);
  });
});

describe('shifting', () => {
  it('shifts up on either right-hand shoulder', () => {
    for (const button of [BUTTON.rightBumper, BUTTON.rightTrigger]) {
      const frame = createPadInput(polling([pad({ down: [button] })])).read();
      expect(frame.shiftUp).toBe(true);
      expect(frame.shiftDown).toBe(false);
    }
  });

  it('shifts down on either left-hand shoulder', () => {
    for (const button of [BUTTON.leftBumper, BUTTON.leftTrigger]) {
      const frame = createPadInput(polling([pad({ down: [button] })])).read();
      expect(frame.shiftDown).toBe(true);
      expect(frame.shiftUp).toBe(false);
    }
  });

  it('reads an analogue trigger that never reports itself pressed', () => {
    const half = pad({ analogue: { [BUTTON.rightTrigger]: 0.9 } });
    expect(createPadInput(polling([half])).read().shiftUp).toBe(true);
  });

  it('ignores a trigger that is barely touched', () => {
    const brushed = pad({
      analogue: { [BUTTON.rightTrigger]: TRIGGER_THRESHOLD - 0.1 },
    });
    expect(createPadInput(polling([brushed])).read().shiftUp).toBe(false);
  });

  it('is one shift per press, however long the paddle is held', () => {
    // Held for six frames. A shift per frame would run the gear from one end
    // of the block to the other in a tenth of a second.
    const held = pad({ down: [BUTTON.rightBumper] });
    const input = createPadInput(polling([held, held, held, held, held, held]));
    const shifts = Array.from({ length: 6 }, () => input.read().shiftUp);
    expect(shifts).toEqual([true, false, false, false, false, false]);
  });

  it('shifts again once the paddle is released and pulled', () => {
    const on = pad({ down: [BUTTON.rightBumper] });
    const off = pad();
    const input = createPadInput(polling([on, off, on]));
    expect(input.read().shiftUp).toBe(true);
    expect(input.read().shiftUp).toBe(false);
    expect(input.read().shiftUp).toBe(true);
  });
});

describe('the shell’s own two', () => {
  it('pauses on Start', () => {
    expect(createPadInput(polling([pad({ down: [BUTTON.start] })])).read().pause)
      .toBe(true);
  });

  it('stops on Select and on the button every controller calls "back"', () => {
    for (const button of [BUTTON.select, BUTTON.east]) {
      expect(createPadInput(polling([pad({ down: [button] })])).read().stop)
        .toBe(true);
    }
  });

  it('does not stop or pause when nothing is pressed', () => {
    const frame = createPadInput(polling([pad()])).read();
    expect(frame.stop).toBe(false);
    expect(frame.pause).toBe(false);
  });
});

describe('the keys a game sees', () => {
  const keysFrom = (p: PadLike): { held: string[]; pressed: string[] } => {
    const frame = createPadInput(polling([p])).read();
    return {
      held: [...frame.keys.held].sort(),
      pressed: [...frame.keys.pressed].sort(),
    };
  };

  it('steers with the d-pad, in the keyboard’s own words', () => {
    expect(keysFrom(pad({ down: [BUTTON.dpadLeft] })).held).toEqual(['ArrowLeft']);
    expect(keysFrom(pad({ down: [BUTTON.dpadRight] })).held).toEqual(['ArrowRight']);
  });

  it('steers with the stick as well', () => {
    expect(keysFrom(pad({ axes: [-1, 0] })).held).toEqual(['ArrowLeft']);
    expect(keysFrom(pad({ axes: [1, 0] })).held).toEqual(['ArrowRight']);
  });

  it('ignores a stick that is merely resting off centre', () => {
    // Sticks drift as they wear. A game must not steer because a controller
    // is old.
    expect(keysFrom(pad({ axes: [AXIS_DEADZONE - 0.05, 0] })).held).toEqual([]);
    expect(keysFrom(pad({ axes: [-(AXIS_DEADZONE - 0.05), 0] })).held).toEqual([]);
  });

  it('throws on either of the two buttons a rider might call "the action one"', () => {
    expect(keysFrom(pad({ down: [BUTTON.south] })).held).toEqual([' ']);
    expect(keysFrom(pad({ down: [BUTTON.west] })).held).toEqual([' ']);
  });

  it('reports a throw as a press exactly once, like a key without repeat', () => {
    const held = pad({ down: [BUTTON.south] });
    const input = createPadInput(polling([held, held, held]));
    expect([...input.read().keys.pressed]).toEqual([' ']);
    expect([...input.read().keys.pressed]).toEqual([]);
    expect([...input.read().keys.held]).toEqual([' ']);
  });

  it('produces exactly what the keyboard produces for the same action', () => {
    // The point of the whole translation: Paperboy's `handleKeys` cannot tell
    // a thumb from a finger, and nothing in Paperboy had to change.
    const fromPad = createPadInput(
      polling([pad({ down: [BUTTON.dpadLeft, BUTTON.south] })]),
    ).read().keys;
    const fromKeyboard = {
      held: new Set(['ArrowLeft', ' ']),
      pressed: new Set(['ArrowLeft', ' ']),
    };
    expect([...fromPad.held].sort()).toEqual([...fromKeyboard.held].sort());
    expect([...fromPad.pressed].sort()).toEqual([...fromKeyboard.pressed].sort());
  });
});

describe('a pad the browser could not map', () => {
  const odd = (opts: PadOptions = {}): PadLike =>
    pad({ ...opts, mapping: '', id: 'Strange Device' });

  it('is reported as connected but not standard', () => {
    const frame = createPadInput(polling([odd()])).read();
    expect(frame.connected).toBe(true);
    expect(frame.standard).toBe(false);
  });

  it('still steers on the primary axis', () => {
    const frame = createPadInput(polling([odd({ axes: [-1, 0] })])).read();
    expect([...frame.keys.held]).toEqual(['ArrowLeft']);
  });

  it('will not guess at a shift, a pause or a safety stop', () => {
    // An index means nothing on an unmapped pad. A wrong guess here is a run
    // that ends by itself or resistance arriving out of nowhere, and the
    // keyboard still has all three.
    for (let i = 0; i < 17; i++) {
      const frame = createPadInput(polling([odd({ down: [i] })])).read();
      expect(frame.shiftUp, `button ${i}`).toBe(false);
      expect(frame.shiftDown, `button ${i}`).toBe(false);
      expect(frame.pause, `button ${i}`).toBe(false);
      expect(frame.stop, `button ${i}`).toBe(false);
    }
  });

  it('lets the first button do the one harmless thing', () => {
    const frame = createPadInput(polling([odd({ down: [0] })])).read();
    expect([...frame.keys.held]).toEqual([' ']);
  });
});

describe('coming and going', () => {
  it('drops a held button when the pad is unplugged', () => {
    const held = pad({ down: [BUTTON.south] });
    const input = createPadInput(polling([held, null]));
    input.read();
    const gone = input.read();
    expect(gone.connected).toBe(false);
    expect(gone.keys.held.size).toBe(0);
  });

  it('does not fire a shift when a pad is unplugged mid-press', () => {
    // Otherwise the gear walks away on its own the moment a pad comes back.
    const held = pad({ down: [BUTTON.rightBumper] });
    const input = createPadInput(polling([held, null, held]));
    expect(input.read().shiftUp).toBe(true);
    expect(input.read().shiftUp).toBe(false);
    // The pad is back and the paddle is down: that is a new press by a new
    // hand, and it counts once.
    expect(input.read().shiftUp).toBe(true);
  });

  it('starts a swapped-in pad clean rather than inheriting the last one’s edges', () => {
    const first = pad({ index: 0, down: [BUTTON.rightBumper] });
    const second = pad({ index: 1, down: [BUTTON.rightBumper] });
    const input = createPadInput(polling([first, second]));
    expect(input.read().shiftUp).toBe(true);
    expect(input.read().shiftUp).toBe(true);
  });

  it('gives the hub the pad’s own name', () => {
    const frame = createPadInput(polling([pad({ id: 'DualSense Wireless' })]))
      .read();
    expect(frame.name).toBe('DualSense Wireless');
  });

  it('reports no name rather than an empty one', () => {
    expect(createPadInput(polling([pad({ id: '' })])).read().name).toBeNull();
  });
});

describe('signalsFor', () => {
  it('says what the pad is asking for, in the shell’s own words', () => {
    const asked = signalsFor(pad({
      down: [BUTTON.rightBumper, BUTTON.dpadLeft], axes: [0, 0],
    }));
    expect([...asked].sort()).toEqual(['left', 'shiftUp']);
  });
});

describe('browserPads', () => {
  it('reads the browser’s list', () => {
    const one = pad();
    const nav = { getGamepads: () => [one] } as unknown as Navigator;
    expect(browserPads(nav)()).toEqual([one]);
  });

  it('copes with a browser that has no gamepads at all', () => {
    expect(browserPads({} as unknown as Navigator)()).toEqual([]);
  });

  it('copes with a browser that refuses to say', () => {
    // Some privacy modes throw rather than return an empty list, and that is
    // not a reason for the page to stop running.
    const nav = {
      getGamepads: () => { throw new Error('blocked'); },
    } as unknown as Navigator;
    expect(browserPads(nav)()).toEqual([]);
  });
});

describe('mergeKeys', () => {
  const keys = (held: string[], pressed: string[] = held) => ({
    held: new Set(held), pressed: new Set(pressed),
  });

  it('lets both hands play at once', () => {
    const merged = mergeKeys(keys(['ArrowLeft']), keys([' ']));
    expect([...merged.held].sort()).toEqual([' ', 'ArrowLeft']);
    expect([...merged.pressed].sort()).toEqual([' ', 'ArrowLeft']);
  });

  it('does not double a key both hands are on', () => {
    const merged = mergeKeys(keys(['ArrowLeft']), keys(['ArrowLeft']));
    expect([...merged.held]).toEqual(['ArrowLeft']);
  });

  it('hands back the keyboard untouched when no pad is asking', () => {
    const typed = keys(['ArrowRight']);
    expect(mergeKeys(typed, keys([]))).toBe(typed);
  });
});
