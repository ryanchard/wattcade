// @vitest-environment happy-dom
/**
 * The keyboard listener.
 *
 * These exist because the gear grew a second way in and the controller grew a
 * third: the thing that must stay true is that everything the keyboard did
 * before still happens, exactly, and that the two new keys are additive.
 */
import { describe, expect, it } from 'vitest';
import { createInput } from '../src/input.js';

function press(target: EventTarget, key: string, repeat = false): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, repeat }));
}

function release(target: EventTarget, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

describe('createInput', () => {
  it('still reports the shell’s own two exactly as it always did', () => {
    const target = new EventTarget();
    const input = createInput(target);
    press(target, 'Escape');
    press(target, 'p');
    const frame = input.read();
    expect(frame.shell.stop).toBe(true);
    expect(frame.shell.pause).toBe(true);
    // Edge-triggered: consumed by reading.
    expect(input.read().shell.stop).toBe(false);
    input.dispose();
  });

  it('still hands a game its keys, held and pressed', () => {
    const target = new EventTarget();
    const input = createInput(target);
    press(target, 'ArrowLeft');
    press(target, ' ');
    const first = input.read();
    expect(first.game.held.has('ArrowLeft')).toBe(true);
    expect(first.game.pressed.has(' ')).toBe(true);
    // A held key keeps steering; a repeat is not a second throw.
    press(target, ' ', true);
    const second = input.read();
    expect(second.game.held.has('ArrowLeft')).toBe(true);
    expect(second.game.pressed.has(' ')).toBe(false);
    release(target, 'ArrowLeft');
    expect(input.read().game.held.has('ArrowLeft')).toBe(false);
    input.dispose();
  });

  it('shifts on the bracket keys, one gear per press', () => {
    const target = new EventTarget();
    const input = createInput(target);
    press(target, ']');
    const up = input.read();
    expect(up.shell.shiftUp).toBe(true);
    expect(up.shell.shiftDown).toBe(false);
    // Consumed, so holding the key does not run the gear off the end.
    expect(input.read().shell.shiftUp).toBe(false);
    press(target, '[');
    expect(input.read().shell.shiftDown).toBe(true);
    input.dispose();
  });

  it('does not shift on a key repeat', () => {
    const target = new EventTarget();
    const input = createInput(target);
    press(target, ']', true);
    expect(input.read().shell.shiftUp).toBe(false);
    input.dispose();
  });

  it('reports no shift when nobody asked for one', () => {
    const target = new EventTarget();
    const input = createInput(target);
    press(target, 'ArrowRight');
    const frame = input.read();
    expect(frame.shell.shiftUp).toBe(false);
    expect(frame.shell.shiftDown).toBe(false);
    input.dispose();
  });
});
