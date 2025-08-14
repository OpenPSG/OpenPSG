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

import { describe, it, expect } from "vitest";
import { percentile, type PercentileMethod } from "./quickselect";

function expectedBySorting(
  data: number[],
  p: number,
  method: PercentileMethod = "nearest_rank",
): number {
  const arr = [...data].sort((a, b) => a - b);
  const n = arr.length;
  if (n === 0) throw new Error("Array must not be empty");
  const pp = Math.min(Math.max(p, 0), 1);

  let k: number;
  if (method === "nearest_rank") {
    k = Math.ceil(pp * n) - 1;
  } else {
    k = Math.floor(pp * (n - 1));
  }
  k = Math.min(Math.max(k, 0), n - 1);
  return arr[k];
}

describe("percentile (nearest_rank)", () => {
  it("throws on empty array", () => {
    expect(() => percentile([], 0.5)).toThrow(/must not be empty/i);
  });

  it("handles p = 0 (min)", () => {
    const arr = [10, 2, 5, 8, 3];
    const result = percentile([...arr], 0);
    expect(result).toBe(2);
  });

  it("handles p = 1 (max)", () => {
    const arr = [10, 2, 5, 8, 3];
    const result = percentile([...arr], 1);
    expect(result).toBe(10);
  });

  it("classic median-ish case, n=5, p=0.5 → 3rd smallest", () => {
    const arr = [10, 2, 5, 8, 3];
    const result = percentile([...arr], 0.5);
    expect(result).toBe(5);
  });

  it("clamps p < 0 to min and p > 1 to max", () => {
    const arr = [4, 7, 1, 9];
    expect(percentile([...arr], -0.2)).toBe(1);
    expect(percentile([...arr], 1.7)).toBe(9);
  });

  it("works with duplicate values", () => {
    const arr = [5, 5, 5, 5, 5];
    expect(percentile([...arr], 0)).toBe(5);
    expect(percentile([...arr], 0.5)).toBe(5);
    expect(percentile([...arr], 1)).toBe(5);
  });

  it("works with negatives and zero", () => {
    const arr = [-5, -1, -3, 0];
    expect(percentile([...arr], 0)).toBe(-5);
    expect(percentile([...arr], 0.5)).toBe(-3); // ceil(0.5*4)-1=1 → 2nd smallest is -3
    expect(percentile([...arr], 1)).toBe(0);
  });

  it("mutates input (order may change) but preserves multiset", () => {
    const original = [7, 2, 9, 4, 3, 8, 1, 6, 5];
    const arr = [...original];
    void percentile(arr, 0.33);
    // Same multiset after mutation
    expect(arr.slice().sort((a, b) => a - b)).toEqual(
      original.slice().sort((a, b) => a - b),
    );
  });
});

describe("percentile (method = 'lower')", () => {
  it("uses floor(p * (n - 1)) indexing", () => {
    const arr = [10, 2, 5, 8, 3];
    const result = percentile([...arr], 0.5, "lower");
    // lower: floor(0.5*(5-1)) = floor(2) = 2 → 3rd smallest
    expect(result).toBe(5);
  });

  it("edge p values", () => {
    const arr = [10, 2, 5, 8, 3];
    expect(percentile([...arr], 0, "lower")).toBe(2);
    expect(percentile([...arr], 1, "lower")).toBe(10); // floor(1*(n-1)) = n-1
  });

  it("clamps out-of-range p", () => {
    const arr = [4, 7, 1, 9];
    expect(percentile([...arr], -10, "lower")).toBe(1);
    expect(percentile([...arr], 42, "lower")).toBe(9);
  });
});

describe("percentile vs sorted baseline (randomized smoke tests)", () => {
  // Not seeding Math.random on purpose; algorithm result should be pivot-agnostic.
  for (let t = 0; t < 5; t++) {
    it(`random array comparison run #${t + 1}`, () => {
      const n = 100;
      const arr: number[] = Array.from(
        { length: n },
        () => Math.floor(Math.random() * 1000) - 500,
      );
      const ps = [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1];

      for (const p of ps) {
        const expectNearest = expectedBySorting(arr, p, "nearest_rank");
        const gotNearest = percentile([...arr], p, "nearest_rank");
        expect(gotNearest).toBe(expectNearest);

        const expectLower = expectedBySorting(arr, p, "lower");
        const gotLower = percentile([...arr], p, "lower");
        expect(gotLower).toBe(expectLower);
      }
    });
  }
});
