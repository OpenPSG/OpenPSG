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
import { EPOCH_DURATION_MS } from "@/lib/constants";

describe("parseRelayoutEvent", () => {
  it("returns range from xaxis.range", () => {
    const result = parseRelayoutEvent({ "xaxis.range": [10, 20] }, 0);
    expect(result).toEqual([10, 20]);
  });

  it("returns range from xaxis.range[0] and xaxis.range[1]", () => {
    const result = parseRelayoutEvent(
      {
        "xaxis.range[0]": 40,
        "xaxis.range[1]": 50,
      },
      0,
    );
    expect(result).toEqual([40, 50]);
  });

  it("returns default range if autorange is true", () => {
    const result = parseRelayoutEvent(
      {
        "xaxis.autorange": true,
      },
      0,
    );
    expect(result).toEqual([0, EPOCH_DURATION_MS]);
  });

  it("returns null for invalid input", () => {
    const result = parseRelayoutEvent({}, 0);
    expect(result).toBeUndefined();
  });
});

describe("getTickValsAndText", () => {
  it("returns empty arrays when duration is zero or negative", () => {
    const result = getTickValsAndText(10_000, 10_000);
    expect(result.tickvals).toEqual([]);
    expect(result.ticktext).toEqual([]);
  });

  it("returns tickvals and formatted ticktext for short duration", () => {
    const result = getTickValsAndText(0, 20_000);
    expect(result.tickvals.length).toBeGreaterThan(0);
    expect(
      result.ticktext.every((txt) => /^\d{2}:\d{2}:\d{2}$/.test(txt)),
    ).toBe(true);
  });

  it("uses correct interval for various durations", () => {
    const intervals = [
      { duration: 50_000, expectedInterval: 5_000 },
      { duration: 200_000, expectedInterval: 30_000 },
      { duration: 1000_000, expectedInterval: 60_000 },
      { duration: 4000_000, expectedInterval: 300_000 },
      { duration: 10000_000, expectedInterval: 600_000 },
      { duration: 30000_000, expectedInterval: 1800_000 },
      { duration: 50000_000, expectedInterval: 3600_000 },
    ];

    for (const { duration, expectedInterval } of intervals) {
      const result = getTickValsAndText(0, duration);
      const diffs = result.tickvals
        .slice(1)
        .map((v, i) => v - result.tickvals[i]);
      const uniqueDiffs = Array.from(new Set(diffs));
      expect(uniqueDiffs).toContain(expectedInterval);
    }
  });

  it("only includes ticks within start and end", () => {
    const result = getTickValsAndText(100_000, 160_000);
    expect(result.tickvals.every((t) => t >= 100_000 && t <= 160_000)).toBe(
      true,
    );
  });
});
