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
    if (key === ' ') throwPressed = true;
    if (key === 'p' || key === 'P') pausePressed = true;
    if (key === 'Escape') panicPressed = true;
    if (key === ' ' || key.startsWith('Arrow')) e.preventDefault();
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
