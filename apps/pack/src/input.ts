/**
 * The ONLY keyboard input recognised during a ride: Escape, a safety stop.
 * Everything else about the ride is driven by measured power — there is no
 * steering, no throwing, no pausing key. See the design brief: "fewer
 * controls while riding as its difficult to do things and ride with
 * effort."
 */
export function createInput(target: EventTarget): {
  read(): { escapePressed: boolean };
  dispose(): void;
} {
  let escapePressed = false;

  const down = (e: Event) => {
    const key = (e as KeyboardEvent).key;
    // OS auto-repeat re-fires keydown for a held key; only the first press
    // of Escape should register.
    if ((e as KeyboardEvent).repeat) return;
    if (key === 'Escape') escapePressed = true;
  };

  target.addEventListener('keydown', down);

  return {
    read() {
      const state = { escapePressed };
      escapePressed = false; // edge-triggered: consumed by reading it
      return state;
    },
    dispose() {
      target.removeEventListener('keydown', down);
    },
  };
}
