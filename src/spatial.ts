/**
 * Uniform grid over the XZ plane: O(1) insert, and a query only visits the cells around the point, so neighbour
 * searches cost ~the items nearby instead of every item. Positions are read at insert time; callers check exact
 * distances against the live positions.
 */
export class SpatialGrid<T extends { pos: { x: number; z: number } }> {
  private cells = new Map<number, T[]>();
  private used: T[][] = [];

  constructor(readonly cell: number) {}

  // 16 bits per axis: keys only repeat 65536 cells apart, and a repeat just adds far candidates the caller rejects
  private key(cx: number, cz: number) { return ((cx & 0xffff) << 16) | (cz & 0xffff); }

  clear() {
    for (const c of this.used) c.length = 0;
    this.used.length = 0;
    if (this.cells.size > 4096) this.cells.clear(); // the player wanders: drop empty cells left far behind
  }

  insert(item: T) {
    const k = this.key(Math.floor(item.pos.x / this.cell), Math.floor(item.pos.z / this.cell));
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    if (!c.length) this.used.push(c);
    c.push(item);
  }

  /** Fills `out` with the items of every cell touching the square of half-size `r` around (x, z). */
  query(x: number, z: number, r: number, out: T[]): T[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / this.cell), x1 = Math.floor((x + r) / this.cell);
    const z0 = Math.floor((z - r) / this.cell), z1 = Math.floor((z + r) / this.cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.cells.get(this.key(cx, cz));
        if (c) for (let i = 0; i < c.length; i++) out.push(c[i]);
      }
    }
    return out;
  }
}
