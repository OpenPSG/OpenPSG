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
import { binarySearch } from "./binarysearch";
import type { Values } from "@/lib/types";

// helper to build a sorted Values array
const make = (dates: string[]): Values =>
  dates.map((d, i) => ({ timestamp: new Date(d), value: i }));

describe("binarySearch", () => {
  it("returns -1 for empty array", () => {
    expect(binarySearch([], new Date("2025-01-01T00:00:00Z"))).toBe(-1);
  });

  it("finds exact matches", () => {
    const arr = make([
      "2025-01-01T00:00:00Z",
      "2025-01-02T00:00:00Z",
      "2025-01-03T00:00:00Z",
    ]);
    expect(binarySearch(arr, new Date("2025-01-01T00:00:00Z"))).toBe(0);
    expect(binarySearch(arr, new Date("2025-01-02T00:00:00Z"))).toBe(1);
    expect(binarySearch(arr, new Date("2025-01-03T00:00:00Z"))).toBe(2);
  });

  it("returns index of greatest <= target when between elements", () => {
    const arr = make([
      "2025-01-01T00:00:00Z",
      "2025-01-02T00:00:00Z",
      "2025-01-03T00:00:00Z",
    ]);
    // Between 1st and 2nd -> 0
    expect(binarySearch(arr, new Date("2025-01-01T12:00:00Z"))).toBe(0);
    // Between 2nd and 3rd -> 1
    expect(binarySearch(arr, new Date("2025-01-02T12:00:00Z"))).toBe(1);
  });

  it("returns -1 when target precedes the first element", () => {
    const arr = make(["2025-01-10T00:00:00Z", "2025-01-11T00:00:00Z"]);
    expect(binarySearch(arr, new Date("2025-01-01T00:00:00Z"))).toBe(-1);
  });

  it("returns last index when target is after the last element", () => {
    const arr = make(["2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z"]);
    expect(binarySearch(arr, new Date("2025-01-10T00:00:00Z"))).toBe(1);
  });

  it("handles duplicate timestamps by returning the last matching index", () => {
    const arr = make([
      "2025-01-01T00:00:00Z",
      "2025-01-02T00:00:00Z",
      "2025-01-02T00:00:00Z",
      "2025-01-03T00:00:00Z",
    ]);
    // target equals duplicate timestamp -> should return the last duplicate (index 2)
    expect(binarySearch(arr, new Date("2025-01-02T00:00:00Z"))).toBe(2);
    // target between duplicate and next -> still index 2
    expect(binarySearch(arr, new Date("2025-01-02T12:00:00Z"))).toBe(2);
  });

  it("works with single-element arrays", () => {
    const arr = make(["2025-01-05T00:00:00Z"]);
    expect(binarySearch(arr, new Date("2025-01-04T00:00:00Z"))).toBe(-1);
    expect(binarySearch(arr, new Date("2025-01-05T00:00:00Z"))).toBe(0);
    expect(binarySearch(arr, new Date("2025-01-06T00:00:00Z"))).toBe(0);
  });
});
