// Frame governor: lowers the alive-enemy cap on a device that drops frames, and slowly restores it once frames are steady.
// Frame times only exist on the main thread (requestAnimationFrame), so the per-frame work is one push; the judgement runs
// once per window (sort of ~100 numbers), too cheap to be worth a worker.

export const GOVERNOR = {
  window: 2, // seconds of frames per judgement
  minFrames: 30, // a window with fewer frames (tab hidden, pause) is ignored
  dropFactor: 1.5, // a frame longer than this × the display period is a dropped frame
  dropShare: 0.1, // more than this share of dropped frames: lower the cap
  calmShare: 0.03, // fewer than this: steady
  calmFor: 10, // seconds steady before the cap creeps back up
  shrink: 0.85, // cap multiplier when dropping
  grow: 10, // cap added per calm step
  minCap: 60,
  maxFrame: 250, // ms; longer gaps are stalls (tab switch, loading), not frames
};

export class FrameGovernor {
  cap: number;
  private frames: number[] = [];
  private elapsed = 0;
  private calm = 0;

  constructor(readonly max: number, readonly min = GOVERNOR.minCap) {
    this.cap = max;
  }

  /**
   * One frame of `ms`; `loaded` says the enemy count is near the cap (otherwise drops are not the enemies' fault and the
   * cap stays). Returns the new cap when it changes.
   */
  sample(ms: number, loaded: boolean): number | null {
    if (ms > GOVERNOR.maxFrame) return null;
    this.frames.push(ms);
    this.elapsed += ms / 1000;
    if (this.elapsed < GOVERNOR.window) return null;
    const f = this.frames, n = f.length;
    this.frames = [];
    this.elapsed = 0;
    if (n < GOVERNOR.minFrames) return null;
    const sorted = f.slice().sort((a, b) => a - b);
    const period = Math.max(4, sorted[Math.floor(n * 0.1)]); // the display's refresh period: the fast frames
    let dropped = 0;
    for (const t of f) if (t > period * GOVERNOR.dropFactor) dropped++;
    const share = dropped / n;
    const before = this.cap;
    if (share > GOVERNOR.dropShare) {
      this.calm = 0;
      if (loaded) this.cap = Math.max(this.min, Math.round(this.cap * GOVERNOR.shrink));
    } else if (share < GOVERNOR.calmShare) {
      this.calm += GOVERNOR.window;
      if (this.calm >= GOVERNOR.calmFor && this.cap < this.max) {
        this.calm = 0;
        this.cap = Math.min(this.max, this.cap + GOVERNOR.grow);
      }
    }
    return this.cap === before ? null : this.cap;
  }
}
