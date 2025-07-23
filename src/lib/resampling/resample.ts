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

// Resampling function to change the number of samples in a signal.
// This function can either upsample or downsample the input array.
// It uses linear interpolation to fill in the gaps when upsampling.
export function resample(input: Values, n: number): Values {
  const length = input.timestamps.length;
  if (length === 0 || n === 0) {
    return { timestamps: [], values: [] };
  }

  // If input is already the desired size, return as-is
  if (length === n) {
    return {
      timestamps: [...input.timestamps],
      values: [...input.values],
    };
  }

  // Handle case where n is 1: return middle value
  if (n === 1) {
    const mid = Math.floor((length - 1) / 2);
    return {
      timestamps: [input.timestamps[mid]],
      values: [input.values[mid]],
    };
  }

  const { timestamps, values } = input;
  const startTime = timestamps[0];
  const endTime = timestamps[length - 1];
  const totalDuration = endTime - startTime;
  const step = totalDuration / (n - 1);

  const resultTimestamps: number[] = [];
  const resultValues: number[] = [];

  for (let i = 0; i < n; i++) {
    const targetTime = startTime + i * step;

    // Binary search for interpolation bounds
    let left = 0;
    let right = length - 1;
    while (left < right - 1) {
      const mid = Math.floor((left + right) / 2);
      if (timestamps[mid] < targetTime) {
        left = mid;
      } else {
        right = mid;
      }
    }

    const leftTime = timestamps[left];
    const rightTime = timestamps[right];
    const leftValue = values[left];
    const rightValue = values[right];

    if (rightTime === leftTime) {
      resultTimestamps.push(targetTime);
      resultValues.push(leftValue);
    } else {
      const ratio = (targetTime - leftTime) / (rightTime - leftTime);
      const interpolatedValue = leftValue * (1 - ratio) + rightValue * ratio;
      resultTimestamps.push(targetTime);
      resultValues.push(interpolatedValue);
    }
  }

  return {
    timestamps: resultTimestamps,
    values: resultValues,
  };
}
