/*
 * Copyright (C) 2025 The OpenPSG Authors
 *
 * This file is licensed under the Functional Source License 1.1
 * with a grant of AGPLv3-or-later effective two years after publication.
 *
 * You may not use this file except in compliance with the License.
 * A copy of the license is available in the root of the repository
 * and online at: https://fsl.software
 *
 * After two years from publication, this file may also be used under
 * the GNU Affero General Public License, version 3 or (at your option) any
 * later version. See <https://www.gnu.org/licenses/agpl-3.0.html> for details.
 */

export interface KLLOptions {
  // Base capacity (~1/ε). Typical UI choices: 200..1024. Default: 256.
  k?: number;
  // Capacity decay factor c in (0.5, 1). KLL suggest ~ 2/3. Default: 2/3.
  c?: number;
  // If true, compact bottom-up eagerly until all levels are within capacity.
  eagerCompaction?: boolean;
}

type Level = {
  items: number[]; // representatives at this level (ascending after compaction; unsorted between)
  // implicit weight = 2^levelIndex
};

/**
 * KLL (Karnin–Lang–Liberty) quantile sketch.
 *
 * Maintains a succinct summary of a numeric stream for approximate quantile queries.
 * Items are stored in levels; when a level exceeds its capacity, it is compacted by
 * sorting and keeping one item from each adjacent pair (parity and choice randomized),
 * then pushing survivors to the next level where their implicit weight doubles.
 *
 * With base capacity k and per-level decay factor c (0.5 < c < 1), KLL achieves
 * probabilistic rank error ε ≈ O(1/k) using O(k) space, with fast streaming updates.
 * This implementation focuses on streaming-only usage (no merging) and uses
 * rank-center interpolation between weighted representatives for `quantile(p)`.
 *
 * References
 * ----------
 * - Zohar Karnin, Kevin Lang, Edo Liberty. “Optimal Quantile Approximation in Streams.”
 *   arXiv:1603.05346 (2016). https://arxiv.org/abs/1603.05346
 */
export class KLLSketch {
  private levels: Level[] = [];
  private readonly k: number;
  private readonly c: number;
  private readonly eager: boolean;

  constructor(opts: KLLOptions = {}) {
    this.k = Math.max(8, Math.floor(opts.k ?? 256));
    this.c = Math.min(0.95, Math.max(0.51, opts.c ?? 2 / 3));
    this.eager = !!opts.eagerCompaction;
  }

  // Number of retained representatives (debug/inspection only).
  size(): number {
    let s = 0;
    for (const L of this.levels) s += L.items.length;
    return s;
  }

  // Add a single numeric value. Non-finite values are ignored.
  add(x: number): void {
    if (!Number.isFinite(x)) return;
    this.ensureLevel(0);
    this.levels[0].items.push(x);
    this.maybeCompact(0);
    if (this.eager) this.compactUpward();
  }

  // Add many values from any ArrayLike<number>. Non-finite values are ignored.
  addMany(arr: ArrayLike<number>): void {
    if (!arr || arr.length === 0) return;
    this.ensureLevel(0);
    const L0 = this.levels[0].items;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i] as number;
      if (Number.isFinite(v)) L0.push(v);
    }
    this.maybeCompact(0);
    if (this.eager) this.compactUpward();
  }

  /**
   * Approximate p-quantile for p in [0,1].
   * Uses rank-center interpolation between adjacent weighted representatives.
   */
  quantile(p: number): number {
    const T = this.mass();
    if (T === 0) return NaN;
    if (p <= 0) return this.min();
    if (p >= 1) return this.max();

    // Gather representatives (value, weight)
    let M = 0;
    for (let h = 0; h < this.levels.length; h++)
      M += this.levels[h].items.length;
    if (M === 0) return NaN;

    const vals = new Float64Array(M);
    const wts = new Float64Array(M);
    let idx = 0;
    for (let h = 0; h < this.levels.length; h++) {
      const L = this.levels[h];
      if (!L) continue;
      const w = 1 << h; // implicit weight
      for (let i = 0; i < L.items.length; i++) {
        vals[idx] = L.items[i];
        wts[idx] = w;
        idx++;
      }
    }

    // Sort by value (ascending) using an index array
    const order = new Uint32Array(M);
    for (let i = 0; i < M; i++) order[i] = i;
    order.sort((i, j) => (vals[i] < vals[j] ? -1 : vals[i] > vals[j] ? 1 : 0));

    // Target rank in [0, T-1]
    const r = p * (T - 1);

    // Interpolate between centers of adjacent weighted buckets
    let cw = 0; // cumulative mass before current item
    let prevCenter = Number.NEGATIVE_INFINITY;
    let prevVal = vals[order[0]];

    for (let t = 0; t < M; t++) {
      const i = order[t];
      const w = wts[i];
      const v = vals[i];
      const center = cw + w / 2;

      if (r <= center) {
        if (!Number.isFinite(prevCenter)) return v; // before first center
        const span = center - prevCenter;
        if (span <= 0) return v; // degenerate (should not happen)
        const f = (r - prevCenter) / span;
        return prevVal + f * (v - prevVal);
      }
      cw += w;
      prevCenter = center;
      prevVal = v;
    }
    // r beyond last center: return last value
    return prevVal;
  }

  // Total represented mass = sum(len(level[h]) * 2^h), derived on demand.
  private mass(): number {
    let m = 0;
    for (let h = 0; h < this.levels.length; h++) {
      const L = this.levels[h];
      if (!L) continue;
      m += L.items.length * (1 << h);
    }
    return m;
  }

  // Minimum of retained representatives.
  private min(): number {
    let m = Infinity;
    for (const L of this.levels) {
      for (const v of L.items) if (v < m) m = v;
    }
    return m;
  }

  // Maximum of retained representatives.
  private max(): number {
    let m = -Infinity;
    for (const L of this.levels) {
      for (const v of L.items) if (v > m) m = v;
    }
    return m;
  }

  private ensureLevel(h: number) {
    while (this.levels.length <= h) this.levels.push({ items: [] });
  }

  /**
   * Capacity at level h.
   * Approximate k_h ≈ k * c^(H-1-h), where H = number of levels.
   * Ensure even capacity ≥ 2, because compaction removes pairs.
   */
  private capacityAt(h: number): number {
    const H = Math.max(1, this.levels.length);
    const top = H - 1;
    const exp = top - h;
    const raw = Math.floor(this.k * Math.pow(this.c, exp));
    const even = raw & 1 ? raw - 1 : raw; // make even
    return Math.max(2, even);
  }

  private maybeCompact(h: number) {
    this.ensureLevel(h);
    const cap = this.capacityAt(h);
    if (this.levels[h].items.length > cap) this.compact(h);
  }

  /**
   * Compact a single level:
   * - sort items
   * - drop every other item starting from random parity (0 or 1)
   * - push survivors to level h+1 (implicit weight doubles)
   * - clear current level
   */
  private compact(h: number) {
    const L = this.levels[h];
    if (!L || L.items.length < 2) return;

    // Sort ascending
    L.items.sort((a, b) => a - b);

    const m = L.items.length;

    // If odd, randomly discard one endpoint before pairing to keep expectation unbiased.
    // (Avoid using .shift() to prevent O(n) data moves.)
    let start = 0;
    let end = m; // exclusive
    if ((m & 1) === 1) {
      if (Math.random() < 0.5) {
        // drop first
        start = 1;
      } else {
        // drop last
        end = m - 1;
      }
    }

    const survivors: number[] = [];
    for (let i = start; i < end; i += 2) {
      // Choose one representative per adjacent pair uniformly at random.
      const pickRight = Math.random() < 0.5;
      const keep = pickRight ? L.items[i + 1] : L.items[i];
      survivors.push(keep);
    }

    // Push survivors upward (implicit weight doubles)
    const nextLevel = h + 1;
    this.ensureLevel(nextLevel);
    this.levels[nextLevel].items.push(...survivors);

    // Clear current level
    L.items.length = 0;

    // Chain compaction if needed
    this.maybeCompact(nextLevel);
  }

  // One pass of bottom-up compaction to bring all levels within capacity.
  private compactUpward() {
    for (let h = 0; h < this.levels.length; h++) {
      const cap = this.capacityAt(h);
      if (this.levels[h].items.length > cap) this.compact(h);
    }
  }
}
