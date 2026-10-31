// Run save: the ESC menu writes the run in progress to the browser; the next visit offers to continue it.
// Pure (storage is passed in), like src/progress.ts. The save lives until the run ends, is abandoned or discarded.
import { CHAMPIONS } from './champions';
import type { RunSnapshot } from './game';
import type { Page } from './progress';

const KEY = 'los.run.v1';

export interface RunSave { champ: string; page: Page; state: RunSnapshot }

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** False when the browser refused to store it (private mode, quota). */
export function saveRun(s: RunSave, storage: Store) {
  try {
    storage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** The saved run, or null when there is none or it no longer fits the game (unknown champion, malformed). */
export function loadRun(storage: Store): RunSave | null {
  try {
    const s = JSON.parse(storage.getItem(KEY) ?? 'null') as RunSave | null;
    const st = s?.state;
    if (!s || !(s.champ in CHAMPIONS) || !s.page || !st || !Number.isFinite(st.time) || !Number.isFinite(st.level)
      || !Array.isArray(st.slots) || !st.fx) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearRun(storage: Store) {
  try { storage.removeItem(KEY); } catch { /* nothing stored */ }
}
