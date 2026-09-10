/**
 * The only keyboard listener in the arcade.
 *
 * It captures two things and keeps them apart. The shell's own keys — pause
 * and the safety stop — work in every game and are read here. Everything else
 * is handed to the active session as a `GameKeys`, and only when its game
 * declared that it wants any.
 */
import type { GameKeys } from '@paperboy/game-api';

export interface ShellKeys {
  /** Escape went down: stop the ride. */
  stop: boolean;
  /** P went down: pause or resume. */
  pause: boolean;
  /** `]` went down: one gear taller. */
  shiftUp: boolean;
  /** `[` went down: one gear smaller. */
  shiftDown: boolean;
}

export interface ArcadeInput {
  read(): { shell: ShellKeys; game: GameKeys };
  /** True while a game that reads keys is on screen; enables preventDefault. */
  setCapturing(capturing: boolean): void;
  dispose(): void;
}

/** Keys the browser would otherwise use to scroll the page out from under a
 * rider mid-delivery. */
const SWALLOWED = new Set([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export function createInput(target: EventTarget): ArcadeInput {
  const held = new Set<string>();
  let pressed = new Set<string>();
  let stop = false;
  let pause = false;
  let shiftUp = false;
  let shiftDown = false;
  let capturing = false;

  const down = (e: Event): void => {
    const event = e as KeyboardEvent;
    const key = event.key;
    held.add(key);
    // A held arrow must keep steering, so it is swallowed on every repeat —
    // but the edge-triggered set below must not be, or a held Space becomes
    // thirty throws a second.
    if (capturing && SWALLOWED.has(key)) e.preventDefault();
    if (event.repeat) return;
    pressed.add(key);
    if (key === 'Escape') stop = true;
    if (key === 'p' || key === 'P') pause = true;
    // The gear has a keyboard too, for a rider with no controller yet. It is
    // a fallback and not the design: shifting wants a paddle under a finger
    // that is already on the bars, which is what `gamepad.ts` is for.
    if (key === ']') shiftUp = true;
    if (key === '[') shiftDown = true;
  };
  const up = (e: Event): void => { held.delete((e as KeyboardEvent).key); };
  // A tab-away leaves keys stuck down forever otherwise, which for an arrow
  // key means steering into the kerb with nobody touching the keyboard.
  const blur = (): void => { held.clear(); };

  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);

  return {
    read() {
      const frame = {
        shell: { stop, pause, shiftUp, shiftDown },
        game: { held: new Set(held), pressed } as GameKeys,
      };
      // Edge-triggered state is consumed by reading it.
      stop = false;
      pause = false;
      shiftUp = false;
      shiftDown = false;
      pressed = new Set<string>();
      return frame;
    },
    setCapturing(next: boolean) { capturing = next; },
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    },
  };
}

/**
 * The keyboard and the controller, said as one thing.
 *
 * A game is handed a single `GameKeys` and cannot tell which hand produced
 * it, which is the whole reason the pad speaks in key names: nothing in a
 * game had to learn what a controller is.
 */
export function mergeKeys(a: GameKeys, b: GameKeys): GameKeys {
  if (b.held.size === 0 && b.pressed.size === 0) return a;
  if (a.held.size === 0 && a.pressed.size === 0) return b;
  return {
    held: new Set([...a.held, ...b.held]),
    pressed: new Set([...a.pressed, ...b.pressed]),
  };
}
