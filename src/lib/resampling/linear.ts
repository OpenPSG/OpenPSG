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

import type { Value, Values } from "@/lib/types";

// Resampling function to change the number of samples in a signal.
// This function can either upsample or downsample the input array.
// It uses linear interpolation to fill in the gaps when upsampling.
export function resample(input: Values, n: number): Values {
  const length = input.length;

  if (length === 0 || n === 0) return [];

  // If no change requested, keep original array (zero allocs).
  // (Differs from the previous version which cloned Dates.)
  if (length === n) return input;

  // n === 1 → pick the middle sample (same as before, but without extra arrays)
  if (n === 1) {
    const mid = (length - 1) >> 1;
    return [input[mid]];
  }

  const startTime = input[0].timestamp.getTime();
  const endTime = input[length - 1].timestamp.getTime();
  const totalDuration = endTime - startTime;

  // All timestamps identical → flat timeline; replicate value & timestamp
  if (totalDuration === 0) {
    const out = new Array<Value>(n);
    const v = input[0].value;
    const t = input[0].timestamp;
    for (let i = 0; i < n; i++) out[i] = { timestamp: t, value: v };
    return out;
  }

  const step = totalDuration / (n - 1);

  const out = new Array<Value>(n);

  // Two-pointer sweep over input for successive targetTimes
  let j = 0;
  let left = input[0];
  let right = input[1];
  let leftTime = left.timestamp.getTime();
  let rightTime = right.timestamp.getTime();

  // First point is exactly at start
  out[0] = { timestamp: input[0].timestamp, value: input[0].value };

  // Iterate targets in strictly increasing time
  let targetTime = startTime + step; // we already emitted i=0
  for (let i = 1; i < n - 1; i++, targetTime += step) {
    // Advance window so that leftTime <= targetTime <= rightTime
    while (rightTime < targetTime && j < length - 2) {
      j++;
      left = input[j];
      right = input[j + 1];
      leftTime = left.timestamp.getTime();
      rightTime = right.timestamp.getTime();
    }

    // Exact hit on left/right timestamp? Reuse that Date object.
    if (targetTime <= leftTime) {
      out[i] = { timestamp: left.timestamp, value: left.value };
      continue;
    }
    if (targetTime >= rightTime) {
      out[i] = { timestamp: right.timestamp, value: right.value };
      continue;
    }

    const denom = rightTime - leftTime;
    const ratio = denom === 0 ? 0 : (targetTime - leftTime) / denom;
    const value = left.value + (right.value - left.value) * ratio;

    // Create a Date only when we actually interpolate between points
    out[i] = { timestamp: new Date(targetTime), value };
  }

  // Last point is exactly at end
  out[n - 1] = {
    timestamp: input[length - 1].timestamp,
    value: input[length - 1].value,
  };

  return out;
}
