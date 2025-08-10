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

/**
 * Downsamples a time series using the Largest-Triangle-Three-Buckets (LTTB) algorithm.
 *
 * This method reduces the number of points in a dataset while preserving its
 * visual shape — including important features like peaks and valleys — by
 * selecting the most representative points across the range.
 *
 * It's particularly useful for rendering large time-series datasets in
 * interactive plots (e.g., EEG signals, telemetry data, or any signal where
 * visual fidelity matters), especially in a limited pixel space.
 *
 * @param input - The original time series to be downsampled.
 * @param n - The maximum number of points to include in the output. Must be >= 3.
 * @returns A new `Values` object containing `n` number of points selected using LTTB.
 *
 * @see https://skemman.is/handle/1946/15343 - Sveinn Steinarsson’s MSc thesis introducing LTTB
 *
 * Note: This implementation assumes the timestamps are sorted in ascending order.
 */
export function resample(input: Values, n: number): Values {
  const length = input.length;

  if (n >= length || n < 3) {
    return input; // No resampling needed
  }

  const sampledValues = new Array<Value>(n);

  // Always include first point
  sampledValues[0] = input[0];

  const bucketSize = (length - 2) / (n - 2);
  let a = 0;
  let sampledIndex = 1;

  for (let i = 0; i < n - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, length);

    // Calculate average in the next bucket
    let avgX = 0;
    let avgY = 0;
    let avgCount = rangeEnd - rangeStart;

    if (avgCount < 1) avgCount = 1; // prevent division by 0

    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += input[j].timestamp.getTime();
      avgY += input[j].value;
    }

    avgX /= avgCount;
    avgY /= avgCount;

    // Find point with max triangle area
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, length);

    let maxArea = -1;
    let maxIndex = -1;

    const ax = input[a].timestamp.getTime();
    const ay = input[a].value;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (ax - avgX) * (input[j].value - ay) -
          (ax - input[j].timestamp.getTime()) * (avgY - ay),
      );

      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampledValues[sampledIndex] = input[maxIndex];
    a = maxIndex;
    sampledIndex++;
  }

  // Always include last point
  sampledValues[n - 1] = input[length - 1];

  return sampledValues;
}
