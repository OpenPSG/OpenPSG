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

import type { Values } from "@/lib/types";

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
 * @param values - The original time series to be downsampled.
 * @param n - The maximum number of points to include in the output. Must be >= 3.
 * @returns A new `Values` object containing `n` number of points selected using LTTB.
 *
 * @see https://skemman.is/handle/1946/15343 - Sveinn Steinarsson’s MSc thesis introducing LTTB
 *
 * Note: This implementation assumes the timestamps are in milliseconds and sorted in ascending order.
 */
export function lttb(values: Values, n: number): Values {
  const { timestamps, values: ys } = values;
  const length = timestamps.length;

  if (n >= length || n < 3) {
    return values; // No resampling needed
  }

  const sampledTimestamps = new Array<number>(n);
  const sampledValues = new Array<number>(n);

  // Always include first point
  sampledTimestamps[0] = timestamps[0];
  sampledValues[0] = ys[0];

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
      avgX += timestamps[j];
      avgY += ys[j];
    }

    avgX /= avgCount;
    avgY /= avgCount;

    // Find point with max triangle area
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, length);

    let maxArea = -1;
    let maxIndex = -1;

    const ax = timestamps[a];
    const ay = ys[a];

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (ax - avgX) * (ys[j] - ay) - (ax - timestamps[j]) * (avgY - ay),
      );

      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampledTimestamps[sampledIndex] = timestamps[maxIndex];
    sampledValues[sampledIndex] = ys[maxIndex];
    a = maxIndex;
    sampledIndex++;
  }

  // Always include last point
  sampledTimestamps[n - 1] = timestamps[length - 1];
  sampledValues[n - 1] = ys[length - 1];

  return {
    timestamps: sampledTimestamps,
    values: sampledValues,
  };
}
