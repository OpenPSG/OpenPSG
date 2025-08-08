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

  if (e["xaxis.autorange"]) return [0, EPOCH_DURATION_MS];
  return null;
};

export const getTickValsAndText = (
  start: number,
  end: number,
): { tickvals: number[]; ticktext: string[] } => {
  const duration = (end - start) / 1000; // In seconds
  if (duration <= 0) return { tickvals: [], ticktext: [] };

  let interval: number;
  if (duration <= 10) {
    interval = 1_000;
  } else if (duration <= 60) {
    interval = 5_000;
  } else if (duration <= 300) {
    interval = 30_000;
  } else if (duration <= 1800) {
    interval = 60_000;
  } else if (duration <= 7200) {
    interval = 300_000;
  } else if (duration <= 14400) {
    interval = 600_000;
  } else if (duration <= 43200) {
    interval = 1800_000;
  } else {
    interval = 3600_000;
  }

  const tickvals: number[] = [];
  const ticktext: string[] = [];

  const alignedFirstTick = Math.ceil((start / interval) * interval);

  for (let t = alignedFirstTick; t <= end; t += interval) {
    tickvals.push(t);
    const date = new Date(t);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    ticktext.push(`${hours}:${minutes}:${seconds}`);
  }

  return { tickvals, ticktext };
};
