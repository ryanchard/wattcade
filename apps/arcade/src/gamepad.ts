/**
 * The controller layer: shift paddles for a rider whose hands are busy.
 *
 * Shifting needs two inputs, and the design rule of these games is that the
 * hands are on the bars and the effort is hard — so a keyboard is the wrong
 * place for it. A cheap Bluetooth pad bungeed to the bars puts the paddles
 * where a rider's fingers already are.
 *
 * Three things shape this file:
 *
 *   - The Gamepad API polls rather than firing events, so this is read once
 *     per frame from the shell's loop, exactly like the keyboard.
 *   - It translates into the SAME key names the keyboard produces. A game
 *     that reads `ArrowLeft` cannot tell whether a thumb or a finger produced
 *     it, and nothing in a game had to change for a controller to work.
 *   - It is pure over a `PadSource`, which is a function returning pad-shaped
 *     objects. `navigator.getGamepads()` is one such function and a literal
 *     is another, which is how any of this is testable without hardware.
 *
 * A game never sees this module. The shell owns the controller as it owns the
 * trainer and the gear.
 */
import type { GameKeys } from '@paperboy/game-api';

/** The shape this module needs from a `GamepadButton`. */
export interface PadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

/**
 * The shape this module needs from a `Gamepad`. The DOM's `Gamepad` satisfies
 * it structurally, so `navigator.getGamepads()` can be handed straight in.
 */
export interface PadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  /** `'standard'` when the browser recognised the layout. Anything else means
   * the button indices below mean nothing on this pad. */
  readonly mapping: string;
  readonly buttons: readonly PadButtonLike[];
  readonly axes: readonly number[];
}

/** Whatever is plugged in right now, holes and all. */
export type PadSource = () => readonly (PadLike | null)[];

/**
 * Standard-mapping button indices, from the Gamepad API's own layout. They
 * are only trusted when `mapping === 'standard'`; see `signalsFor`.
 */
export const BUTTON = {
  south: 0, east: 1, west: 2, north: 3,
  leftBumper: 4, rightBumper: 5,
  leftTrigger: 6, rightTrigger: 7,
  select: 8, start: 9,
  dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
} as const;

/** Sticks rest slightly off centre and drift as they wear. Below this, a
 * stick is centred and the rider is not steering. */
export const AXIS_DEADZONE = 0.35;

/** Analogue triggers report a value long before they report `pressed`, and
 * some report `pressed` never. Half travel is a deliberate pull. */
export const TRIGGER_THRESHOLD = 0.5;

/**
 * What the shell asked the pad for, in the shell's own vocabulary. Names
 * rather than indices, because the whole point of the standard-mapping check
 * is that an index only means something on some pads.
 */
export type PadSignal =
  | 'shiftUp' | 'shiftDown' | 'pause' | 'stop'
  | 'left' | 'right' | 'up' | 'down' | 'throw';

/** The signals that stand in for a key, and the key each one stands in for. */
const AS_KEY: Partial<Record<PadSignal, string>> = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  throw: ' ',
};

export interface PadFrame {
  readonly connected: boolean;
  /** The pad's own name, for the hub to show. */
  readonly name: string | null;
  /** False for a pad whose layout the browser did not recognise. */
  readonly standard: boolean;
  /** Edge-triggered: one shift per press, however long it is held. */
  readonly shiftUp: boolean;
  readonly shiftDown: boolean;
  /** The shell's own two, so a rider never has to reach for the keyboard. */
  readonly pause: boolean;
  readonly stop: boolean;
  /** The pad said as keys, ready to be merged with the keyboard's. */
  readonly keys: GameKeys;
}

const NO_KEYS: GameKeys = {
  held: new Set<string>(), pressed: new Set<string>(),
};

export const NO_PAD: PadFrame = Object.freeze({
  connected: false,
  name: null,
  standard: false,
  shiftUp: false,
  shiftDown: false,
  pause: false,
  stop: false,
  keys: NO_KEYS,
});

export interface PadInput {
  /** Poll. Call once per frame, from the shell's loop. */
  read(): PadFrame;
}

function isDown(pad: PadLike, index: number): boolean {
  const button = pad.buttons[index];
  if (button === undefined) return false;
  return button.pressed || button.value > TRIGGER_THRESHOLD;
}

function anyDown(pad: PadLike, indices: readonly number[]): boolean {
  return indices.some((i) => isDown(pad, i));
}

function axis(pad: PadLike, index: number): number {
  const value = pad.axes[index];
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.abs(value) < AXIS_DEADZONE ? 0 : value;
}

/**
 * The pad the rider is using. The first standard-mapped one wins, because a
 * pad whose layout is known is worth more than a pad that happened to be
 * enumerated first — a phone's motion sensor and a wheel's pedals both turn
 * up in this list on some browsers.
 */
export function pickPad(pads: readonly (PadLike | null)[]): PadLike | null {
  const live = pads.filter((p): p is PadLike => p !== null && p.connected);
  return live.find((p) => p.mapping === 'standard') ?? live[0] ?? null;
}

/**
 * Everything the pad is asking for this instant, before edges are worked out.
 *
 * A pad the browser could not map gets a deliberately small vocabulary: the
 * first axis, which is the primary stick on essentially every device, and the
 * first button. Nothing else. Guessing an index for the safety stop on an
 * unknown layout would mean a run that ends by itself, and guessing one for a
 * shift would mean resistance arriving out of nowhere — both worse than a
 * pad that only steers, given the keyboard still has all four.
 */
export function signalsFor(pad: PadLike): ReadonlySet<PadSignal> {
  const on = new Set<PadSignal>();
  const x = axis(pad, 0);

  if (pad.mapping !== 'standard') {
    if (x < 0) on.add('left');
    if (x > 0) on.add('right');
    if (isDown(pad, 0)) on.add('throw');
    return on;
  }

  if (anyDown(pad, [BUTTON.rightBumper, BUTTON.rightTrigger])) on.add('shiftUp');
  if (anyDown(pad, [BUTTON.leftBumper, BUTTON.leftTrigger])) on.add('shiftDown');
  if (isDown(pad, BUTTON.start)) on.add('pause');
  // Select is the deliberate one and East is the one a panicking rider will
  // actually find: it is "back out of this" on every controller ever made,
  // and ending a run is the safe direction to be wrong in.
  if (anyDown(pad, [BUTTON.select, BUTTON.east])) on.add('stop');

  if (isDown(pad, BUTTON.dpadLeft) || x < 0) on.add('left');
  if (isDown(pad, BUTTON.dpadRight) || x > 0) on.add('right');
  const y = axis(pad, 1);
  if (isDown(pad, BUTTON.dpadUp) || y < 0) on.add('up');
  if (isDown(pad, BUTTON.dpadDown) || y > 0) on.add('down');
  // South and West are both "the action button" depending on whose layout the
  // rider grew up with, so both throw.
  if (anyDown(pad, [BUTTON.south, BUTTON.west])) on.add('throw');

  return on;
}

function keysFor(
  held: ReadonlySet<PadSignal>, pressed: ReadonlySet<PadSignal>,
): GameKeys {
  const toKeys = (signals: ReadonlySet<PadSignal>): Set<string> => {
    const out = new Set<string>();
    for (const signal of signals) {
      const key = AS_KEY[signal];
      if (key !== undefined) out.add(key);
    }
    return out;
  };
  return { held: toKeys(held), pressed: toKeys(pressed) };
}

/**
 * A poller over whatever `source` reports.
 *
 * Connect and disconnect need no events: a pad that goes away stops appearing
 * in the list, and the edge state is dropped with it so a controller unplugged
 * mid-press cannot leave a button stuck down — which for a shift paddle would
 * mean the gear walking away on its own the moment the next pad appeared.
 */
export function createPadInput(source: PadSource): PadInput {
  let downLast: ReadonlySet<PadSignal> = new Set<PadSignal>();
  let lastIndex: number | null = null;

  return {
    read(): PadFrame {
      const pad = pickPad(source());
      if (pad === null) {
        downLast = new Set<PadSignal>();
        lastIndex = null;
        return NO_PAD;
      }
      // A different pad is a different set of fingers. Start it clean rather
      // than reading a press that the pad now holding the buttons never made.
      if (pad.index !== lastIndex) {
        downLast = new Set<PadSignal>();
        lastIndex = pad.index;
      }

      const held = signalsFor(pad);
      const pressed = new Set<PadSignal>();
      for (const signal of held) if (!downLast.has(signal)) pressed.add(signal);
      downLast = held;

      return {
        connected: true,
        name: pad.id === '' ? null : pad.id,
        standard: pad.mapping === 'standard',
        shiftUp: pressed.has('shiftUp'),
        shiftDown: pressed.has('shiftDown'),
        pause: pressed.has('pause'),
        stop: pressed.has('stop'),
        keys: keysFor(held, pressed),
      };
    },
  };
}

/**
 * The browser's own pad list, guarded. `getGamepads` is absent on older
 * engines and throws in some privacy modes, and neither is a reason for the
 * page not to run.
 */
export function browserPads(nav: Navigator): PadSource {
  return () => {
    try {
      const get = nav.getGamepads?.bind(nav);
      if (get === undefined) return [];
      return get();
    } catch {
      return [];
    }
  };
}
