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
  const length = input.length;
  if (length === 0 || n === 0) {
    return [];
  }

  // If input is already the desired size, return as-is
  if (length === n) {
    return input.map(({ timestamp, value }) => ({
      timestamp: new Date(timestamp),
      value,
    }));
  }

  // Handle case where n is 1: return middle value
  if (n === 1) {
    const mid = Math.floor((length - 1) / 2);
    return [
      {
        timestamp: new Date(input[mid].timestamp),
        value: input[mid].value,
      },
    ];
  }

  // Extract times as numbers for calculation
  const timestamps = input.map((p) => p.timestamp.getTime());
  const values = input.map((p) => p.value);

  const startTime = timestamps[0];
  const endTime = timestamps[length - 1];
  const totalDuration = endTime - startTime;
  const step = totalDuration / (n - 1);

  const result: Values = [];

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

    let interpolatedValue: number;
    if (rightTime === leftTime) {
      interpolatedValue = leftValue;
    } else {
      const ratio = (targetTime - leftTime) / (rightTime - leftTime);
      interpolatedValue = leftValue * (1 - ratio) + rightValue * ratio;
    }

    result.push({
      timestamp: new Date(targetTime),
      value: interpolatedValue,
    });
  }

  return result;
}
