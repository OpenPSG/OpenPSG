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

/**
 * Quickselect (in-place, iterative) to find the k-th smallest element.
 * Average O(n), worst-case O(n^2) unless you use a deterministic pivot.
 */
function quickselect(
  arr: number[],
  k: number,
  left = 0,
  right = arr.length - 1,
): number {
  if (k < 0 || k >= arr.length) throw new RangeError("k out of range");

  while (left <= right) {
    // random pivot helps avoid bad cases on average
    let pivotIndex = left + Math.floor(Math.random() * (right - left + 1));
    pivotIndex = partition(arr, left, right, pivotIndex);

    if (k === pivotIndex) return arr[k];
    if (k < pivotIndex) right = pivotIndex - 1;
    else left = pivotIndex + 1;
  }
  // Should never reach here if inputs are valid
  throw new Error("Quickselect failed");
}

function partition(
  arr: number[],
  left: number,
  right: number,
  pivotIndex: number,
): number {
  const pivotValue = arr[pivotIndex];
  swap(arr, pivotIndex, right);
  let store = left;
  for (let i = left; i < right; i++) {
    if (arr[i] < pivotValue) {
      swap(arr, i, store);
      store++;
    }
  }
  swap(arr, store, right);
  return store;
}

function swap(arr: number[], i: number, j: number): void {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

export type PercentileMethod = "nearest_rank" | "lower";

/**
 * Map p in [0,1] to a 0-based rank index according to a chosen rule.
 * - "nearest_rank": k = ceil(p * n) - 1  (classic "nearest-rank" definition)
 * - "lower":        k = floor(p * (n - 1)) (index on [0, n-1])
 */
function percentileIndex(
  n: number,
  p: number,
  method: PercentileMethod,
): number {
  if (n <= 0) throw new Error("Empty array");
  const pp = Math.min(Math.max(p, 0), 1); // clamp

  let k: number;
  if (method === "nearest_rank") {
    k = Math.ceil(pp * n) - 1; // yields -1 at p=0 → clamp to 0 below
  } else {
    // "lower"
    k = Math.floor(pp * (n - 1));
  }
  // clamp to [0, n-1]
  return Math.min(Math.max(k, 0), n - 1);
}

/**
 * Compute arbitrary percentile in O(n) time.
 * Modifies the input array order (due to in-place partitioning).
 */
export function percentile(
  arr: number[],
  p: number, // percentile in [0, 1]
  method?: PercentileMethod, // "nearest_rank" or "lower"
): number {
  const n = arr.length;
  if (n === 0) throw new Error("Array must not be empty");

  const k1 = percentileIndex(n, p, method ?? "nearest_rank");
  return quickselect(arr, k1);
}
