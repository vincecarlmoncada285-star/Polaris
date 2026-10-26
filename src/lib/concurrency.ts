/**
 * At most `max` holders at once; `tryEnter()` returns the function that leaves, or null when
 * full (the caller refuses the work rather than queueing it, so a flood cannot build a backlog).
 */
export interface Gate {
  tryEnter(): (() => void) | null;
  readonly active: number;
}

export function createGate(max: number): Gate {
  if (max < 1) throw new Error("A gate needs max >= 1");
  let active = 0;
  return {
    tryEnter() {
      if (active >= max) return null;
      active++;
      let left = false;
      return () => {
        if (left) return;
        left = true;
        active--;
      };
    },
    get active() {
      return active;
    },
  };
}
