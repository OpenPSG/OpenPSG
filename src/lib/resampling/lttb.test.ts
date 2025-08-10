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
import { resample } from "./lttb";
import type { Values } from "@/lib/types";

describe("lttb", () => {
  const generateLinearSeries = (length: number): Values => {
    return Array.from({ length }, (_, i) => ({
      timestamp: new Date(i * 1000),
      value: i,
    }));
  };

  it("should return the same values if n >= length", () => {
    const values = generateLinearSeries(10);
    const result = resample(values, 10);
    expect(result).toEqual(values);
  });

  it("should return the same values if n < 3", () => {
    const values = generateLinearSeries(10);
    const result = resample(values, 2);
    expect(result).toEqual(values);
  });

  it("should reduce the number of points to n", () => {
    const values = generateLinearSeries(100);
    const n = 10;
    const result = resample(values, n);
    expect(result).toHaveLength(n);
  });

  it("should always include the first and last point", () => {
    const values = generateLinearSeries(50);
    const result = resample(values, 5);
    expect(result[0]).toEqual(values[0]);
    expect(result[result.length - 1]).toEqual(values[values.length - 1]);
  });

  it("should preserve shape — detect peak", () => {
    const values: Values = [
      { timestamp: new Date(0), value: 0 },
      { timestamp: new Date(1000), value: 1 },
      { timestamp: new Date(2000), value: 10 },
      { timestamp: new Date(3000), value: 1 },
      { timestamp: new Date(4000), value: 0 },
      { timestamp: new Date(5000), value: -1 },
    ];
    const result = resample(values, 4);
    expect(result).toContainEqual({ timestamp: new Date(2000), value: 10 }); // peak must be preserved
  });

  it("should preserve shape — detect valley", () => {
    const values: Values = [
      { timestamp: new Date(0), value: 10 },
      { timestamp: new Date(1000), value: 9 },
      { timestamp: new Date(2000), value: 0 },
      { timestamp: new Date(3000), value: 9 },
      { timestamp: new Date(4000), value: 10 },
      { timestamp: new Date(5000), value: 11 },
    ];
    const result = resample(values, 4);
    expect(result).toContainEqual({ timestamp: new Date(2000), value: 0 }); // valley must be preserved
  });

  it("should return increasing timestamps", () => {
    const values = generateLinearSeries(30);
    const result = resample(values, 10);
    const sorted = [...result].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    expect(result).toEqual(sorted); // timestamps should stay sorted
  });
});
