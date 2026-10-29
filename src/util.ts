// Allocation-free helpers for the per-frame lists of the simulation.

/** In-place filter: keeps order and reuses the array's storage (items pushed while it runs are visited too). */
export function compact<T>(list: T[], keep: (x: T) => boolean) {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (keep(list[i])) list[n++] = list[i];
  list.length = n;
}

/** Timestamps inside a sliding window of `span` seconds: amortized O(1) push and count. */
export class TimeWindow {
  private times: number[] = [];
  private head = 0;
  constructor(readonly span: number) {}

  push(t: number) { this.times.push(t); }

  count(now: number) {
    const t = this.times;
    while (this.head < t.length && now - t[this.head] >= this.span) this.head++;
    if (this.head > 512 && this.head * 2 > t.length) { t.splice(0, this.head); this.head = 0; }
    return t.length - this.head;
  }

  clear() { this.times.length = 0; this.head = 0; }
}

/** Texture extension: build:prod converts the PNGs to WebP (tools/optimize.mjs) and sets VITE_IMG_EXT=webp. */
export const IMG: string = import.meta.env.VITE_IMG_EXT ?? 'png';

/** Content-hashed URL of a public/ file: tools/hash_assets.mjs injects the map into dist/index.html, dev has none. */
const HASHED: Record<string, string> = (globalThis as { __ASSETS?: Record<string, string> }).__ASSETS ?? {};
export const asset = (path: string): string => HASHED[path] ?? path;
