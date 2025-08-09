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

import { EPOCH_DURATION_MS } from "@/lib/constants";

export const parseRelayoutEvent = (
  e: Partial<Plotly.Layout>,
  startTime?: Date,
) => {
  if (startTime === undefined) {
    return undefined;
  }

  if ((e["autosize"] || e["xaxis.autorange"]) && startTime !== undefined) {
    return [startTime, new Date(startTime.getTime() + EPOCH_DURATION_MS)];
  }

  let newStart, newEnd;

  if (e["xaxis.range"]) {
    newStart = new Date(e["xaxis.range"][0] ?? "");
    newEnd = new Date(e["xaxis.range"][1] ?? "");
  } else if (e["xaxis.range[0]"] && e["xaxis.range[1]"]) {
    newStart = new Date(e["xaxis.range[0]"]);
    newEnd = new Date(e["xaxis.range[1]"]);
  }

  if (newStart !== undefined && newEnd !== undefined) {
    if (newStart < startTime && newEnd < startTime) {
      return [startTime, new Date(startTime.getTime() + EPOCH_DURATION_MS)];
    }

    return [new Date(newStart), new Date(newEnd)];
  }

  return undefined;
};

export const binarySearch = (arr: number[], target: Date): number => {
  let left = 0,
    right = arr.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (arr[mid] <= target.getTime()) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left - 1;
};
