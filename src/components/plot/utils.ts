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

import { EPOCH_DURATION } from "@/lib/constants";

export const parseRelayoutEvent = (
  e: Partial<Plotly.Layout>,
  totalDuration: number,
) => {
  let newStart, newEnd;

  if (e["xaxis.range"]) {
    [newStart, newEnd] = e["xaxis.range"];
  } else if (e["xaxis.range[0]"] && e["xaxis.range[1]"]) {
    newStart = e["xaxis.range[0]"];
    newEnd = e["xaxis.range[1]"];
  }

  if (typeof newStart === "number" && typeof newEnd === "number") {
    newStart = Math.max(0, newStart);
    newEnd = Math.min(totalDuration, newEnd);
    return newEnd - newStart < 1
      ? [newStart, newStart + 1]
      : [newStart, newEnd];
  }

  if (e["xaxis.autorange"]) return [0, EPOCH_DURATION];
  return null;
};

export const getTickValsAndText = (
  start: number,
  end: number,
  startTime: Date,
): { tickvals: number[]; ticktext: string[] } => {
  const duration = end - start;
  if (duration <= 0) return { tickvals: [], ticktext: [] };

  let interval: number;
  if (duration <= 10) {
    interval = 1;
  } else if (duration <= 60) {
    interval = 5;
  } else if (duration <= 300) {
    interval = 30;
  } else if (duration <= 1800) {
    interval = 60;
  } else if (duration <= 7200) {
    interval = 300;
  } else if (duration <= 14400) {
    interval = 600;
  } else if (duration <= 43200) {
    interval = 1800;
  } else {
    interval = 3600;
  }

  const tickvals: number[] = [];
  const ticktext: string[] = [];

  const globalStartSec = Math.floor(startTime.getTime() / 1000);
  const alignedFirstTickSec =
    Math.ceil((globalStartSec + start) / interval) * interval;

  for (let t = alignedFirstTickSec; t <= globalStartSec + end; t += interval) {
    const relativeT = t - globalStartSec;
    if (relativeT >= start && relativeT <= end) {
      tickvals.push(relativeT);
      const date = new Date(t * 1000);
      ticktext.push(date.toTimeString().slice(0, 8));
    }
  }

  return { tickvals, ticktext };
};
