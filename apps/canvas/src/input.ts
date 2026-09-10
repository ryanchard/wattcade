export interface InputState {
  steer: number;
  throwPressed: boolean;
  pausePressed: boolean;
  panicPressed: boolean;
}

export function createInput(target: EventTarget): {
  read(): InputState;
  dispose(): void;
} {
  const held = new Set<string>();
  let throwPressed = false;
  let pausePressed = false;
  let panicPressed = false;

  const down = (e: Event) => {
    const key = (e as KeyboardEvent).key;
    held.add(key);
    // Held arrows keep steering via `held`, so the key still needs to be
    // preventDefault-ed on every repeat (a held arrow must not scroll the
    // page) even though the edge-triggered flags below must not be.
    if (key === ' ' || key.startsWith('Arrow')) e.preventDefault();
    // OS auto-repeat re-fires keydown for a held key. Without this guard a
    // held Space rapid-fires throws every ~30-60ms — exactly what
    // edge-triggering exists to prevent.
    if ((e as KeyboardEvent).repeat) return;
    if (key === ' ') throwPressed = true;
    if (key === 'p' || key === 'P') pausePressed = true;
    if (key === 'Escape') panicPressed = true;
  };
  const up = (e: Event) => held.delete((e as KeyboardEvent).key);
  const blur = () => held.clear();

  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);

  return {
    read() {
      const state: InputState = {
        steer:
          (held.has('ArrowLeft') ? -1 : 0) + (held.has('ArrowRight') ? 1 : 0),
        throwPressed,
        pausePressed,
        panicPressed,
      };
      // Edge-triggered inputs are consumed by reading them.
      throwPressed = false;
      pausePressed = false;
      panicPressed = false;
      return state;
    },
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    },
  };
}
