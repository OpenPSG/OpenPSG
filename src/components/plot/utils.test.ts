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
import { parseRelayoutEvent, getTickValsAndText } from "./utils";
import { EPOCH_DURATION } from "@/lib/constants";

describe("parseRelayoutEvent", () => {
  it("returns range from xaxis.range", () => {
    const result = parseRelayoutEvent({ "xaxis.range": [10, 20] }, 100);
    expect(result).toEqual([10, 20]);
  });

  it("returns clamped range within 0 and totalDuration", () => {
    const result = parseRelayoutEvent({ "xaxis.range": [-5, 150] }, 100);
    expect(result).toEqual([0, 100]);
  });

  it("returns at least 1 second range", () => {
    const result = parseRelayoutEvent({ "xaxis.range": [30.5, 30.7] }, 100);
    expect(result).toEqual([30.5, 31.5]);
  });

  it("returns range from xaxis.range[0] and xaxis.range[1]", () => {
    const result = parseRelayoutEvent(
      {
        "xaxis.range[0]": 40,
        "xaxis.range[1]": 50,
      },
      100,
    );
    expect(result).toEqual([40, 50]);
  });

  it("returns default range if autorange is true", () => {
    const result = parseRelayoutEvent(
      {
        "xaxis.autorange": true,
      },
      100,
    );
    expect(result).toEqual([0, EPOCH_DURATION]);
  });

  it("returns null for invalid input", () => {
    const result = parseRelayoutEvent({}, 100);
    expect(result).toBeNull();
  });
});

describe("getTickValsAndText", () => {
  const mockStartTime = new Date("2023-01-01T00:00:00Z");

  it("returns empty arrays when duration is zero or negative", () => {
    const result = getTickValsAndText(10, 10, mockStartTime);
    expect(result.tickvals).toEqual([]);
    expect(result.ticktext).toEqual([]);
  });

  it("returns tickvals and formatted ticktext for short duration", () => {
    const result = getTickValsAndText(0, 20, mockStartTime);
    expect(result.tickvals.length).toBeGreaterThan(0);
    expect(
      result.ticktext.every((txt) => /^\d{1}:\d{2}:\d{2}$/.test(txt)),
    ).toBe(true);
  });

  it("uses correct interval for various durations", () => {
    const intervals = [
      { duration: 50, expectedInterval: 5 },
      { duration: 200, expectedInterval: 30 },
      { duration: 1000, expectedInterval: 60 },
      { duration: 4000, expectedInterval: 300 },
      { duration: 10000, expectedInterval: 600 },
      { duration: 30000, expectedInterval: 1800 },
      { duration: 50000, expectedInterval: 3600 },
    ];

    for (const { duration, expectedInterval } of intervals) {
      const result = getTickValsAndText(0, duration, mockStartTime);
      const diffs = result.tickvals
        .slice(1)
        .map((v, i) => v - result.tickvals[i]);
      const uniqueDiffs = Array.from(new Set(diffs));
      expect(uniqueDiffs).toContain(expectedInterval);
    }
  });

  it("only includes ticks within start and end", () => {
    const result = getTickValsAndText(100, 160, mockStartTime);
    expect(result.tickvals.every((t) => t >= 100 && t <= 160)).toBe(true);
  });
});
