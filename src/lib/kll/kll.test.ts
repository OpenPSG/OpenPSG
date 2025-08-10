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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KLLSketch } from "./kll";

// Deterministic RNG to make compaction parity stable in all tests
function makeLCG(seed = 123456789) {
  let s = seed >>> 0;
  return () => {
    // 32-bit LCG (Numerical Recipes)
    s = (1664525 * s + 1013904223) >>> 0;
    // Map to [0,1)
    return (s >>> 0) / 0x100000000;
  };
}

function withSeededRandom(seed = 42) {
  const orig = Math.random;
  Math.random = makeLCG(seed);
  return () => {
    Math.random = orig;
  };
}

// Exact quantile (sort + linear interpolation) for validation
function exactQuantile(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const a = Float64Array.from(arr.slice().sort((x, y) => x - y));
  if (p <= 0) return a[0];
  if (p >= 1) return a[a.length - 1];
  const idx = p * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return a[lo] * (1 - w) + a[hi] * w;
}

function exactQuantiles(arr: number[], ps: number[]): number[] {
  return ps.map((p) => exactQuantile(arr, p));
}

function range(n: number, f: (i: number) => number): number[] {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = f(i);
  return out;
}

function shuffleInPlace(a: number[], rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** Root-mean-square error across ps */
function rmse(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

describe("KLLSketch", () => {
  let restoreRandom: (() => void) | undefined;

  beforeEach(() => {
    restoreRandom = withSeededRandom(12345);
  });

  afterEach(() => {
    restoreRandom?.();
  });

  it("handles empty and trivial streams", () => {
    const kll = new KLLSketch({ k: 64 });
    expect(kll.quantile(0.5)).toBeNaN();

    kll.add(7);
    expect(kll.quantile(0)).toBe(7);
    expect(kll.quantile(0.5)).toBe(7);
    expect(kll.quantile(1)).toBe(7);
    expect(kll.size()).toBeGreaterThan(0);
  });

  it("ignores non-finite values scattered in the stream", () => {
    const kll = new KLLSketch({ k: 64 });
    kll.add(NaN);
    kll.add(Infinity);
    kll.add(-Infinity);
    kll.addMany([NaN, 1, 2, 3, Infinity, 4, -Infinity, 5, NaN]);
    expect(kll.quantile(0)).toBe(1);
    expect(kll.quantile(1)).toBe(5);
    expect(kll.quantile(0.5)).toBeGreaterThanOrEqual(2);
    expect(kll.quantile(0.5)).toBeLessThanOrEqual(4);
  });

  it("degenerate constant stream returns the constant for all p", () => {
    const data = Array(5000).fill(3.14159);
    const kll = new KLLSketch({ k: 32 });
    kll.addMany(data);
    for (const p of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
      expect(kll.quantile(p)).toBeCloseTo(3.14159, 10);
    }
  });

  it("duplicate-heavy stream tracks the mode and boundaries", () => {
    const data = [
      ...Array(2000).fill(-5),
      ...Array(8000).fill(0),
      ...Array(2000).fill(7),
      -1000,
      1000,
    ];
    const kll = new KLLSketch({ k: 128 });
    kll.addMany(data);

    expect(kll.quantile(0)).toBeLessThanOrEqual(-5);
    expect(kll.quantile(1)).toBeGreaterThanOrEqual(7);
    expect(kll.quantile(0.5)).toBeCloseTo(0, 2);
    // Tails are near extremes (ignore the two far outliers)
    expect(kll.quantile(0.01)).toBeLessThanOrEqual(-5);
    expect(kll.quantile(0.99)).toBeGreaterThanOrEqual(7);
  });

  it("approximates quantiles on uniform data within a tight absolute tolerance", () => {
    const n = 30000;
    const data = range(n, (i) => i / (n - 1)); // uniform in [0,1]
    const kll = new KLLSketch({ k: 256, c: 2 / 3 });

    kll.addMany(data);
    // sanity: sketch is much smaller than raw data
    expect(kll.size()).toBeLessThan(n / 5);

    const ps = [0.001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.999];
    const tol = 0.012; // absolute tol on [0,1]
    const approx = ps.map((p) => kll.quantile(p));
    const exact = exactQuantiles(data, ps);
    for (let i = 0; i < ps.length; i++) {
      expect(Math.abs(approx[i] - exact[i])).toBeLessThanOrEqual(tol);
    }
  });

  it("works on heavy-tail data (exponential) with scale-aware tolerance", () => {
    const n = 30000;
    // Exponential via inverse CDF: -ln(1-U), U ~ Uniform(0,1)
    const rng = makeLCG(777);
    const data = range(n, () => {
      const u = 1 - rng(); // avoid 0
      return -Math.log(u);
    });
    const kll = new KLLSketch({ k: 1024 });

    kll.addMany(data);

    const ps = [0.5, 0.9, 0.99, 0.999];
    const exact99 = exactQuantile(data, 0.99);
    const tol = 0.2 * exact99; // 20% of 99th percentile
    for (const p of ps) {
      const approx = kll.quantile(p);
      const exact = exactQuantile(data, p);
      expect(Math.abs(approx - exact)).toBeLessThanOrEqual(tol);
    }
  });

  it("bimodal/disjoint ranges place mid-quantiles between clusters", () => {
    const a = range(20000, (i) => i); // [0, 19999]
    const b = range(20000, (i) => 100000 + i); // [100000, 119999]
    const data = a.concat(b);
    const kll = new KLLSketch({ k: 512, c: 0.7, eagerCompaction: true });
    kll.addMany(data);

    const q50 = kll.quantile(0.5);
    // The true median is halfway between 19999 and 100000 (~60000 minus 0.5)
    const exact = exactQuantile(data, 0.5);
    expect(Math.abs(q50 - exact)).toBeLessThanOrEqual(6000); // generous but meaningful

    // Tails near cluster edges
    expect(kll.quantile(0.01)).toBeLessThan(6000);
    expect(kll.quantile(0.99)).toBeGreaterThan(96000);
  });

  it("monotonic vs p and bounded between min/max", () => {
    const data = range(15000, (i) => Math.sin(i) + i * 1e-3);
    const kll = new KLLSketch({ k: 256 });
    kll.addMany(data);

    const min = Math.min(...data);
    const max = Math.max(...data);

    let prev = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const p = i / 200;
      const q = kll.quantile(p);
      expect(q).toBeGreaterThanOrEqual(prev);
      expect(q).toBeGreaterThanOrEqual(min - 1e-12);
      expect(q).toBeLessThanOrEqual(max + 1e-12);
      prev = q;
    }
  });

  it("respects endpoints: p<=0 -> min, p>=1 -> max", () => {
    const data = [5, 10, -3, 7, 7, 2, 100];
    const kll = new KLLSketch({ k: 64 });
    kll.addMany(data);
    expect(kll.quantile(0)).toBeLessThanOrEqual(Math.min(...data));
    expect(kll.quantile(1)).toBeGreaterThanOrEqual(Math.max(...data));
    // out-of-range p clamps
    expect(kll.quantile(-0.5)).toBeLessThanOrEqual(Math.min(...data));
    expect(kll.quantile(1.7)).toBeGreaterThanOrEqual(Math.max(...data));
  });

  it("robust to permutation: shuffled vs sorted ingestion yields similar quantiles", () => {
    const n = 40000;
    const base = range(n, (i) => Math.sin(i * 0.013) + i * 1e-4);
    const sorted = base.slice().sort((a, b) => a - b);
    const shuffled = shuffleInPlace(base.slice(), makeLCG(999));

    const ps = [0.01, 0.1, 0.5, 0.9, 0.99];

    const kllSorted = new KLLSketch({ k: 256 });
    kllSorted.addMany(sorted);
    const sortedQs = ps.map((p) => kllSorted.quantile(p));

    const kllShuf = new KLLSketch({ k: 256 });
    kllShuf.addMany(shuffled);
    const shufQs = ps.map((p) => kllShuf.quantile(p));

    const err = rmse(sortedQs, shufQs);
    expect(err).toBeLessThanOrEqual(
      0.005 * (Math.max(...sorted) - Math.min(...sorted)),
    );
  });

  it("chunked ingestion equals single-batch within tiny error", () => {
    const n = 50000;
    const rng = makeLCG(321);
    const data = range(n, () => (rng() - 0.5) * 10); // roughly uniform [-5,5)

    const ps = [0.01, 0.1, 0.5, 0.9, 0.99];

    const a = new KLLSketch({ k: 256 });
    a.addMany(data);
    const Qa = ps.map((p) => a.quantile(p));

    const b = new KLLSketch({ k: 512 });
    const chunk = 2047; // weird chunk size to shake things out
    for (let i = 0; i < data.length; i += chunk) {
      b.addMany(data.slice(i, i + chunk));
    }
    const Qb = ps.map((p) => b.quantile(p));

    const err = rmse(Qa, Qb);
    expect(err).toBeLessThanOrEqual(0.04); // absolute error is small on this scale
  });

  it("bigger k generally improves accuracy vs a smaller k", () => {
    const n = 60000;
    const rng = makeLCG(2025);
    const data = range(n, () => {
      // mixture: 80% N(0,1), 20% N(5,2)
      const u = rng();
      const z =
        Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) *
        Math.cos(2 * Math.PI * rng()); // ~N(0,1)
      return u < 0.8 ? z : 5 + 2 * z;
    });

    const ps = [0.01, 0.1, 0.5, 0.9, 0.99];

    const small = new KLLSketch({ k: 64 });
    small.addMany(data);
    const big = new KLLSketch({ k: 512 });
    big.addMany(data);

    const exact = exactQuantiles(data, ps);
    const errSmall = rmse(
      ps.map((p) => small.quantile(p)),
      exact,
    );
    const errBig = rmse(
      ps.map((p) => big.quantile(p)),
      exact,
    );

    // Not strictly guaranteed per-run, but should hold comfortably with seeded RNG
    expect(errBig).toBeLessThanOrEqual(errSmall * 0.8); // at least 20% better RMSE
  });

  it("c parameter extremes (within allowed range) keep the sketch sane", () => {
    const n = 25000;
    const data = range(
      n,
      (i) => Math.tan((i % 1000) * 0.001) * 0.1 + Math.cos(i * 0.003) * 2,
    );

    const ps = [0.01, 0.5, 0.99];
    const exact = exactQuantiles(data, ps);

    const kllTight = new KLLSketch({ k: 256, c: 0.6 });
    kllTight.addMany(data);
    const tightQs = ps.map((p) => kllTight.quantile(p));

    const kllLoose = new KLLSketch({ k: 256, c: 0.9 });
    kllLoose.addMany(data);
    const looseQs = ps.map((p) => kllLoose.quantile(p));

    // both should be within reasonable distance of exact
    const tol = 0.08 * Math.abs(exact[2]); // scale with 99th
    for (let i = 0; i < ps.length; i++) {
      expect(Math.abs(tightQs[i] - exact[i])).toBeLessThanOrEqual(tol);
      expect(Math.abs(looseQs[i] - exact[i])).toBeLessThanOrEqual(tol);
    }
  });

  it("eagerCompaction mode yields results close to lazy compaction", () => {
    const rng = makeLCG(77);
    const data = range(40000, () => (rng() - 0.5) * 100 + Math.sin(rng() * 20));

    const ps = Array.from({ length: 11 }, (_, i) => i / 10);

    const lazy = new KLLSketch({ k: 256, eagerCompaction: false });
    lazy.addMany(data);
    const Qlazy = ps.map((p) => lazy.quantile(p));

    const eager = new KLLSketch({ k: 256, eagerCompaction: true });
    eager.addMany(data);
    const Qeager = ps.map((p) => eager.quantile(p));

    const err = rmse(Qlazy, Qeager);
    // They won't be identical, but should be quite close
    expect(err).toBeLessThanOrEqual(
      0.02 * (Math.max(...data) - Math.min(...data)),
    );
  });
});
